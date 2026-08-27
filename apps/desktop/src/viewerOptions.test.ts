import { describe, expect, it } from "vitest";
import { DEFAULT_VIEWER_OPTIONS, readViewerOptions } from "./viewerOptions";

describe("viewer options", () => {
  it("hides meta and unresolved blocks by default", () => {
    expect(DEFAULT_VIEWER_OPTIONS.metaBlocks).toBe(false);
    expect(DEFAULT_VIEWER_OPTIONS.unresolvedBlocks).toBe(false);
    expect(readViewerOptions("").unresolvedBlocks).toBe(false);
  });

  it("allows embedded sites to opt into unresolved debug geometry", () => {
    expect(readViewerOptions("?unresolved=on").unresolvedBlocks).toBe(true);
    expect(readViewerOptions("?unresolved=off").unresolvedBlocks).toBe(false);
  });
});
