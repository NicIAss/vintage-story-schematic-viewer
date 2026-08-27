import { describe, expect, it } from "vitest";
import type {
  AssetRegistry,
  CompiledShapeReference,
  RegistryFaceTexture,
} from "../assets/types";
import type { ParsedSchematic, SchematicBlock } from "../schematic/types";
import type { TreeAttribute } from "../schematic/treeAttribute";
import { resolveFruitTrees } from "./fruitTrees";

describe("dynamic fruit-tree resolution", () => {
  it("uses the saved species, flowering state, and growth direction", () => {
    const block = schematicBlock(1, "game:fruittree-foliage", 4, 5, 6);
    const resolved = resolveFruitTrees(
      schematic([block], [[block, attributes("redapple", 3, 2, 2, 0)]]),
      registry(),
    ).get(1);

    expect(resolved?.parts).toHaveLength(1);
    expect(resolved?.parts[0]?.reference.key).toBe("foliage-hor-s");
    expect(resolved?.parts[0]?.selectedElementNames).toEqual(["sticks", "blossom"]);
    expect(
      resolved?.parts[0]?.reference.textures.smallleaves.base.base,
    ).toBe("block/plant/fruittree/redapple/leaves");
    expect(
      resolved?.parts[0]?.reference.textures.blossom.base.base,
    ).toBe("block/plant/fruittree/redapple/blossom");
  });

  it("selects fruit sides and fruiting textures from block-entity data", () => {
    const block = schematicBlock(2, "game:fruittree-foliage", 8, 9, 10);
    const resolved = resolveFruitTrees(
      schematic([block], [[block, attributes("pear", 3, 3, 1, 1)]]),
      registry(),
    ).get(2);

    expect(resolved?.parts.map((part) => part.renderMode)).toEqual([
      "fruit-tree-foliage",
      "fruit-tree-fruit",
    ]);
    expect(resolved?.parts[1]?.selectedElementNames).toEqual(["fruits-n"]);
    expect(resolved?.parts[1]?.reference.textures.fruit.base.base).toBe(
      "block/plant/fruittree/pear/fruiting",
    );
  });

  it("uses a non-end branch shape when another fruit-tree branch continues ahead", () => {
    const branch = schematicBlock(3, "game:fruittree-branch", 2, 3, 4);
    const continuation = schematicBlock(4, "game:fruittree-branch", 3, 3, 4);
    const resolved = resolveFruitTrees(
      schematic(
        [branch, continuation],
        [
          [branch, attributes("pear", 1, 3, 1, 0)],
          [continuation, attributes("pear", 1, 3, 1, 0)],
        ],
      ),
      registry(),
    ).get(3);

    expect(resolved?.parts[0]?.reference.key).toBe("branch-e");
  });
});

function registry(): AssetRegistry {
  const shapeNames = [
    "stem",
    "branch-e",
    "branch-e-end",
    "foliage-hor-e",
    "foliage-hor-s",
    "fruit-pear",
  ];
  const shapes = Object.fromEntries(shapeNames.map((name) => [
    name,
    reference(name, name.startsWith("foliage")
      ? ["smallleaves", "blossom", "sticks1"]
      : name.startsWith("fruit") ? ["fruit"] : ["bark", "treetrunk"]),
  ]));
  return {
    blocks: {
      "game:fruittree-foliage": { className: "BlockDynamicTreeFoliage" },
      "game:fruittree-branch": { className: "BlockDynamicTreeBranch" },
    },
    fruitTrees: {
      shapes,
      types: {
        redapple: {
          textures: {
            "smallleaves-flowering": face("block/plant/fruittree/redapple/leaves"),
            blossom: face("block/plant/fruittree/redapple/blossom"),
            bark: face("block/plant/fruittree/redapple/bark"),
            treetrunk: face("block/plant/fruittree/redapple/treetrunk"),
          },
          climateColorMap: "climatePlantTint",
          seasonColorMap: "seasonalFoliage",
          evergreen: false,
          ripeFruitShapeName: null,
        },
        pear: {
          textures: {
            "smallleaves-fruiting": face("block/plant/fruittree/pear/leaves"),
            "fruit-fruiting": face("block/plant/fruittree/pear/fruiting"),
            bark: face("block/plant/fruittree/pear/bark"),
            treetrunk: face("block/plant/fruittree/pear/treetrunk"),
          },
          climateColorMap: "climatePlantTint",
          seasonColorMap: "seasonalFoliage",
          evergreen: false,
          ripeFruitShapeName: null,
        },
      },
      deadTreeTexture: face("block/wood/bark/aged"),
    },
  } as unknown as AssetRegistry;
}

function reference(name: string, aliases: readonly string[]): CompiledShapeReference {
  return {
    key: name,
    rotateX: 0,
    rotateY: 0,
    rotateZ: 0,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    scale: 1,
    textures: Object.fromEntries(aliases.map((alias) => [alias, face(`fallback/${alias}`)])),
  };
}

function face(base: string): RegistryFaceTexture {
  return {
    base: { base, assetPath: `${base}.png`, url: `/${base}.png`, alternativeCount: 1 },
    overlays: [],
    rotation: 0,
  };
}

function schematic(
  blocks: readonly SchematicBlock[],
  entities: readonly (readonly [SchematicBlock, TreeAttribute])[],
): ParsedSchematic {
  return {
    gameVersion: "1.22.5",
    size: { x: 16, y: 16, z: 16 },
    blockCodes: new Map(),
    itemCodes: new Map(),
    blocks,
    blockEntities: entities.map(([block, entityAttributes]) => ({
      packedPosition: block.packedPosition,
      position: block.position,
      encodedData: "",
      attributes: entityAttributes,
      decodeError: null,
    })),
    decors: [],
    entities: [],
    diagnostics: {
      blockCount: blocks.length,
      visibleBlockCount: blocks.length,
      mappedBlockCodeCount: 2,
      referencedBlockCodeCount: 2,
      mappedItemCodeCount: 0,
      decorCount: 0,
      blockEntityCount: entities.length,
      entityCount: 0,
      repeatedPositionCount: 0,
    },
    warnings: [],
  };
}

function schematicBlock(
  packedPosition: number,
  code: string,
  x: number,
  y: number,
  z: number,
): SchematicBlock {
  return {
    ordinal: packedPosition,
    packedPosition,
    position: { x, y, z },
    schematicBlockId: packedPosition,
    code,
  };
}

function attributes(
  treeType: string,
  partType: number,
  foliageState: number,
  growthDir: number,
  fruitingSide: number,
): TreeAttribute {
  return {
    treeType: { type: "string", value: treeType },
    partType: { type: "int", value: partType },
    foliageState: { type: "int", value: foliageState },
    growthDir: { type: "int", value: growthDir },
    fruitingSide: { type: "int", value: fruitingSide },
    height: { type: "int", value: 0 },
    sideGrowth: { type: "int", value: 0 },
  };
}
