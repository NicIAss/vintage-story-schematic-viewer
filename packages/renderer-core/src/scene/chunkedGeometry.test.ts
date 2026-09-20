import { BoxGeometry, Group, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import { ChunkedGeometryBatcher, chunkKeyForPosition } from "./chunkedGeometry";

describe("chunked geometry batching", () => {
  it("uses stable 32-block chunk coordinates, including negative positions", () => {
    expect(chunkKeyForPosition({ x: 0, y: 31, z: 32 })).toBe("0,0,1");
    expect(chunkKeyForPosition({ x: -1, y: -32, z: -33 })).toBe("-1,-1,-2");
  });

  it("combines matching materials inside a chunk but separates distant chunks", () => {
    const source = new BoxGeometry(1, 1, 1);
    const material = new MeshBasicMaterial();
    const batcher = new ChunkedGeometryBatcher();
    for (const x of [0, 1, 40]) {
      batcher.appendGeometryGroup(
        source,
        0,
        material,
        { x, y: 0, z: 0 },
        { x, y: 0, z: 0 },
      );
    }
    const parent = new Group();
    const geometries: BoxGeometry[] = [];
    const meshCount = batcher.flush(parent, {
      name: "Test",
      renderMode: "test",
      onGeometry: (geometry) => geometries.push(geometry as BoxGeometry),
    });

    expect(meshCount).toBe(2);
    expect(parent.children).toHaveLength(2);
    expect(geometries.map((geometry) => geometry.getIndex()?.count).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([6, 12]);
    source.dispose();
    material.dispose();
    geometries.forEach((geometry) => geometry.dispose());
  });
});
