import { describe, expect, it } from "vitest";
import type { CompiledBlockDefinition } from "../assets/types";
import { shouldApplyPreviewColorTint } from "./createSchematicScene";

function definition(ignoreTintInventory: boolean): CompiledBlockDefinition {
  return { ignoreTintInventory } as CompiledBlockDefinition;
}

describe("inventory color tinting", () => {
  it("preserves fertility-specific soil pixels when the asset opts out of inventory tint", () => {
    expect(shouldApplyPreviewColorTint(definition(true))).toBe(false);
  });

  it("keeps tinting ordinary foliage and explicit per-element color maps", () => {
    expect(shouldApplyPreviewColorTint(definition(false))).toBe(true);
    expect(shouldApplyPreviewColorTint(definition(true), true)).toBe(true);
  });
});
