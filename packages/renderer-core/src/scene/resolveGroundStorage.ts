import type {
  AssetRegistry,
  CompiledBlockDefinition,
  CompiledGroundStorageProperties,
  CompiledItemDefinition,
  CompiledModelTransform,
  CompiledShapeReference,
  GroundStorageLayout,
} from "../assets/types";
import type { ParsedSchematic, SchematicBlock } from "../schematic/types";
import { getNumberAttribute, type DecodedItemStack, type TreeAttribute } from "../schematic/treeAttribute";

export interface ResolvedGroundStorageContent {
  readonly block: SchematicBlock;
  readonly slotIndex: number;
  readonly code: string;
  readonly collectibleType: "block" | "item";
  readonly blockDefinition: CompiledBlockDefinition | null;
  readonly itemDefinition: CompiledItemDefinition | null;
  readonly reference: CompiledShapeReference;
  readonly modelTransform: CompiledModelTransform | null;
  readonly elementLimit: number | null;
  readonly meshAngle: number;
  readonly layoutOffset: readonly [number, number, number];
  readonly layoutRotation: number;
  readonly layoutScale: number;
  readonly signature: string;
}

export interface GroundStorageResolution {
  readonly contents: readonly ResolvedGroundStorageContent[];
  readonly resolvedBlockPositions: ReadonlySet<number>;
  readonly unresolvedBlockPositions: ReadonlySet<number>;
}

interface InventoryStack {
  readonly slotIndex: number;
  readonly stack: DecodedItemStack;
}

const OVERRIDE_LAYOUTS: readonly GroundStorageLayout[] = [
  "SingleCenter",
  "Halves",
  "WallHalves",
  "Quadrants",
  "Stacking",
  "Messy12",
];

export function resolveGroundStorageContents(
  schematic: ParsedSchematic,
  registry: AssetRegistry,
): GroundStorageResolution {
  const contents: ResolvedGroundStorageContent[] = [];
  const resolvedBlockPositions = new Set<number>();
  const unresolvedBlockPositions = new Set<number>();
  const entities = new Map(
    schematic.blockEntities.map((entity) => [entity.packedPosition, entity] as const),
  );

  for (const block of schematic.blocks) {
    if (registry.blocks[block.code]?.className !== "BlockGroundStorage") {
      continue;
    }
    const attributes = entities.get(block.packedPosition)?.attributes;
    if (attributes === null || attributes === undefined) {
      unresolvedBlockPositions.add(block.packedPosition);
      continue;
    }
    const stacks = inventoryStacks(attributes);
    if (stacks.length === 0) {
      unresolvedBlockPositions.add(block.packedPosition);
      continue;
    }

    const firstDefinition = collectibleDefinition(stacks[0]?.stack, schematic, registry);
    const storageProperties = firstDefinition?.groundStorage ?? null;
    const layout = overrideLayout(attributes, storageProperties);
    if (storageProperties === null || layout === undefined) {
      unresolvedBlockPositions.add(block.packedPosition);
      continue;
    }

    const blockContents: ResolvedGroundStorageContent[] = [];
    let complete = true;
    for (const { slotIndex, stack } of stacks) {
      const resolved = resolveStack(stack, schematic, registry, layout);
      if (resolved === null) {
        complete = false;
        break;
      }
      const placements = contentPlacements(layout, slotIndex, stack.stackSize, resolved.groundStorage);
      if (placements === null) {
        complete = false;
        break;
      }
      for (const placement of placements) {
        blockContents.push({
          block,
          slotIndex,
          code: resolved.code,
          collectibleType: resolved.collectibleType,
          blockDefinition: resolved.blockDefinition,
          itemDefinition: resolved.itemDefinition,
          reference: resolved.reference,
          modelTransform: layout === "Stacking" ? null : resolved.groundStorage.modelTransform,
          elementLimit: placement.elementLimit,
          meshAngle: getNumberAttribute(attributes, "meshAngle"),
          layoutOffset: placement.offset,
          layoutRotation: placement.rotation,
          layoutScale: placement.scale,
          signature: JSON.stringify([
            resolved.collectibleType,
            resolved.code,
            resolved.reference,
            layout === "Stacking" ? null : resolved.groundStorage.modelTransform,
            placement.elementLimit,
          ]),
        });
      }
    }

    if (complete && blockContents.length > 0) {
      contents.push(...blockContents);
      resolvedBlockPositions.add(block.packedPosition);
    } else {
      unresolvedBlockPositions.add(block.packedPosition);
    }
  }

  return { contents, resolvedBlockPositions, unresolvedBlockPositions };
}

function inventoryStacks(attributes: TreeAttribute): InventoryStack[] {
  const inventory = treeValue(attributes, "inventory");
  const slots = inventory === null ? null : treeValue(inventory, "slots");
  if (slots === null) {
    return [];
  }
  return Object.entries(slots)
    .map(([key, value]): InventoryStack | null => {
      const slotIndex = Number.parseInt(key, 10);
      if (!Number.isInteger(slotIndex) || slotIndex < 0 || value.type !== "itemstack" || value.value === null) {
        return null;
      }
      return { slotIndex, stack: value.value };
    })
    .filter((entry): entry is InventoryStack => entry !== null)
    .sort((left, right) => left.slotIndex - right.slotIndex);
}

function treeValue(tree: TreeAttribute, key: string): TreeAttribute | null {
  const value = tree[key];
  return value?.type === "tree" ? value.value : null;
}

function overrideLayout(
  attributes: TreeAttribute,
  storageProperties: CompiledGroundStorageProperties | null,
): GroundStorageLayout | undefined {
  const override = attributes.overrideLayout;
  if (override?.type === "int") {
    return OVERRIDE_LAYOUTS[override.value];
  }
  return storageProperties?.layout;
}

function layoutOffsets(
  layout: GroundStorageLayout,
): readonly (readonly [number, number, number])[] | null {
  switch (layout) {
    case "SingleCenter": return [[0, 0, 0]];
    case "Halves":
    case "WallHalves": return [[-0.25, 0, 0], [0.25, 0, 0]];
    case "Quadrants": return [
      [-0.25, 0, -0.25],
      [-0.25, 0, 0.25],
      [0.25, 0, -0.25],
      [0.25, 0, 0.25],
    ];
    case "Stacking":
    case "Messy12": return [[0, 0, 0]];
  }
}

interface GroundStoragePlacement {
  readonly offset: readonly [number, number, number];
  readonly rotation: number;
  readonly scale: number;
  readonly elementLimit: number | null;
}

const MESSY_12_POSITIONS: readonly (readonly [number, number])[] = [
  [0.1875, -0.0625], [-0.17, 0.125], [-0.125, -0.125], [0.125, 0.1875],
  [0.375, 0.0625], [-0.375, -0.0625], [0, -0.3125], [-0.0625, 0.3125],
  [0.3125, -0.375], [-0.375, 0.3125], [-0.375, -0.3125], [0.25, 0.375],
];

// These are the seeded System.Random(0) values consumed by BlockGroundStorage
// after the shipped messy12Position array supplies each copy's X/Z position.
const MESSY_12_ROTATIONS = [
  0.7262432699679598, 0.7680226893946634, 0.2060331540210327,
  0.9060270660119257, 0.9775497531413798, 0.29190628476995334,
  0.6326590728166788, 0.9821512531406019, 0.8623701538249712,
  0.6771811492169189, 0.8169079086822029, 0.9919021753556571,
] as const;
const MESSY_12_SCALES = [
  1.0063465071918194, 1.0011632238287307, 1.0011776958923684,
  0.9988435574662143, 0.9954740891537974, 0.9993462940069596,
  0.9993902375685937, 0.9906073398145882, 1.009906941624315,
  0.9962918358604851, 1.0069610356618468, 0.990652503967589,
] as const;

function contentPlacements(
  layout: GroundStorageLayout,
  slotIndex: number,
  stackSize: number,
  properties: CompiledGroundStorageProperties,
): readonly GroundStoragePlacement[] | null {
  if (layout === "Stacking") {
    if (slotIndex !== 0 || properties.stackingReference === null) return null;
    return [{
      offset: [0, 0, 0],
      rotation: 0,
      scale: 1,
      elementLimit: properties.cuboidsPerModel
        * Math.ceil(Math.max(1, stackSize) / properties.itemsPerModel),
    }];
  }
  if (layout === "Messy12") {
    if (slotIndex !== 0) return null;
    const placements: GroundStoragePlacement[] = [];
    let rotation = 0;
    let scale = 1;
    for (let index = 0; index < Math.min(12, Math.max(1, stackSize)); index += 1) {
      rotation += (MESSY_12_ROTATIONS[index] ?? 0) * Math.PI * 2;
      scale *= MESSY_12_SCALES[index] ?? 1;
      const position = MESSY_12_POSITIONS[index] ?? [0, 0];
      placements.push({
        offset: [position[0], 0, position[1]],
        rotation,
        scale,
        elementLimit: null,
      });
    }
    return placements;
  }
  const offset = layoutOffsets(layout)?.[slotIndex];
  return offset === undefined
    ? null
    : [{ offset, rotation: 0, scale: 1, elementLimit: null }];
}

function collectibleDefinition(
  stack: DecodedItemStack | undefined,
  schematic: ParsedSchematic,
  registry: AssetRegistry,
): CompiledBlockDefinition | CompiledItemDefinition | null {
  if (stack === undefined) {
    return null;
  }
  const isBlock = stack.itemClass === 0;
  const code = isBlock ? schematic.blockCodes.get(stack.id) : schematic.itemCodes.get(stack.id);
  if (code === undefined) {
    return null;
  }
  return isBlock ? registry.blocks[code] ?? null : registry.items[code] ?? null;
}

function resolveStack(
  stack: DecodedItemStack,
  schematic: ParsedSchematic,
  registry: AssetRegistry,
  layout: GroundStorageLayout,
): {
  readonly code: string;
  readonly collectibleType: "block" | "item";
  readonly blockDefinition: CompiledBlockDefinition | null;
  readonly itemDefinition: CompiledItemDefinition | null;
  readonly reference: CompiledShapeReference;
  readonly groundStorage: CompiledGroundStorageProperties;
} | null {
  const isBlock = stack.itemClass === 0;
  const code = isBlock ? schematic.blockCodes.get(stack.id) : schematic.itemCodes.get(stack.id);
  if (code === undefined) {
    return null;
  }
  const blockDefinition = isBlock ? registry.blocks[code] ?? null : null;
  const itemDefinition = isBlock ? null : registry.items[code] ?? null;
  const definition = blockDefinition ?? itemDefinition;
  if (definition === null || definition === undefined || definition.groundStorage === null) {
    return null;
  }
  const reference = layout === "Stacking"
    ? definition.groundStorage.stackingReference
    : definition.shape;
  if (reference === null || reference === undefined) return null;
  return {
    code,
    collectibleType: isBlock ? "block" : "item",
    blockDefinition,
    itemDefinition,
    reference,
    groundStorage: definition.groundStorage,
  };
}
