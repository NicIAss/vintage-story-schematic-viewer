import { GIFEncoder, applyPalette, quantize } from "gifenc";
import {
  Box3,
  Box3Helper,
  GridHelper,
  MathUtils,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import type { ParsedSchematic } from "@vs-schematic/renderer-core";
import type { GifExportOptions } from "./viewerOptions.js";

const DEFAULT_SIZE = 560;
const DEFAULT_FRAME_COUNT = 42;
const DEFAULT_FRAMES_PER_SECOND = 14;
const DEFAULT_PALETTE_SIZE = 64;
const AUTO_FRAME_SAMPLE_SIZE = 160;
const AUTO_FRAME_SAMPLE_COUNT = 18;
const AUTO_FRAME_TARGET_SPAN = 0.82;
const AUTO_FRAME_SAFE_EXTENT = 0.96;
const AUTO_FRAME_ITERATIONS = 3;

interface GifSceneCapture {
  readonly scene: Scene;
  readonly schematic: ParsedSchematic;
  readonly grid: GridHelper;
  readonly bounds: Box3Helper | null;
  readonly contentBounds: Box3;
  readonly metaBlockCodes: ReadonlySet<string>;
}

interface PreviewOrbit {
  readonly distance: number;
  readonly horizontalDistance: number;
  readonly verticalDistance: number;
}

export async function exportRotatingGif(
  capture: GifSceneCapture,
  options: GifExportOptions = {},
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  const size = clampInteger(options.size ?? DEFAULT_SIZE, 128, 1024);
  const frameCount = clampInteger(
    options.frameCount ?? DEFAULT_FRAME_COUNT,
    12,
    90,
  );
  const framesPerSecond = clampInteger(
    options.framesPerSecond ?? DEFAULT_FRAMES_PER_SECOND,
    4,
    30,
  );
  const frameDelay = Math.round(1000 / framesPerSecond);
  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setPixelRatio(1);
  const contentBounds = capture.contentBounds.isEmpty()
    ? schematicBounds(capture.schematic)
    : capture.contentBounds;
  const includeMetaBlocks = options.includeMetaBlocks ?? false;
  const target = previewTarget(
    capture.schematic,
    contentBounds,
    includeMetaBlocks,
    capture.metaBlockCodes,
  );
  const initialOrbit = previewOrbit(contentBounds);
  const camera = createPreviewCamera(contentBounds, initialOrbit);
  const previousGridVisibility = capture.grid.visible;
  const previousBoundsVisibility = capture.bounds?.visible;
  capture.grid.visible = options.includeGrid ?? false;
  if (capture.bounds !== null) {
    capture.bounds.visible = options.includeBounds ?? false;
  }

  try {
    onProgress?.(0);
    const orbit = await autoFrameOrbit(
      renderer,
      capture.scene,
      camera,
      target,
      initialOrbit,
    );
    renderer.setSize(size, size, false);

    const captureCanvas = document.createElement("canvas");
    captureCanvas.width = size;
    captureCanvas.height = size;
    const context = captureCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (context === null) {
      throw new Error("The browser could not create a GIF capture canvas.");
    }
    const gif = GIFEncoder({ initialCapacity: size * size });

    for (let frame = 0; frame < frameCount; frame += 1) {
      const angle = Math.PI / 4 + (frame / frameCount) * Math.PI * 2;
      positionOrbitCamera(camera, target, orbit, angle);
      renderer.render(capture.scene, camera);
      context.clearRect(0, 0, size, size);
      context.drawImage(renderer.domElement, 0, 0, size, size);
      const pixels = context.getImageData(0, 0, size, size).data;
      const palette = quantize(pixels, DEFAULT_PALETTE_SIZE, {
        format: "rgb565",
      });
      const indexed = applyPalette(pixels, palette, "rgb565");
      gif.writeFrame(indexed, size, size, {
        palette,
        delay: frameDelay,
        repeat: 0,
      });
      onProgress?.((frame + 1) / frameCount);
      if (frame % 3 === 2) await yieldToPage();
    }
    gif.finish();
    const bytes = gif.bytes();
    const output = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return new Blob([output], { type: "image/gif" });
  } finally {
    capture.grid.visible = previousGridVisibility;
    if (capture.bounds !== null && previousBoundsVisibility !== undefined) {
      capture.bounds.visible = previousBoundsVisibility;
    }
    renderer.dispose();
  }
}

function createPreviewCamera(
  bounds: Box3,
  orbit: PreviewOrbit,
): PerspectiveCamera {
  const radius = boundsRadius(bounds);
  const camera = new PerspectiveCamera(
    36,
    1,
    0.05,
    orbit.distance + radius * 4 + 16,
  );
  camera.updateProjectionMatrix();
  return camera;
}

function previewOrbit(bounds: Box3): PreviewOrbit {
  const radius = boundsRadius(bounds);
  const distance = Math.max(
    4,
    (radius / Math.sin(MathUtils.degToRad(36 / 2))) * 1.12,
  );
  const size = bounds.getSize(new Vector3());
  const horizontalSpan = Math.max(size.x, size.z, 1);
  const tallness = size.y / horizontalSpan;
  const elevation = MathUtils.degToRad(
    MathUtils.clamp(24 + (tallness - 1) * 7, 22, 38),
  );
  return {
    distance,
    horizontalDistance: Math.cos(elevation) * distance,
    verticalDistance: Math.sin(elevation) * distance,
  };
}

async function autoFrameOrbit(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  target: Vector3,
  initialOrbit: PreviewOrbit,
): Promise<PreviewOrbit> {
  const analysisCanvas = document.createElement("canvas");
  analysisCanvas.width = AUTO_FRAME_SAMPLE_SIZE;
  analysisCanvas.height = AUTO_FRAME_SAMPLE_SIZE;
  const context = analysisCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (context === null) return initialOrbit;

  const previousBackground = scene.background;
  let orbit = initialOrbit;
  renderer.setSize(AUTO_FRAME_SAMPLE_SIZE, AUTO_FRAME_SAMPLE_SIZE, false);
  renderer.setClearColor(0x000000, 0);
  scene.background = null;

  try {
    for (let iteration = 0; iteration < AUTO_FRAME_ITERATIONS; iteration += 1) {
      let measuredSpan = 0;
      let measuredCenteredExtent = 0;
      for (let sample = 0; sample < AUTO_FRAME_SAMPLE_COUNT; sample += 1) {
        const angle =
          Math.PI / 4 + (sample / AUTO_FRAME_SAMPLE_COUNT) * Math.PI * 2;
        positionOrbitCamera(camera, target, orbit, angle);
        renderer.render(scene, camera);
        context.clearRect(
          0,
          0,
          AUTO_FRAME_SAMPLE_SIZE,
          AUTO_FRAME_SAMPLE_SIZE,
        );
        context.drawImage(
          renderer.domElement,
          0,
          0,
          AUTO_FRAME_SAMPLE_SIZE,
          AUTO_FRAME_SAMPLE_SIZE,
        );
        const pixels = context.getImageData(
          0,
          0,
          AUTO_FRAME_SAMPLE_SIZE,
          AUTO_FRAME_SAMPLE_SIZE,
        ).data;
        const metrics = alphaSilhouetteMetrics(
          pixels,
          AUTO_FRAME_SAMPLE_SIZE,
        );
        measuredSpan = Math.max(measuredSpan, metrics.span);
        measuredCenteredExtent = Math.max(
          measuredCenteredExtent,
          metrics.centeredExtent,
        );
      }
      if (measuredSpan <= 0) return initialOrbit;

      const distanceScale = MathUtils.clamp(
        Math.max(
          measuredSpan / AUTO_FRAME_TARGET_SPAN,
          measuredCenteredExtent / AUTO_FRAME_SAFE_EXTENT,
        ),
        0.75,
        1.12,
      );
      orbit = scaleOrbit(orbit, distanceScale);
      await yieldToPage();
    }
    return orbit;
  } finally {
    scene.background = previousBackground;
    renderer.setClearAlpha(1);
  }
}

function alphaSilhouetteMetrics(
  pixels: Uint8ClampedArray,
  size: number,
): { readonly span: number; readonly centeredExtent: number } {
  let minimumX = size;
  let minimumY = size;
  let maximumX = -1;
  let maximumY = -1;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if ((pixels[(y * size + x) * 4 + 3] ?? 0) < 8) continue;
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
    }
  }

  if (maximumX < minimumX || maximumY < minimumY) {
    return { span: 0, centeredExtent: 0 };
  }
  const center = size / 2;
  const farthestFromCenter = Math.max(
    center - minimumX,
    maximumX + 1 - center,
    center - minimumY,
    maximumY + 1 - center,
  );
  return {
    span:
      Math.max(maximumX - minimumX + 1, maximumY - minimumY + 1) / size,
    centeredExtent: (farthestFromCenter * 2) / size,
  };
}

function scaleOrbit(orbit: PreviewOrbit, scale: number): PreviewOrbit {
  return {
    distance: Math.max(2, orbit.distance * scale),
    horizontalDistance: Math.max(0.1, orbit.horizontalDistance * scale),
    verticalDistance: orbit.verticalDistance * scale,
  };
}

function positionOrbitCamera(
  camera: PerspectiveCamera,
  target: Vector3,
  orbit: PreviewOrbit,
  angle: number,
): void {
  camera.position.set(
    target.x + Math.cos(angle) * orbit.horizontalDistance,
    target.y + orbit.verticalDistance,
    target.z + Math.sin(angle) * orbit.horizontalDistance,
  );
  camera.lookAt(target);
}

function schematicBounds(schematic: ParsedSchematic): Box3 {
  return new Box3(
    new Vector3(-schematic.size.x / 2, 0, -schematic.size.z / 2),
    new Vector3(
      schematic.size.x / 2,
      schematic.size.y,
      schematic.size.z / 2,
    ),
  );
}

function previewTarget(
  schematic: ParsedSchematic,
  bounds: Box3,
  includeMetaBlocks: boolean,
  metaBlockCodes: ReadonlySet<string>,
): Vector3 {
  const boundsCenter = bounds.getCenter(new Vector3());
  const average = new Vector3();
  let visibleBlockCount = 0;
  for (const block of schematic.blocks) {
    if (
      block.code === "game:air" ||
      (!includeMetaBlocks && metaBlockCodes.has(block.code))
    ) {
      continue;
    }
    average.x += block.position.x - schematic.size.x / 2 + 0.5;
    average.y += block.position.y + 0.5;
    average.z += block.position.z - schematic.size.z / 2 + 0.5;
    visibleBlockCount += 1;
  }
  if (visibleBlockCount === 0) return boundsCenter;

  average.multiplyScalar(1 / visibleBlockCount);
  return new Vector3(
    MathUtils.clamp(average.x, bounds.min.x, bounds.max.x),
    MathUtils.clamp(
      MathUtils.lerp(boundsCenter.y, average.y, 0.35),
      bounds.min.y,
      bounds.max.y,
    ),
    MathUtils.clamp(average.z, bounds.min.z, bounds.max.z),
  );
}

function boundsRadius(bounds: Box3): number {
  return Math.max(0.5, bounds.getSize(new Vector3()).length() / 2);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.round(MathUtils.clamp(value, minimum, maximum));
}

function yieldToPage(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
