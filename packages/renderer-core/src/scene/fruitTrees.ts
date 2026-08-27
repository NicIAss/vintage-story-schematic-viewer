import type {
  AssetRegistry,
  CompiledFruitTreeResources,
  CompiledFruitTreeType,
  CompiledShapeReference,
  RegistryFaceTexture,
} from "../assets/types";
import type { ParsedSchematic, SchematicBlock, SchematicPosition } from "../schematic/types";
import {
  getIntAttribute,
  getStringAttribute,
} from "../schematic/treeAttribute";

export interface ResolvedFruitTreePart {
  readonly reference: CompiledShapeReference;
  readonly selectedElementNames: readonly string[] | null;
  readonly signature: string;
  readonly renderMode: "fruit-tree-wood" | "fruit-tree-foliage" | "fruit-tree-fruit";
  readonly climateColorMap: string | null;
  readonly seasonColorMap: string | null;
}

export interface ResolvedFruitTree {
  readonly parts: readonly ResolvedFruitTreePart[];
}

const DIRECTION_CODES = ["n", "e", "s", "w", "u", "d"] as const;
const DIRECTION_OFFSETS = [
  [0, 0, -1],
  [1, 0, 0],
  [0, 0, 1],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
] as const;
const FOLIAGE_STATE_NAMES = ["", "plain", "flowering", "fruiting", "ripe", "dead"] as const;
const FACING_REMAPS: Readonly<Record<string, readonly number[]>> = {
  stem: [0, 1, 2, 3, 4, 5],
  "branch-ud": [0, 1, 2, 3, 4, 5],
  "branch-ud-end": [0, 1, 2, 3, 4, 5],
  "branch-n": [4, 3, 5, 1, 0, 2],
  "branch-s": [4, 3, 5, 1, 0, 2],
  "branch-n-end": [4, 3, 5, 1, 0, 2],
  "branch-s-end": [4, 3, 5, 1, 0, 2],
  "branch-w": [0, 5, 2, 4, 3, 1],
  "branch-e": [0, 5, 2, 4, 3, 1],
  "branch-w-end": [0, 5, 2, 4, 3, 1],
  "branch-e-end": [0, 5, 2, 4, 3, 1],
};

export function isFruitTreeDefinition(
  className: string | null | undefined,
): boolean {
  return className === "BlockDynamicTreeBranch"
    || className === "BlockFruitTreeBranch"
    || className === "BlockDynamicTreeFoliage"
    || className === "BlockFruitTreeFoliage";
}

export function resolveFruitTrees(
  schematic: ParsedSchematic,
  registry: AssetRegistry | null,
): Map<number, ResolvedFruitTree> {
  const resolved = new Map<number, ResolvedFruitTree>();
  const resources = registry?.fruitTrees;
  if (registry === null || resources === null || resources === undefined) return resolved;

  const entities = new Map(
    schematic.blockEntities.map((entity) => [entity.packedPosition, entity.attributes] as const),
  );
  const blocksByPosition = new Map(
    schematic.blocks.map((block) => [positionKey(block.position), block] as const),
  );

  for (const block of schematic.blocks) {
    const definition = registry.blocks[block.code];
    if (!isFruitTreeDefinition(definition?.className)) continue;
    const attributes = entities.get(block.packedPosition);
    if (attributes === null || attributes === undefined) continue;
    const treeTypeCode = getStringAttribute(attributes, "treeType").toLowerCase();
    const treeType = resources.types[treeTypeCode];
    if (treeType === undefined) continue;

    const foliageState = clampInt(getIntAttribute(attributes, "foliageState"), 0, 5);
    const growthDirection = clampInt(getIntAttribute(attributes, "growthDir", 4), 0, 5);
    const partType = clampInt(getIntAttribute(attributes, "partType"), 0, 3);
    const parts: ResolvedFruitTreePart[] = [];
    const isFoliageBlock = definition?.className === "BlockDynamicTreeFoliage"
      || definition?.className === "BlockFruitTreeFoliage";

    if (isFoliageBlock || partType === 3) {
      addFoliageParts(
        parts,
        resources,
        treeTypeCode,
        treeType,
        foliageState,
        growthDirection,
        getIntAttribute(attributes, "fruitingSide"),
        block.position,
        true,
      );
    } else {
      const branchPart = resolveBranchPart(
        resources,
        treeTypeCode,
        treeType,
        foliageState,
        growthDirection,
        partType,
        getIntAttribute(attributes, "sideGrowth"),
        block,
        blocksByPosition,
        registry,
      );
      if (branchPart !== null) parts.push(branchPart);
      if (partType === 1 && getIntAttribute(attributes, "height") > 0) {
        addFoliageParts(
          parts,
          resources,
          treeTypeCode,
          treeType,
          foliageState,
          growthDirection,
          getIntAttribute(attributes, "fruitingSide"),
          block.position,
          false,
        );
      }
    }
    if (parts.length > 0) resolved.set(block.packedPosition, { parts });
  }
  return resolved;
}

function resolveBranchPart(
  resources: CompiledFruitTreeResources,
  treeTypeCode: string,
  treeType: CompiledFruitTreeType,
  foliageState: number,
  growthDirection: number,
  partType: number,
  sideGrowth: number,
  block: SchematicBlock,
  blocksByPosition: ReadonlyMap<string, SchematicBlock>,
  registry: AssetRegistry,
): ResolvedFruitTreePart | null {
  let shapeName = "stem";
  let selectedElementNames: string[] | null = ["stem", "branch"];
  if (partType === 2) {
    selectedElementNames = null;
    shapeName = growthDirection >= 4
      ? "cutting-ud"
      : growthDirection === 1 || growthDirection === 3
        ? "cutting-we"
        : "cutting-ns";
  } else if (partType === 1) {
    shapeName = growthDirection >= 4
      ? "branch-ud"
      : `branch-${DIRECTION_CODES[growthDirection] ?? "n"}`;
    if (!hasFruitTreeAhead(block, growthDirection, blocksByPosition, registry)) {
      shapeName += "-end";
    }
  }
  const baseReference = resources.shapes[shapeName];
  if (baseReference === undefined) return null;
  if (selectedElementNames !== null && partType !== 3) {
    const remap = FACING_REMAPS[shapeName] ?? FACING_REMAPS.stem ?? [];
    for (let index = 0; index < 6; index += 1) {
      if ((sideGrowth & (1 << index)) === 0) continue;
      const remappedDirection = remap[index];
      const directionCode = remappedDirection === undefined
        ? undefined
        : DIRECTION_CODES[remappedDirection];
      if (directionCode !== undefined) selectedElementNames.push(`branch-${directionCode}`);
    }
  }
  const reference = applyFruitTreeTextures(
    baseReference,
    resources,
    treeType,
    foliageState,
  );
  return createPart(
    reference,
    selectedElementNames,
    "fruit-tree-wood",
    [shapeName, treeTypeCode, foliageState, sideGrowth],
  );
}

function addFoliageParts(
  parts: ResolvedFruitTreePart[],
  resources: CompiledFruitTreeResources,
  treeTypeCode: string,
  treeType: CompiledFruitTreeType,
  foliageState: number,
  growthDirection: number,
  fruitingSide: number,
  position: SchematicPosition,
  withSticks: boolean,
): void {
  const directionCode = DIRECTION_CODES[growthDirection] ?? "u";
  const shapeName = growthDirection < 4 ? `foliage-hor-${directionCode}` : "foliage-ver";
  const baseReference = resources.shapes[shapeName];
  if (baseReference === undefined) return;
  const selectedElementNames: string[] = [];
  if (withSticks) selectedElementNames.push("sticks");
  if (foliageState === 2) selectedElementNames.push("blossom");
  if (
    foliageState === 1
    || foliageState === 3
    || foliageState === 4
    || (foliageState === 2 && treeType.evergreen)
  ) {
    selectedElementNames.push("leaves");
  }
  if (selectedElementNames.length > 0) {
    const randomRotation = foliageRotation(position);
    const reference = applyFruitTreeTextures(
      { ...baseReference, rotateY: baseReference.rotateY + randomRotation },
      resources,
      treeType,
      foliageState,
    );
    parts.push(createPart(
      reference,
      selectedElementNames,
      "fruit-tree-foliage",
      [shapeName, treeTypeCode, foliageState, withSticks, randomRotation],
      treeType.climateColorMap,
      treeType.seasonColorMap,
    ));
  }

  if ((foliageState === 3 || foliageState === 4) && fruitingSide !== 0) {
    const defaultFruitShapeName = `fruit-${treeTypeCode}`;
    const fruitShapeName = foliageState === 4
      ? treeType.ripeFruitShapeName ?? defaultFruitShapeName
      : defaultFruitShapeName;
    const fruitBaseReference = resources.shapes[fruitShapeName];
    if (fruitBaseReference === undefined) return;
    const fruitElements: string[] = [];
    for (let direction = 0; direction < 4; direction += 1) {
      if ((fruitingSide & (1 << direction)) !== 0) {
        fruitElements.push(`fruits-${DIRECTION_CODES[direction]}`);
      }
    }
    if (fruitElements.length === 0) return;
    const fruitReference = applyFruitTreeTextures(
      fruitBaseReference,
      resources,
      treeType,
      foliageState,
    );
    parts.push(createPart(
      fruitReference,
      fruitElements,
      "fruit-tree-fruit",
      [fruitShapeName, treeTypeCode, foliageState, fruitingSide],
    ));
  }
}

function applyFruitTreeTextures(
  reference: CompiledShapeReference,
  resources: CompiledFruitTreeResources,
  treeType: CompiledFruitTreeType,
  foliageState: number,
): CompiledShapeReference {
  const stateName = FOLIAGE_STATE_NAMES[foliageState] ?? "";
  const textures: Record<string, RegistryFaceTexture> = { ...reference.textures };
  for (const alias of Object.keys(textures)) {
    if (
      foliageState === 5
      && (alias.toLowerCase() === "bark" || alias.toLowerCase() === "treetrunk")
      && resources.deadTreeTexture !== null
    ) {
      textures[alias] = resources.deadTreeTexture;
      continue;
    }
    const normalizedAlias = alias.toLowerCase();
    const stateTexture = stateName === ""
      ? undefined
      : treeType.textures[`${normalizedAlias}-${stateName}`];
    const texture = stateTexture ?? treeType.textures[normalizedAlias];
    if (texture !== undefined) textures[alias] = texture;
  }
  return { ...reference, textures };
}

function createPart(
  reference: CompiledShapeReference,
  selectedElementNames: readonly string[] | null,
  renderMode: ResolvedFruitTreePart["renderMode"],
  signatureParts: readonly unknown[],
  climateColorMap: string | null = null,
  seasonColorMap: string | null = null,
): ResolvedFruitTreePart {
  return {
    reference,
    selectedElementNames,
    renderMode,
    climateColorMap,
    seasonColorMap,
    signature: JSON.stringify([
      ...signatureParts,
      reference.key,
      reference.rotateX,
      reference.rotateY,
      reference.rotateZ,
      selectedElementNames,
      climateColorMap,
      seasonColorMap,
    ]),
  };
}

function hasFruitTreeAhead(
  block: SchematicBlock,
  growthDirection: number,
  blocksByPosition: ReadonlyMap<string, SchematicBlock>,
  registry: AssetRegistry,
): boolean {
  const offset = DIRECTION_OFFSETS[growthDirection];
  if (offset === undefined) return false;
  const next = blocksByPosition.get(positionKey({
    x: block.position.x + offset[0],
    y: block.position.y + offset[1],
    z: block.position.z + offset[2],
  }));
  return next !== undefined && isFruitTreeBranchClass(registry.blocks[next.code]?.className);
}

function isFruitTreeBranchClass(className: string | null | undefined): boolean {
  return className === "BlockDynamicTreeBranch" || className === "BlockFruitTreeBranch";
}

function positionKey(position: SchematicPosition): string {
  return `${position.x},${position.y},${position.z}`;
}

function foliageRotation(position: SchematicPosition): number {
  let hash = Math.imul(position.x, 0x45d9f3b)
    ^ Math.imul(position.y, 0x27d4eb2d)
    ^ Math.imul(position.z, 0x165667b1);
  hash ^= hash >>> 16;
  return ((hash >>> 0) % 3) * 22.5 - 22.5;
}

function clampInt(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}
