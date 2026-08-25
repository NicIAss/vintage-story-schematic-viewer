import { describe, expect, it } from "vitest";
import { coalPileHeight } from "./coalPiles";

describe("coalPileHeight", () => {
  it("matches the game's two-voxel minimum layer", () => {
    expect(coalPileHeight(1)).toBe(0.125);
    expect(coalPileHeight(2)).toBe(0.125);
  });

  it("grows by the stored stack size up to a full block", () => {
    expect(coalPileHeight(4)).toBe(0.25);
    expect(coalPileHeight(12)).toBe(0.75);
    expect(coalPileHeight(16)).toBe(1);
    expect(coalPileHeight(64)).toBe(1);
  });
});
