export const VIEWER_VERSION = "0.1.0";

export interface ViewerOptions {
  readonly grid: boolean;
  readonly bounds: boolean;
  readonly metaBlocks: boolean;
}

export interface GifExportOptions {
  readonly size?: number;
  readonly frameCount?: number;
  readonly framesPerSecond?: number;
  readonly includeGrid?: boolean;
  readonly includeBounds?: boolean;
  readonly includeMetaBlocks?: boolean;
}

export interface ViewerEmbedApi {
  readonly version: string;
  getOptions(): ViewerOptions;
  setOptions(options: Partial<ViewerOptions>): ViewerOptions;
  loadSchematicJson(jsonText: string, fileName?: string): Promise<void>;
  loadSchematicUrl(url: string): Promise<void>;
  exportGif(options?: GifExportOptions): Promise<Blob>;
}

export const DEFAULT_VIEWER_OPTIONS: ViewerOptions = {
  grid: true,
  bounds: true,
  metaBlocks: false,
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
  };
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
