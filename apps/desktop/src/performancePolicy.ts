export const MAX_DRAWING_BUFFER_PIXELS = 2_000_000;
export const MAX_DEVICE_PIXEL_RATIO = 2;
export const MIN_DEVICE_PIXEL_RATIO = 0.5;
export const TARGET_MAX_FRAMES_PER_SECOND = 60;

export interface PixelRatioRequest {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
  readonly maximumPixels?: number;
}

export interface CameraInputCapabilities {
  readonly coarsePointer: boolean;
  readonly hoverUnavailable: boolean;
}

/**
 * Keeps large desktop embeds from creating a disproportionately expensive
 * drawing buffer while retaining up to 2x resolution on smaller viewports.
 */
export function calculateAdaptivePixelRatio(request: PixelRatioRequest): number {
  const width = Math.max(1, finiteOr(request.width, 1));
  const height = Math.max(1, finiteOr(request.height, 1));
  const devicePixelRatio = clamp(
    finiteOr(request.devicePixelRatio, 1),
    MIN_DEVICE_PIXEL_RATIO,
    MAX_DEVICE_PIXEL_RATIO,
  );
  const maximumPixels = Math.max(
    1,
    finiteOr(request.maximumPixels ?? MAX_DRAWING_BUFFER_PIXELS, MAX_DRAWING_BUFFER_PIXELS),
  );
  const budgetRatio = Math.sqrt(maximumPixels / (width * height));
  const ratio = clamp(
    Math.min(devicePixelRatio, budgetRatio),
    MIN_DEVICE_PIXEL_RATIO,
    MAX_DEVICE_PIXEL_RATIO,
  );

  // Avoid tiny ResizeObserver-driven changes repeatedly reallocating WebGL
  // drawing buffers.
  return Math.round(ratio * 100) / 100;
}

/**
 * Fly controls require a keyboard and relative mouse-style look input. Touch
 * devices keep Three.js orbit/pinch controls instead of exposing an unusable
 * mode switch.
 */
export function supportsFlyCamera(capabilities: CameraInputCapabilities): boolean {
  return !capabilities.coarsePointer && !capabilities.hoverUnavailable;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
