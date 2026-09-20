import { BoxGeometry } from "three";
import { describe, expect, it } from "vitest";
import { createSurfaceDecorGeometry } from "./surfaceDecorGeometry";

describe("surface decor geometry", () => {
  it("follows a partial host block instead of filling the block cell", () => {
    const host = new BoxGeometry(0.25, 0.5, 0.75);
    host.translate(0.125, -0.2, 0.05);
    const decor = createSurfaceDecorGeometry(host, 4);

    expect(decor).not.toBeNull();
    expect(decor?.getAttribute("position").count).toBe(6);
    expect(decor?.boundingBox?.min.x).toBeCloseTo(0, 5);
    expect(decor?.boundingBox?.max.x).toBeCloseTo(0.25, 5);
    expect(decor?.boundingBox?.min.z).toBeCloseTo(-0.325, 5);
    expect(decor?.boundingBox?.max.z).toBeCloseTo(0.425, 5);
    expect(decor?.boundingBox?.min.y).toBeCloseTo(0.0515, 5);
    expect(decor?.boundingBox?.max.y).toBeCloseTo(0.0515, 5);

    decor?.dispose();
    host.dispose();
  });

  it("selects only triangles that face the saved decor side", () => {
    const host = new BoxGeometry(0.25, 0.5, 0.75);
    const east = createSurfaceDecorGeometry(host, 1);
    const positions = east?.getAttribute("position");

    expect(positions?.count).toBe(6);
    for (let index = 0; index < (positions?.count ?? 0); index += 1) {
      expect(positions?.getX(index)).toBeCloseTo(0.1265, 5);
    }

    east?.dispose();
    host.dispose();
  });
});
