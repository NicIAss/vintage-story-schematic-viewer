import { describe, expect, it } from "vitest";
import type { AssetRegistry, CompiledItemDefinition } from "../assets/types";
import type { ParsedSchematic } from "../schematic/types";
import type { TreeAttribute } from "../schematic/treeAttribute";
import { resolveGroundStorageContents } from "./resolveGroundStorage";

const itemDefinition: CompiledItemDefinition = {
  code: "game:test-item",
  sourceFile: "survival/itemtypes/test.json",
  className: null,
  variant: {},
  shape: {
    key: "survival:shapes/item/test",
    rotateX: 0,
    rotateY: 0,
    rotateZ: 0,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    scale: 1,
    textures: {},
  },
  groundStorage: {
    layout: "Halves",
    modelTransform: null,
    stackingReference: null,
    itemsPerModel: 1,
    cuboidsPerModel: 1,
  },
  warnings: [],
};

describe("resolveGroundStorageContents", () => {
  it("resolves sparse inventory slots and preserves their layout offsets and mesh angle", () => {
    const attributes: TreeAttribute = {
      inventory: {
        type: "tree",
        value: {
          slots: {
            type: "tree",
            value: {
              "0": {
                type: "itemstack",
                value: { itemClass: 1, id: 7, stackSize: 1, attributes: {} },
              },
              "1": {
                type: "itemstack",
                value: { itemClass: 1, id: 7, stackSize: 1, attributes: {} },
              },
            },
          },
        },
      },
      meshAngle: { type: "float", value: Math.PI / 2 },
    };
    const schematic = {
      gameVersion: "test",
      size: { x: 1, y: 1, z: 1 },
      blockCodes: new Map([[1, "game:groundstorage"]]),
      itemCodes: new Map([[7, "game:test-item"]]),
      blocks: [{
        ordinal: 0,
        packedPosition: 0,
        position: { x: 0, y: 0, z: 0 },
        schematicBlockId: 1,
        code: "game:groundstorage",
      }],
      blockEntities: [{
        packedPosition: 0,
        position: { x: 0, y: 0, z: 0 },
        encodedData: "",
        attributes,
        decodeError: null,
      }],
      decors: [],
      entities: [],
      diagnostics: {},
      warnings: [],
    } as unknown as ParsedSchematic;
    const registry = {
      blocks: {
        "game:groundstorage": { className: "BlockGroundStorage" },
      },
      items: { "game:test-item": itemDefinition },
    } as unknown as AssetRegistry;

    const resolved = resolveGroundStorageContents(schematic, registry);

    expect(resolved.resolvedBlockPositions.has(0)).toBe(true);
    expect(resolved.unresolvedBlockPositions.size).toBe(0);
    expect(resolved.contents.map((content) => content.layoutOffset)).toEqual([
      [-0.25, 0, 0],
      [0.25, 0, 0],
    ]);
    expect(resolved.contents[0]?.meshAngle).toBeCloseTo(Math.PI / 2);
  });

  it("expands Messy12 stacks using the shipped fixed positions", () => {
    const definition: CompiledItemDefinition = {
      ...itemDefinition,
      groundStorage: { ...itemDefinition.groundStorage!, layout: "Messy12" },
    };
    const attributes = storageAttributes(3);

    const resolved = resolveGroundStorageContents(
      testSchematic(attributes),
      testRegistry(definition),
    );

    expect(resolved.contents).toHaveLength(3);
    expect(resolved.contents.map((content) => content.layoutOffset)).toEqual([
      [0.1875, 0, -0.0625],
      [-0.17, 0, 0.125],
      [-0.125, 0, -0.125],
    ]);
    expect(resolved.contents[1]?.layoutRotation).toBeGreaterThan(
      resolved.contents[0]?.layoutRotation ?? 0,
    );
  });

  it("uses stacking models and limits their cuboids from stack size", () => {
    const stackingReference = { ...itemDefinition.shape!, key: "survival:shapes/item/pile" };
    const definition: CompiledItemDefinition = {
      ...itemDefinition,
      groundStorage: {
        ...itemDefinition.groundStorage!,
        layout: "Stacking",
        stackingReference,
        itemsPerModel: 2,
        cuboidsPerModel: 3,
      },
    };

    const resolved = resolveGroundStorageContents(
      testSchematic(storageAttributes(5)),
      testRegistry(definition),
    );

    expect(resolved.contents).toHaveLength(1);
    expect(resolved.contents[0]?.reference.key).toBe("survival:shapes/item/pile");
    expect(resolved.contents[0]?.elementLimit).toBe(9);
    expect(resolved.contents[0]?.modelTransform).toBeNull();
  });
});

function storageAttributes(stackSize: number): TreeAttribute {
  return {
    inventory: { type: "tree", value: { slots: { type: "tree", value: {
      "0": { type: "itemstack", value: {
        itemClass: 1, id: 7, stackSize, attributes: {},
      } },
    } } } },
  };
}

function testSchematic(attributes: TreeAttribute): ParsedSchematic {
  return {
    gameVersion: "test",
    size: { x: 1, y: 1, z: 1 },
    blockCodes: new Map([[1, "game:groundstorage"]]),
    itemCodes: new Map([[7, "game:test-item"]]),
    blocks: [{ ordinal: 0, packedPosition: 0, position: { x: 0, y: 0, z: 0 }, schematicBlockId: 1, code: "game:groundstorage" }],
    blockEntities: [{ packedPosition: 0, position: { x: 0, y: 0, z: 0 }, encodedData: "", attributes, decodeError: null }],
    decors: [], entities: [], diagnostics: {}, warnings: [],
  } as unknown as ParsedSchematic;
}

function testRegistry(definition: CompiledItemDefinition): AssetRegistry {
  return {
    blocks: { "game:groundstorage": { className: "BlockGroundStorage" } },
    items: { "game:test-item": definition },
  } as unknown as AssetRegistry;
}
