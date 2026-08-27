import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createSupportBeamSegments, decodeSupportBeamArray } from "./supportBeams";

function bytesFromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g)?.map((value) => Number.parseInt(value, 16)) ?? []);
}

describe("support beam schematic data", () => {
  it("decodes protobuf-net PlacedBeam arrays from a real 1.22 schematic", () => {
    const beams = decodeSupportBeamArray(bytesFromHex(
      "0a200a0a150000803f1d0000803f120f0d0000a03f150100003f1d0000803f18df2e",
    ));
    expect(beams).toEqual([{
      start: [0, 1, 1],
      end: [1.25, expect.closeTo(0.5000000596046448), 1],
      blockId: 5983,
      facingIndex: 0,
    }]);
  });

  it("segments long and diagonal beams instead of using one fixed horizontal block", () => {
    const segments = createSupportBeamSegments({
      start: [0, 1, 1],
      end: [2.5, 0, 1],
    });
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.every((segment) => segment.shapeIndex >= 0 && segment.shapeIndex <= 3)).toBe(true);
    expect(segments.every((segment) => segment.matrix.elements.every(Number.isFinite))).toBe(true);
  });

  it("uses the single stretchable model for beams without partial end shapes", () => {
    const segments = createSupportBeamSegments({
      start: [0, 0, 0],
      end: [2.25, 0.5, 0],
    }, false);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.every((segment) => segment.shapeIndex === 0)).toBe(true);
  });

  it("does not shift a short partial beam beyond its stored endpoints", () => {
    const segments = createSupportBeamSegments({
      start: [0.5, 0.5, 0],
      end: [0.5, 0.5, 1],
    });
    expect(segments).toHaveLength(1);

    // Centered X coordinates -0.5 and 0.5 are the two ends of the compiled
    // full-length model. They must map onto the stored Z range 0 through 1.
    const matrix = segments[0]?.matrix;
    expect(matrix).toBeDefined();
    const mappedZ = [-0.5, 0.5]
      .map((x) => new Vector3(x, -0.375, 0).applyMatrix4(matrix!).z)
      .sort((left, right) => left - right);
    expect(mappedZ[0]).toBeCloseTo(0);
    expect(mappedZ[1]).toBeCloseTo(1);
  });
});
