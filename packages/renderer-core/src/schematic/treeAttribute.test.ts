import { describe, expect, it } from "vitest";
import { decodeAscii85, decodeTreeAttribute } from "./treeAttribute";

describe("Ascii85", () => {
  it("matches Vintage Story's zero block and partial-block rules", () => {
    expect([...decodeAscii85("z")]).toEqual([0, 0, 0, 0]);
    expect([...decodeAscii85("!!")]).toEqual([0]);
  });
});

describe("TreeAttribute", () => {
  it("decodes .NET strings, primitive values, arrays, and nested trees", () => {
    const bytes = Uint8Array.from([
      1, 1, 120, 42, 0, 0, 0,
      5, 4, 110, 97, 109, 101, 2, 111, 107,
      11, 3, 97, 114, 114, 2, 0, 0, 0, 7, 0, 0, 0, 9, 0, 0, 0,
      6, 5, 99, 104, 105, 108, 100, 9, 4, 102, 108, 97, 103, 1, 0,
      0,
    ]);

    expect(decodeTreeAttribute(bytes)).toEqual({
      x: { type: "int", value: 42 },
      name: { type: "string", value: "ok" },
      arr: { type: "ints", value: [7, 9] },
      child: {
        type: "tree",
        value: { flag: { type: "bool", value: true } },
      },
    });
  });
});
