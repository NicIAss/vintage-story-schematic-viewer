import { describe, expect, it } from "vitest";
import type { CompiledShape, CompiledShapeReference } from "../assets/types";
import { createJsonShapeGeometry } from "./createJsonShapeGeometry";

const faces = Object.fromEntries(
  (["east", "west", "up", "down", "south", "north"] as const).map((face) => [
    face,
    { texture: "all", uv: [0, 0, 16, 16] as const, rotation: 0, enabled: true },
  ]),
) as CompiledShape["elements"][number]["faces"];

describe("createJsonShapeGeometry", () => {
  it("centers a full-block JSON shape and groups its faces by texture", () => {
    const shape: CompiledShape = {
      key: "test:shapes/block/cube",
      sourceFile: "test/shapes/block/cube.json",
      textureWidth: 16,
      textureHeight: 16,
      elements: [{
        from: [0, 0, 0],
        to: [16, 16, 16],
        rotationOrigin: [0, 0, 0],
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        scaleX: 1,
        scaleY: 1,
        scaleZ: 1,
        climateColorMap: null,
        seasonColorMap: null,
        faces,
        children: [],
      }],
    };
    const reference: CompiledShapeReference = {
      key: shape.key,
      rotateX: 0,
      rotateY: 0,
      rotateZ: 0,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      scale: 1,
      textures: {},
    };

    const built = createJsonShapeGeometry(shape, reference);

    expect(built?.materialAliases).toEqual(["all"]);
    expect(built?.geometry.getAttribute("position").count).toBe(24);
    expect(built?.geometry.index?.count).toBe(36);
    expect(built?.geometry.boundingBox?.min.toArray()).toEqual([-0.5, -0.5, -0.5]);
    expect(built?.geometry.boundingBox?.max.toArray()).toEqual([0.5, 0.5, 0.5]);
    built?.geometry.dispose();
  });

  it("applies ground-storage model transforms in the original 0-to-1 model space", () => {
    const shape: CompiledShape = {
      key: "test:shapes/block/cube",
      sourceFile: "test/shapes/block/cube.json",
      textureWidth: 16,
      textureHeight: 16,
      elements: [{
        from: [0, 0, 0],
        to: [16, 16, 16],
        rotationOrigin: [0, 0, 0],
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        scaleX: 1,
        scaleY: 1,
        scaleZ: 1,
        climateColorMap: null,
        seasonColorMap: null,
        faces,
        children: [],
      }],
    };
    const reference: CompiledShapeReference = {
      key: shape.key,
      rotateX: 0,
      rotateY: 0,
      rotateZ: 0,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      scale: 1,
      textures: {},
    };

    const built = createJsonShapeGeometry(shape, reference, {
      translation: [0.25, 0, 0],
      rotation: [0, 0, 0],
      origin: [0.5, 0.5, 0.5],
      scale: [0.5, 0.5, 0.5],
    });

    expect(built?.geometry.boundingBox?.min.toArray()).toEqual([0, -0.25, -0.25]);
    expect(built?.geometry.boundingBox?.max.toArray()).toEqual([0.5, 0.25, 0.25]);
    built?.geometry.dispose();
  });

  it("keeps element-level foliage colormaps in separate material groups", () => {
    const baseElement: CompiledShape["elements"][number] = {
      from: [0, 0, 0],
      to: [16, 16, 16],
      rotationOrigin: [0, 0, 0],
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      climateColorMap: null,
      seasonColorMap: null,
      faces,
      children: [],
    };
    const shape: CompiledShape = {
      key: "test:shapes/block/branchy-leaves",
      sourceFile: "test/shapes/block/branchy-leaves.json",
      textureWidth: 16,
      textureHeight: 16,
      elements: [
        baseElement,
        {
          ...baseElement,
          climateColorMap: "climatePlantTint",
          seasonColorMap: "seasonalOak",
        },
      ],
    };
    const built = createJsonShapeGeometry(shape, {
      key: shape.key,
      rotateX: 0,
      rotateY: 0,
      rotateZ: 0,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      scale: 1,
      textures: {},
    });

    expect(built?.materialAliases).toEqual(["all", "all"]);
    expect(built?.materialColorMaps).toEqual([
      { climate: null, season: null },
      { climate: "climatePlantTint", season: "seasonalOak" },
    ]);
    built?.geometry.dispose();
  });

  it("keeps transparent shape elements separate from an opaque frame", () => {
    const baseElement: CompiledShape["elements"][number] = {
      name: "Frame",
      from: [0, 0, 0],
      to: [16, 16, 1],
      rotationOrigin: [0, 0, 0],
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      climateColorMap: null,
      seasonColorMap: null,
      faces,
      children: [],
    };
    const shape: CompiledShape = {
      key: "test:shapes/block/window-frame",
      sourceFile: "test/shapes/block/window-frame.json",
      textureWidth: 16,
      textureHeight: 16,
      elements: [
        baseElement,
        { ...baseElement, name: "Glass", renderPass: 3 },
      ],
    };
    const built = createJsonShapeGeometry(shape, {
      key: shape.key,
      rotateX: 0,
      rotateY: 0,
      rotateZ: 0,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      scale: 1,
      textures: {},
    });

    expect(built?.materialAliases).toEqual(["all", "all"]);
    expect(built?.materialTransparencies).toEqual([false, true]);
    expect(built?.geometry.groups).toHaveLength(2);
    built?.geometry.dispose();
  });

  it("normalizes UVs with per-texture dimensions for tall door sheets", () => {
    const tallFace = {
      north: {
        texture: "old",
        uv: [0, 0, 16, 32] as const,
        rotation: 0,
        enabled: true,
      },
    };
    const shape: CompiledShape = {
      key: "test:shapes/block/tall-door",
      sourceFile: "test/shapes/block/tall-door.json",
      textureWidth: 16,
      textureHeight: 16,
      textureSizes: { old: [16, 32] },
      elements: [{
        name: "door",
        from: [0, 0, 0],
        to: [16, 32, 2],
        rotationOrigin: [0, 0, 0],
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        scaleX: 1,
        scaleY: 1,
        scaleZ: 1,
        climateColorMap: null,
        seasonColorMap: null,
        faces: tallFace,
        children: [],
      }],
    };
    const built = createJsonShapeGeometry(shape, {
      key: shape.key,
      rotateX: 0,
      rotateY: 0,
      rotateZ: 0,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      scale: 1,
      textures: {},
    });

    expect(Array.from(built?.geometry.getAttribute("uv").array ?? [])).toEqual([
      0, 0,
      0, 1,
      1, 1,
      1, 0,
    ]);
    built?.geometry.dispose();
  });

  it("limits stacking shapes to the requested leading elements", () => {
    const element: CompiledShape["elements"][number] = {
      from: [0, 0, 0], to: [16, 1, 16], rotationOrigin: [0, 0, 0],
      rotationX: 0, rotationY: 0, rotationZ: 0,
      scaleX: 1, scaleY: 1, scaleZ: 1,
      climateColorMap: null, seasonColorMap: null, faces, children: [],
    };
    const shape: CompiledShape = {
      key: "test:shapes/item/pile", sourceFile: "test/shapes/item/pile.json",
      textureWidth: 16, textureHeight: 16,
      elements: [element, element, element],
    };
    const reference: CompiledShapeReference = {
      key: shape.key, rotateX: 0, rotateY: 0, rotateZ: 0,
      offsetX: 0, offsetY: 0, offsetZ: 0, scale: 1, textures: {},
    };

    const built = createJsonShapeGeometry(shape, reference, null, 2);

    expect(built?.geometry.index?.count).toBe(72);
    built?.geometry.dispose();
  });
});
