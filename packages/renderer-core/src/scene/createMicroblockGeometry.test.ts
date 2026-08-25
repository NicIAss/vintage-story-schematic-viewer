import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  createMicroblockGeometry,
  decodeMicroblockCuboid,
} from "./createMicroblockGeometry";

describe("microblock geometry", () => {
  it("decodes the current packed 16x16x16 cuboid layout", () => {
    const packed = 1 | (2 << 4) | (3 << 8) | (3 << 12) | (4 << 16) | (5 << 20) | (7 << 24);

    expect(decodeMicroblockCuboid(packed)).toEqual({
      x1: 1,
      y1: 2,
      z1: 3,
      x2: 4,
      y2: 5,
      z2: 6,
      materialIndex: 7,
    });
  });

  it("creates centered box geometry with per-face material bindings", () => {
    const built = createMicroblockGeometry({
      cuboids: [0x00fff000],
      materialCodes: ["game:rock-granite"],
      rotationY: 0,
    });

    expect(built?.materialFaces).toHaveLength(6);
    expect(built?.geometry.getAttribute("position").count).toBe(24);
    expect(built?.geometry.index?.count).toBe(36);
    expect(built?.geometry.boundingBox?.min.toArray()).toEqual([-0.5, -0.5, -0.5]);
    expect(built?.geometry.boundingBox?.max.toArray()).toEqual([0.5, 0.5, 0.5]);
    built?.geometry.dispose();
  });

  it("winds every face toward its declared outward normal", () => {
    const built = createMicroblockGeometry({
      cuboids: [0x00fff000],
      materialCodes: ["game:rock-granite"],
      rotationY: 0,
    });
    expect(built).not.toBeNull();
    if (built === null) {
      return;
    }

    const positions = built.geometry.getAttribute("position");
    const normals = built.geometry.getAttribute("normal");
    const indices = built.geometry.index;
    expect(indices).not.toBeNull();
    if (indices === null) {
      return;
    }

    for (const group of built.geometry.groups) {
      const first = indices.getX(group.start);
      const second = indices.getX(group.start + 1);
      const third = indices.getX(group.start + 2);
      const a = new Vector3().fromBufferAttribute(positions, first);
      const b = new Vector3().fromBufferAttribute(positions, second);
      const c = new Vector3().fromBufferAttribute(positions, third);
      const declaredNormal = new Vector3().fromBufferAttribute(normals, first);
      const triangleNormal = b.sub(a).cross(c.sub(a)).normalize();

      expect(triangleNormal.dot(declaredNormal)).toBeGreaterThan(0.99);
    }
    built.geometry.dispose();
  });

  it("does not apply the stored material rotation to already-rotated cuboids", () => {
    const halfWidthCuboid = 0x00ff7000;
    const built = createMicroblockGeometry({
      cuboids: [halfWidthCuboid],
      materialCodes: ["game:rock-granite"],
      rotationY: 90,
    });

    expect(built?.geometry.boundingBox?.min.toArray()).toEqual([-0.5, -0.5, -0.5]);
    expect(built?.geometry.boundingBox?.max.toArray()).toEqual([0, 0.5, 0.5]);
    built?.geometry.dispose();
  });

  it("preserves distinct rotated copies found in the hut3 schematic", () => {
    const southeastCopy = createMicroblockGeometry({
      cuboids: [16_776_396],
      materialCodes: ["game:wood-debarked-oak-ud"],
      rotationY: 0,
    });
    const northwestCopy = createMicroblockGeometry({
      cuboids: [4_141_248],
      materialCodes: ["game:wood-debarked-oak-ud"],
      rotationY: 180,
    });

    expect(southeastCopy?.geometry.boundingBox?.min.toArray()).toEqual([0.25, 0.25, 0.25]);
    expect(southeastCopy?.geometry.boundingBox?.max.toArray()).toEqual([0.5, 0.5, 0.5]);
    expect(northwestCopy?.geometry.boundingBox?.min.toArray()).toEqual([-0.5, 0.25, -0.5]);
    expect(northwestCopy?.geometry.boundingBox?.max.toArray()).toEqual([-0.25, 0.5, -0.25]);
    southeastCopy?.geometry.dispose();
    northwestCopy?.geometry.dispose();
  });
});
