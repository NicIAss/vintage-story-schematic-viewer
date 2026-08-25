import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSchematicJson } from "./parser";

const fixtureUrl = new URL(
  "../../../../_local/game/assets/survival/worldgen/schematics/underground/medium/m-noble-room.json",
  import.meta.url,
);
const fixturePath = fileURLToPath(fixtureUrl);

describe.skipIf(!existsSync(fixturePath))("local real schematic fixture", () => {
  it("parses m-noble-room with the inspected diagnostics", () => {
    const parsed = parseSchematicJson(readFileSync(fixturePath, "utf8"));

    expect(parsed.gameVersion).toBe("1.22.0-rc.7");
    expect(parsed.size).toEqual({ x: 16, y: 8, z: 16 });
    expect(parsed.diagnostics.blockCount).toBe(1278);
    expect(parsed.diagnostics.mappedBlockCodeCount).toBe(60);
    expect(parsed.diagnostics.mappedItemCodeCount).toBe(13);
    expect(parsed.diagnostics.decorCount).toBe(180);
    expect(parsed.diagnostics.blockEntityCount).toBe(179);
    expect(parsed.diagnostics.entityCount).toBe(0);
  });
});
