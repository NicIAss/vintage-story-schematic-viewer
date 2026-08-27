import { describe, expect, it } from "vitest";
import {
  calculateAdaptivePixelRatio,
  MAX_DRAWING_BUFFER_PIXELS,
  supportsFlyCamera,
} from "./performancePolicy.js";

describe("calculateAdaptivePixelRatio", () => {
  it("keeps high density rendering for a small mobile viewport", () => {
    expect(calculateAdaptivePixelRatio({
      width: 390,
      height: 700,
      devicePixelRatio: 3,
    })).toBe(2);
  });

  it("limits the physical pixel count of a large desktop embed", () => {
    const ratio = calculateAdaptivePixelRatio({
      width: 2560,
      height: 1440,
      devicePixelRatio: 2,
    });
    expect(ratio).toBeCloseTo(0.74, 2);
    expect(2560 * 1440 * ratio * ratio).toBeLessThanOrEqual(
      MAX_DRAWING_BUFFER_PIXELS * 1.02,
    );
  });

  it("does not upscale a normal density desktop viewport", () => {
    expect(calculateAdaptivePixelRatio({
      width: 1280,
      height: 720,
      devicePixelRatio: 1,
    })).toBe(1);
  });

  it("returns a safe ratio for invalid measurements", () => {
    expect(calculateAdaptivePixelRatio({
      width: Number.NaN,
      height: 0,
      devicePixelRatio: Number.NaN,
    })).toBe(1);
  });
});

describe("supportsFlyCamera", () => {
  it("keeps fly mode for a mouse and keyboard environment", () => {
    expect(supportsFlyCamera({
      coarsePointer: false,
      hoverUnavailable: false,
    })).toBe(true);
  });

  it("disables fly mode for touch-oriented input", () => {
    expect(supportsFlyCamera({
      coarsePointer: true,
      hoverUnavailable: true,
    })).toBe(false);
  });
});
