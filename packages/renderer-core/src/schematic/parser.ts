import { normalizeAssetLocation } from "./assetLocation";
import { decodeTreeAttributeString } from "./treeAttribute";
import type {
  ParsedSchematic,
  SchematicBlock,
  SchematicBlockEntity,
  SchematicDecor,
  SchematicPosition,
  SchematicSize,
} from "./types";

const POSITION_BIT_MASK = 0x3ff;
const MAX_AXIS_SIZE = POSITION_BIT_MASK + 1;
const DECOR_BLOCK_ID_BASE = 0x1000000;

type JsonRecord = Record<string, unknown>;

export class SchematicValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SchematicValidationError";
  }
}

export function unpackSchematicPosition(
  packedPosition: number,
): SchematicPosition {
  assertUint32(packedPosition, "Packed schematic position");

  return {
    x: packedPosition & POSITION_BIT_MASK,
    y: (packedPosition >>> 20) & POSITION_BIT_MASK,
    z: (packedPosition >>> 10) & POSITION_BIT_MASK,
  };
}

export function parseSchematicJson(jsonText: string): ParsedSchematic {
  let value: unknown;
  try {
    value = JSON.parse(jsonText.replace(/^\uFEFF/, ""));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SchematicValidationError(
      "Schematic is not valid JSON: " + detail,
    );
  }

  return parseSchematic(value);
}

export function parseSchematic(value: unknown): ParsedSchematic {
  const root = expectRecord(value, "Schematic root");
  const size: SchematicSize = {
    x: readAxisSize(root, "SizeX"),
    y: readAxisSize(root, "SizeY"),
    z: readAxisSize(root, "SizeZ"),
  };

  const blockCodes = readCodeMap(root.BlockCodes, "BlockCodes", false);
  const itemCodes = readCodeMap(root.ItemCodes, "ItemCodes", true);
  const indices = readNumberArray(root.Indices, "Indices");
  const blockIds = readNumberArray(root.BlockIds, "BlockIds");

  if (indices.length !== blockIds.length) {
    throw new SchematicValidationError(
      "Indices and BlockIds must contain the same number of entries.",
    );
  }

  const warnings: string[] = [];
  const blocks: SchematicBlock[] = [];
  const referencedCodes = new Set<string>();
  const occupiedPositions = new Set<number>();
  let repeatedPositionCount = 0;
  let visibleBlockCount = 0;

  for (let ordinal = 0; ordinal < indices.length; ordinal += 1) {
    const packedPosition = indices[ordinal];
    const schematicBlockId = blockIds[ordinal];
    if (packedPosition === undefined || schematicBlockId === undefined) {
      throw new SchematicValidationError(
        "Unexpected missing block entry at ordinal " + ordinal + ".",
      );
    }

    assertUint32(packedPosition, "Indices[" + ordinal + "]");
    assertInteger(schematicBlockId, "BlockIds[" + ordinal + "]");

    const code = blockCodes.get(schematicBlockId);
    if (code === undefined) {
      throw new SchematicValidationError(
        "BlockIds[" +
          ordinal +
          "] references missing BlockCodes id " +
          schematicBlockId +
          ".",
      );
    }

    const position = unpackSchematicPosition(packedPosition);
    if (
      position.x >= size.x ||
      position.y >= size.y ||
      position.z >= size.z
    ) {
      warnings.push(
        "Block " +
          ordinal +
          " lies outside declared bounds at " +
          formatPosition(position) +
          ".",
      );
    }

    if (occupiedPositions.has(packedPosition)) {
      repeatedPositionCount += 1;
    } else {
      occupiedPositions.add(packedPosition);
    }

    if (code !== "game:air") {
      visibleBlockCount += 1;
    }
    referencedCodes.add(code);
    blocks.push({
      ordinal,
      packedPosition,
      position,
      schematicBlockId,
      code,
    });
  }

  const decorIndices = readNumberArray(root.DecorIndices, "DecorIndices", true);
  const decorIds = readNumberArray(root.DecorIds, "DecorIds", true);
  if (decorIndices.length !== decorIds.length) {
    throw new SchematicValidationError(
      "DecorIndices and DecorIds must contain the same number of entries.",
    );
  }

  const decors: SchematicDecor[] = decorIndices.map(
    (packedPosition, ordinal) => {
      const packedDecorId = decorIds[ordinal];
      if (packedDecorId === undefined) {
        throw new SchematicValidationError(
          "Unexpected missing decor entry at ordinal " + ordinal + ".",
        );
      }
      assertUint32(packedPosition, "DecorIndices[" + ordinal + "]");
      assertSafeInteger(packedDecorId, "DecorIds[" + ordinal + "]");
      const schematicBlockId = packedDecorId % DECOR_BLOCK_ID_BASE;
      const faceAndSubposition = Math.floor(packedDecorId / DECOR_BLOCK_ID_BASE);
      const faceIndex = faceAndSubposition % 6;
      const subpositionAndRotation = Math.floor(faceAndSubposition / 6);
      const code = blockCodes.get(schematicBlockId);
      if (code === undefined) {
        throw new SchematicValidationError(
          `DecorIds[${ordinal}] references missing BlockCodes id ${schematicBlockId}.`,
        );
      }
      return {
        ordinal,
        packedPosition,
        position: unpackSchematicPosition(packedPosition),
        packedDecorId,
        schematicBlockId,
        code,
        faceIndex,
        subPosition: subpositionAndRotation & 0xfff,
        rotation: (subpositionAndRotation >>> 12) & 0x7,
      };
    },
  );

  const blockEntities = readBlockEntities(root.BlockEntities, warnings);
  const entities = readStringArray(root.Entities, "Entities", true);
  const gameVersion =
    typeof root.GameVersion === "string" ? root.GameVersion : null;

  return {
    gameVersion,
    size,
    blockCodes,
    itemCodes,
    blocks,
    blockEntities,
    decors,
    entities,
    diagnostics: {
      blockCount: blocks.length,
      visibleBlockCount,
      mappedBlockCodeCount: blockCodes.size,
      referencedBlockCodeCount: referencedCodes.size,
      mappedItemCodeCount: itemCodes.size,
      decorCount: decors.length,
      blockEntityCount: blockEntities.length,
      entityCount: entities.length,
      repeatedPositionCount,
    },
    warnings,
  };
}

function readBlockEntities(value: unknown, warnings: string[]): SchematicBlockEntity[] {
  if (value === undefined || value === null) {
    return [];
  }

  const record = expectRecord(value, "BlockEntities");
  return Object.entries(record).map(([rawPosition, encodedData]) => {
    const packedPosition = Number(rawPosition);
    assertUint32(packedPosition, "BlockEntities key " + rawPosition);
    if (typeof encodedData !== "string") {
      throw new SchematicValidationError(
        "BlockEntities[" + rawPosition + "] must be a string.",
      );
    }

    let attributes: SchematicBlockEntity["attributes"] = null;
    let decodeError: string | null = null;
    try {
      attributes = decodeTreeAttributeString(encodedData);
    } catch (error) {
      decodeError = error instanceof Error ? error.message : String(error);
      warnings.push(`Could not decode block entity at ${rawPosition}: ${decodeError}`);
    }
    return {
      packedPosition,
      position: unpackSchematicPosition(packedPosition),
      encodedData,
      attributes,
      decodeError,
    };
  });
}

function readCodeMap(
  value: unknown,
  label: string,
  optional: boolean,
): Map<number, string> {
  if ((value === undefined || value === null) && optional) {
    return new Map();
  }

  const record = expectRecord(value, label);
  const result = new Map<number, string>();
  for (const [rawId, rawCode] of Object.entries(record)) {
    const id = Number(rawId);
    assertInteger(id, label + " key " + rawId);
    if (typeof rawCode !== "string") {
      throw new SchematicValidationError(
        label + "[" + rawId + "] must be a string.",
      );
    }
    try {
      result.set(id, normalizeAssetLocation(rawCode));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new SchematicValidationError(label + ": " + detail);
    }
  }
  return result;
}

function readAxisSize(root: JsonRecord, key: string): number {
  const value = root[key];
  assertInteger(value, key);
  if (value < 0 || value > MAX_AXIS_SIZE) {
    throw new SchematicValidationError(
      key + " must be between 0 and " + MAX_AXIS_SIZE + ".",
    );
  }
  return value;
}

function readNumberArray(
  value: unknown,
  label: string,
  optional = false,
): number[] {
  if ((value === undefined || value === null) && optional) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new SchematicValidationError(label + " must be an array.");
  }
  return value.map((entry, index) => {
    if (typeof entry !== "number") {
      throw new SchematicValidationError(
        label + "[" + index + "] must be a number.",
      );
    }
    return entry;
  });
}

function readStringArray(
  value: unknown,
  label: string,
  optional = false,
): string[] {
  if ((value === undefined || value === null) && optional) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new SchematicValidationError(label + " must be an array.");
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new SchematicValidationError(
        label + "[" + index + "] must be a string.",
      );
    }
    return entry;
  });
}

function expectRecord(value: unknown, label: string): JsonRecord {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new SchematicValidationError(label + " must be an object.");
  }
  return value as JsonRecord;
}

function assertInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new SchematicValidationError(label + " must be an integer.");
  }
}

function assertSafeInteger(
  value: unknown,
  label: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new SchematicValidationError(label + " must be a safe integer.");
  }
}

function assertUint32(value: unknown, label: string): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 0xffffffff
  ) {
    throw new SchematicValidationError(
      label + " must be an unsigned 32-bit integer.",
    );
  }
}

function formatPosition(position: SchematicPosition): string {
  return (
    "(" + position.x + ", " + position.y + ", " + position.z + ")"
  );
}
