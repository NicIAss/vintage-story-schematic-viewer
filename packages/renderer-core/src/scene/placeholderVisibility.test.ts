import { describe, expect, it } from "vitest";
import { InstancedMesh } from "three";
import type { ParsedSchematic } from "../schematic/types";
import { createSchematicScene } from "./createSchematicScene";

describe("unresolved block visibility", () => {
  it("hides placeholders by default while preserving counts and meta visibility rules", async () => {
    const scene = await createSchematicScene(schematic(), null);
    const meshes = scene.object.children.filter(
      (child): child is InstancedMesh => child instanceof InstancedMesh,
    );
    const ordinary = meshes.find((mesh) => mesh.userData.blockCode === "game:unresolved");
    const meta = meshes.find((mesh) => mesh.userData.blockCode === "game:meta-unresolved");

    expect(scene.stats.placeholderBlockCount).toBe(2);
    expect(scene.stats.metaPlaceholderBlockCount).toBe(1);
    expect(ordinary?.visible).toBe(false);
    expect(meta?.visible).toBe(false);

    scene.setPlaceholderBlocksVisible(true);
    expect(ordinary?.visible).toBe(true);
    expect(meta?.visible).toBe(false);

    scene.setMetaBlocksVisible(true);
    expect(meta?.visible).toBe(true);

    scene.setPlaceholderBlocksVisible(false);
    expect(ordinary?.visible).toBe(false);
    expect(meta?.visible).toBe(false);
    scene.dispose();
  });
});

function schematic(): ParsedSchematic {
  return {
    gameVersion: "1.22.5",
    size: { x: 2, y: 1, z: 1 },
    blockCodes: new Map(),
    itemCodes: new Map(),
    blocks: [
      {
        ordinal: 0,
        packedPosition: 0,
        position: { x: 0, y: 0, z: 0 },
        schematicBlockId: 1,
        code: "game:unresolved",
      },
      {
        ordinal: 1,
        packedPosition: 1,
        position: { x: 1, y: 0, z: 0 },
        schematicBlockId: 2,
        code: "game:meta-unresolved",
      },
    ],
    blockEntities: [],
    decors: [],
    entities: [],
    diagnostics: {
      blockCount: 2,
      visibleBlockCount: 2,
      mappedBlockCodeCount: 2,
      referencedBlockCodeCount: 2,
      mappedItemCodeCount: 0,
      decorCount: 0,
      blockEntityCount: 0,
      entityCount: 0,
      repeatedPositionCount: 0,
    },
    warnings: [],
  };
}
