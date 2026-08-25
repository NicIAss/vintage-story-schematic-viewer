import { describe, expect, it } from "vitest";
import type { CompiledBlockDefinition, RegistryFaceTexture } from "../assets/types";
import { resolveMicroblockFaceTexture } from "./microblockMaterials";

const texture = (base: string): RegistryFaceTexture => ({
  base: { base, assetPath: base, url: base, alternativeCount: 1 },
  overlays: [],
  rotation: 0,
});

const definition = (textures: Record<string, RegistryFaceTexture>): CompiledBlockDefinition => ({
  code: "game:test",
  sourceFile: "test.json",
  className: "BlockStairs",
  drawType: null,
  renderPass: null,
  shapeBase: "block/basic/stairs/normal",
  isMeta: false,
  variant: {},
  cubeTextures: null,
  shape: {
    key: "test:shape",
    rotateX: 0,
    rotateY: 0,
    rotateZ: 0,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    scale: 1,
    textures,
  },
  supportBeamShapes: null,
  entityShapes: null,
  climateColorMap: null,
  seasonColorMap: null,
  groundStorage: null,
  decor: null,
  pile: null,
  warnings: [],
});

describe("resolveMicroblockFaceTexture", () => {
  it("uses facing aliases from JSON-shaped chisel materials", () => {
    const east = texture("east.png");
    const all = texture("all.png");
    const block = definition({ east, all });
    expect(resolveMicroblockFaceTexture(block, "east")).toBe(east);
    expect(resolveMicroblockFaceTexture(block, "north")).toBe(all);
  });

  it("matches the game's first-texture fallback for non-facing aliases", () => {
    const wood = texture("wood.png");
    expect(resolveMicroblockFaceTexture(definition({ wood }), "up")).toBe(wood);
  });

  it("uses the first declared texture for dynamic pile blocks", () => {
    const charcoal = texture("charcoal.png");
    const block = {
      ...definition({}),
      shape: null,
      pile: { textures: { charcoal } },
    };
    expect(resolveMicroblockFaceTexture(block, "north")).toBe(charcoal);
  });
});
