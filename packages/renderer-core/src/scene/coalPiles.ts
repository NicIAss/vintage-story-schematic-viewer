import type { AssetRegistry, RegistryFaceTexture } from "../assets/types";
import type { ParsedSchematic, SchematicBlock } from "../schematic/types";
import type { DecodedItemStack, TreeAttribute } from "../schematic/treeAttribute";

export interface ResolvedCoalPile {
  readonly block: SchematicBlock;
  readonly texture: RegistryFaceTexture;
  readonly height: number;
  readonly signature: string;
}

export function resolveCoalPiles(
  schematic: ParsedSchematic,
  registry: AssetRegistry,
): ReadonlyMap<number, ResolvedCoalPile> {
  const resolved = new Map<number, ResolvedCoalPile>();
  const entities = new Map(
    schematic.blockEntities.map((entity) => [entity.packedPosition, entity] as const),
  );

  for (const block of schematic.blocks) {
    const pile = registry.blocks[block.code]?.pile;
    if (pile === null || pile === undefined) {
      continue;
    }
    const attributes = entities.get(block.packedPosition)?.attributes;
    const stack = attributes === null || attributes === undefined
      ? null
      : firstInventoryStack(attributes);
    if (attributes === null || attributes === undefined || stack === null || stack.stackSize < 1) {
      continue;
    }
    const containedCode = stack.itemClass === 0
      ? schematic.blockCodes.get(stack.id)
      : schematic.itemCodes.get(stack.id);
    const textureKey = attributes.burning?.type === "bool" && attributes.burning.value
      ? "ember"
      : assetPath(containedCode);
    const texture = textureKey === null ? undefined : pile.textures[textureKey];
    if (texture === undefined) {
      continue;
    }
    const height = coalPileHeight(stack.stackSize);
    resolved.set(block.packedPosition, {
      block,
      texture,
      height,
      signature: `${textureKey}:${height}`,
    });
  }
  return resolved;
}

export function coalPileHeight(stackSize: number): number {
  const layers = stackSize === 1 ? 1 : Math.floor(stackSize / 2);
  return Math.max(2, Math.min(16, layers * 2)) / 16;
}

function firstInventoryStack(attributes: TreeAttribute): DecodedItemStack | null {
  const inventory = attributes.inventory;
  const slots = inventory?.type === "tree" ? inventory.value.slots : undefined;
  const firstSlot = slots?.type === "tree" ? slots.value["0"] : undefined;
  return firstSlot?.type === "itemstack" ? firstSlot.value : null;
}

function assetPath(code: string | undefined): string | null {
  if (code === undefined) {
    return null;
  }
  const separator = code.indexOf(":");
  return (separator < 0 ? code : code.slice(separator + 1)).toLowerCase();
}
