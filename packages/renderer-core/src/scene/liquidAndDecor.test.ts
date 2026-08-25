import { describe, expect, it } from "vitest";
import type { CompiledBlockDefinition } from "../assets/types";
import type { SchematicDecor } from "../schematic/types";
import { decorRotationRadians, liquidPreviewHeight } from "./createSchematicScene";

describe("liquid and decor preview rules", () => {
  it("uses eighth-block liquid levels and full-height waterfall columns", () => {
    const definition = (flow: string, height: string): CompiledBlockDefinition => ({
      variant: { flow, height },
    }) as unknown as CompiledBlockDefinition;

    expect(liquidPreviewHeight(definition("still", "7"))).toBe(0.875);
    expect(liquidPreviewHeight(definition("n", "3"))).toBe(0.375);
    expect(liquidPreviewHeight(definition("d", "6"))).toBe(1);
  });

  it("keeps saved zero-rotation decors aligned when randomization is disabled", () => {
    const decor = { rotation: 0 } as SchematicDecor;
    expect(decorRotationRadians(decor, false)).toBe(0);
  });
});
