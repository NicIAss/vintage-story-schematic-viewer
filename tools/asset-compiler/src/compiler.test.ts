import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileAssetRegistry,
  extractLegacyRemaps,
  solveByTypeAndPlaceholders,
  wildcardMatch,
} from "./compiler.js";

describe("latest registry resolution rules", () => {
  it("can emit a portable registry with website texture URLs", async () => {
    const assetRoot = await mkdtemp(path.join(tmpdir(), "vs-asset-compiler-"));
    try {
      const blockTypeRoot = path.join(assetRoot, "survival", "blocktypes");
      const textureRoot = path.join(assetRoot, "survival", "textures", "block");
      await mkdir(blockTypeRoot, { recursive: true });
      await mkdir(textureRoot, { recursive: true });
      await writeFile(
        path.join(blockTypeRoot, "portabletest.json"),
        `{ code: "portabletest", drawtype: "cube", textures: { all: { base: "block/portabletest" } } }`,
        "utf8",
      );
      await writeFile(path.join(textureRoot, "portabletest.png"), "fixture", "utf8");

      const registry = await compileAssetRegistry(assetRoot, {
        portable: true,
        textureBaseUrl: "https://cdn.example.test/vs-assets/1.22.5/",
      });

      expect(registry.assetRoot).toBe(".");
      expect(registry.blocks["game:portabletest"]?.cubeTextures?.up.base.url).toBe(
        "https://cdn.example.test/vs-assets/1.22.5/survival/textures/block/portabletest.png",
      );
    } finally {
      await rm(assetRoot, { recursive: true, force: true });
    }
  });

  it("uses the first matching ByType entry then fills variant placeholders", () => {
    const source = {
      texturesByType: {
        "rock-*": { all: { base: "block/stone/rock/{rock}*" } },
        "*": { all: { base: "fallback" } },
      },
    };

    expect(solveByTypeAndPlaceholders(source, "rock-granite", { rock: "granite" })).toEqual({
      textures: { all: { base: "block/stone/rock/granite*" } },
    });
  });

  it("supports game regex patterns as well as glob patterns", () => {
    expect(wildcardMatch("rock-*", "rock-granite")).toBe(true);
    expect(wildcardMatch("@rock-(granite|basalt)", "rock-basalt")).toBe(true);
    expect(wildcardMatch("@rock-(granite|basalt)", "rock-chalk")).toBe(false);
  });

  it("reads block remapper commands in their new-code old-code order", () => {
    expect(extractLegacyRemaps({
      "game:v1.22.0": [
        "/bir remapq ladder-wood-oak-north ladder-wood-north force",
        "/bir remapq game:lantern-large-down game:lantern-down force",
      ],
    })).toEqual([
      {
        currentCode: "game:ladder-wood-oak-north",
        legacyCode: "game:ladder-wood-north",
      },
      {
        currentCode: "game:lantern-large-down",
        legacyCode: "game:lantern-down",
      },
    ]);
  });
});
