import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEWER_OPTIONS,
  readViewerOptions,
  readViewerPresentationOptions,
} from "./viewerOptions";

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

  it("preserves the full standalone toolbar by default", () => {
    const presentation = readViewerPresentationOptions("");
    expect(presentation.mode).toBe("standalone");
    expect(presentation.controls).toEqual([
      "open",
      "grid",
      "bounds",
      "export",
      "meta",
      "unresolved",
      "flight",
      "recenter",
      "top",
    ]);
  });

  it("locks local files in embed mode and supports an allowlist of controls", () => {
    expect(
      readViewerPresentationOptions(
        "?mode=embed&controls=open,grid,recenter,top,unknown",
      ),
    ).toEqual({
      mode: "embed",
      controls: ["grid", "recenter", "top"],
    });
  });

  it("supports hiding every toolbar action", () => {
    expect(readViewerPresentationOptions("?mode=embed&controls=none")).toEqual({
      mode: "embed",
      controls: [],
    });
  });
});
