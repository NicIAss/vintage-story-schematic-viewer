export const VIEWER_VERSION = "0.3.0";

export interface ViewerOptions {
  readonly grid: boolean;
  readonly bounds: boolean;
  readonly metaBlocks: boolean;
  readonly unresolvedBlocks: boolean;
}

export const VIEWER_CONTROL_IDS = [
  "open",
  "grid",
  "bounds",
  "export",
  "meta",
  "unresolved",
  "flight",
  "recenter",
  "top",
] as const;

export type ViewerControlId = (typeof VIEWER_CONTROL_IDS)[number];
export type ViewerMode = "standalone" | "embed";

export interface ViewerPresentationOptions {
  readonly mode: ViewerMode;
  readonly controls: readonly ViewerControlId[];
}

export interface GifExportOptions {
  readonly size?: number;
  readonly frameCount?: number;
  readonly framesPerSecond?: number;
  readonly includeGrid?: boolean;
  readonly includeBounds?: boolean;
  readonly includeMetaBlocks?: boolean;
  readonly includeUnresolvedBlocks?: boolean;
}

export interface ViewerEmbedApi {
  readonly version: string;
  getOptions(): ViewerOptions;
  setOptions(options: Partial<ViewerOptions>): ViewerOptions;
  getPresentationOptions(): ViewerPresentationOptions;
  setPresentationOptions(
    options: Partial<ViewerPresentationOptions>,
  ): ViewerPresentationOptions;
  loadSchematicJson(jsonText: string, fileName?: string): Promise<void>;
  loadSchematicUrl(url: string): Promise<void>;
  exportGif(options?: GifExportOptions): Promise<Blob>;
}

export const DEFAULT_VIEWER_OPTIONS: ViewerOptions = {
  grid: true,
  bounds: true,
  metaBlocks: false,
  unresolvedBlocks: false,
};

export const DEFAULT_VIEWER_PRESENTATION_OPTIONS: ViewerPresentationOptions = {
  mode: "standalone",
  controls: VIEWER_CONTROL_IDS,
};

/**
 * Reads stable embed parameters without consuming unrelated values such as the
 * development fixture path. Examples: ?grid=off&bounds=off&meta=off.
 */
export function readViewerOptions(search: string): ViewerOptions {
  const parameters = new URLSearchParams(search);
  return {
    grid: readBoolean(parameters.get("grid"), DEFAULT_VIEWER_OPTIONS.grid),
    bounds: readBoolean(parameters.get("bounds"), DEFAULT_VIEWER_OPTIONS.bounds),
    metaBlocks: readBoolean(
      parameters.get("meta"),
      DEFAULT_VIEWER_OPTIONS.metaBlocks,
    ),
    unresolvedBlocks: readBoolean(
      parameters.get("unresolved"),
      DEFAULT_VIEWER_OPTIONS.unresolvedBlocks,
    ),
  };
}

/**
 * Reads startup-only UI policy for standalone and cross-origin iframe use.
 * Embed mode removes every local-file entry point, including drag and drop.
 */
export function readViewerPresentationOptions(
  search: string,
): ViewerPresentationOptions {
  const parameters = new URLSearchParams(search);
  const mode: ViewerMode = parameters.get("mode")?.trim().toLowerCase() === "embed"
    ? "embed"
    : "standalone";
  const requestedControls = parseControls(parameters.get("controls"));
  return normalizeViewerPresentationOptions({
    mode,
    controls: requestedControls ?? VIEWER_CONTROL_IDS,
  });
}

export function normalizeViewerPresentationOptions(
  options: ViewerPresentationOptions,
): ViewerPresentationOptions {
  const requestedControls = new Set<string>(options.controls);
  return {
    mode: options.mode === "embed" ? "embed" : "standalone",
    controls: VIEWER_CONTROL_IDS.filter(
      (control) => requestedControls.has(control)
        && !(options.mode === "embed" && control === "open"),
    ),
  };
}

function parseControls(value: string | null): readonly ViewerControlId[] | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "" || normalized === "none") return [];
  if (normalized === "all") return VIEWER_CONTROL_IDS;
  const requested = new Set(normalized.split(",").map((control) => control.trim()));
  return VIEWER_CONTROL_IDS.filter((control) => requested.has(control));
}

function readBoolean(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "on":
    case "yes":
      return true;
    case "0":
    case "false":
    case "off":
    case "no":
      return false;
    default:
      return fallback;
  }
}
