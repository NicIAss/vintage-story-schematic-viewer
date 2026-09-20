import { Box3, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { calculateOrbitTargetAfterFlight } from "./cameraControls.js";

const bounds = new Box3(
  new Vector3(-10, 0, -10),
  new Vector3(10, 20, 10),
);

describe("calculateOrbitTargetAfterFlight", () => {
  it("restores an orbit pivot at the build depth when the build is in view", () => {
    const target = calculateOrbitTargetAfterFlight({
      cameraPosition: new Vector3(0, 10, 50),
      viewDirection: new Vector3(0, 0, -1),
      contentBounds: bounds,
      previousOrbitDistance: 12,
    });

    expect(target.x).toBeCloseTo(0);
    expect(target.y).toBeCloseTo(10);
    expect(target.z).toBeCloseTo(0);
  });

  it("keeps the previous orbit radius when looking away from the build", () => {
    const target = calculateOrbitTargetAfterFlight({
      cameraPosition: new Vector3(0, 10, 50),
      viewDirection: new Vector3(1, 0, 0),
      contentBounds: bounds,
      previousOrbitDistance: 30,
    });

    expect(target.x).toBeCloseTo(30);
    expect(target.y).toBeCloseTo(10);
    expect(target.z).toBeCloseTo(50);
  });

  it("uses a safe distance when no schematic bounds are available", () => {
    const target = calculateOrbitTargetAfterFlight({
      cameraPosition: new Vector3(2, 3, 4),
      viewDirection: new Vector3(0, 0, -1),
      contentBounds: null,
      previousOrbitDistance: Number.NaN,
    });

    expect(target.toArray()).toEqual([2, 3, 3]);
  });
});
