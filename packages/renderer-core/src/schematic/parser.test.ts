import { describe, expect, it } from "vitest";
import {
  parseSchematicJson,
  SchematicValidationError,
  unpackSchematicPosition,
} from "./parser";

describe("unpackSchematicPosition", () => {
  it("uses the current x/z/y 10-bit layout", () => {
    const packed = (5 << 20) | (7 << 10) | 3;
    expect(unpackSchematicPosition(packed)).toEqual({ x: 3, y: 5, z: 7 });
  });
});

describe("parseSchematicJson", () => {
  it("normalizes implicit game-domain codes and resolves block instances", () => {
    const parsed = parseSchematicJson(
      JSON.stringify({
        GameVersion: "1.22.5",
        SizeX: 8,
        SizeY: 6,
        SizeZ: 8,
        BlockCodes: { 12: "rock-granite" },
        ItemCodes: {},
        Indices: [(5 << 20) | (7 << 10) | 3],
        BlockIds: [12],
        DecorIndices: [],
        DecorIds: [],
        BlockEntities: {},
        Entities: [],
      }),
    );

    expect(parsed.gameVersion).toBe("1.22.5");
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0]?.code).toBe("game:rock-granite");
    expect(parsed.blocks[0]?.position).toEqual({ x: 3, y: 5, z: 7 });
    expect(parsed.diagnostics.visibleBlockCount).toBe(1);
  });

  it("rejects mismatched sparse block arrays", () => {
    expect(() =>
      parseSchematicJson(
        JSON.stringify({
          SizeX: 1,
          SizeY: 1,
          SizeZ: 1,
          BlockCodes: { 1: "stone-granite" },
          Indices: [0],
          BlockIds: [],
        }),
      ),
    ).toThrow(SchematicValidationError);
  });

  it("decodes decor block, face, subposition, and rotation bits", () => {
    const blockId = 42;
    const face = 3;
    const subPosition = 129;
    const rotation = 5;
    const faceAndSubposition = face + 6 * (subPosition + (rotation << 12));
    const parsed = parseSchematicJson(JSON.stringify({
      SizeX: 1,
      SizeY: 1,
      SizeZ: 1,
      BlockCodes: { 0: "air", [blockId]: "attachingplant-mold" },
      Indices: [],
      BlockIds: [],
      DecorIndices: [0],
      DecorIds: [faceAndSubposition * 0x1000000 + blockId],
    }));

    expect(parsed.decors[0]).toMatchObject({
      schematicBlockId: blockId,
      code: "game:attachingplant-mold",
      faceIndex: face,
      subPosition,
      rotation,
    });
  });
});
