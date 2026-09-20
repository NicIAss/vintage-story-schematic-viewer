import {
  AmbientLight,
  Box3,
  Box3Helper,
  Color,
  DirectionalLight,
  Euler,
  GridHelper,
  HemisphereLight,
  type Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  createSchematicScene,
  parseSchematicJson,
  type AssetRegistry,
  type ParsedSchematic,
  type SchematicScene,
} from "@vs-schematic/renderer-core";
import {
  VIEWER_VERSION,
  normalizeViewerPresentationOptions,
  readViewerPresentationOptions,
  readViewerOptions,
  type GifExportOptions,
  type ViewerControlId,
  type ViewerEmbedApi,
  type ViewerOptions,
  type ViewerPresentationOptions,
} from "./viewerOptions.js";
import {
  calculateAdaptivePixelRatio,
  supportsFlyCamera,
  TARGET_MAX_FRAMES_PER_SECOND,
} from "./performancePolicy.js";
import "./style.css";

const MAX_REMOTE_SCHEMATIC_BYTES = 16 * 1024 * 1024;
const MIN_FRAME_INTERVAL_MS = 1000 / TARGET_MAX_FRAMES_PER_SECOND;
const startupParameters = new URLSearchParams(window.location.search);
const fixturePath = import.meta.env.DEV ? startupParameters.get("fixture") : null;
const remoteSchematicUrl = startupParameters.get("schematic");
const initialPresentationOptions = readViewerPresentationOptions(
  window.location.search,
);
const initiallyVisibleControls = new Set(initialPresentationOptions.controls);
const initialToolbarHidden = initialPresentationOptions.controls.length === 0
  ? " hidden"
  : "";
const initialInspectorHidden = initialPresentationOptions.inspector ? "" : " hidden";
const initialEmptyTitle = initialPresentationOptions.mode === "embed"
  ? remoteSchematicUrl === null && fixturePath === null
    ? "Waiting for the host website"
    : "Loading schematic"
  : "Drop a Vintage Story schematic here";
const initialEmptyDescription = initialPresentationOptions.mode === "embed"
  ? remoteSchematicUrl === null && fixturePath === null
    ? "This embedded viewer accepts schematics from its host page."
    : "The website selected this schematic preview."
  : "Open any local JSON schematic. Game assets remain on this computer.";

function initiallyHidden(control: ViewerControlId): string {
  return initiallyVisibleControls.has(control) ? "" : " hidden";
}

declare global {
  interface Window {
    vsSchematicViewer: ViewerEmbedApi;
  }
}

const app = document.querySelector<HTMLDivElement>("#app");
if (app === null) {
  throw new Error("Missing application root.");
}

app.innerHTML = [
  '<main class="app-shell">',
  '  <header class="toolbar">',
  '    <div class="brand">',
  `      <div><strong>Schematic Viewer</strong><small>v${VIEWER_VERSION}</small></div>`,
  "    </div>",
  `    <div id="toolbar-actions" class="toolbar-actions"${initialToolbarHidden}>`,
  `      <input id="schematic-input" type="file" accept=".json,application/json" hidden${initialPresentationOptions.mode === "embed" ? " disabled" : ""} />`,
  `      <button id="open-button" class="button button-primary" type="button"${initiallyHidden("open")}>Open schematic</button>`,
  `      <button id="grid-button" class="button button-toggle" type="button" aria-pressed="true"${initiallyHidden("grid")}>Grid: On</button>`,
  `      <button id="bounds-button" class="button button-toggle" type="button" aria-pressed="true"${initiallyHidden("bounds")}>Bounds: On</button>`,
  `      <button id="export-button" class="button" type="button" disabled${initiallyHidden("export")}>Export GIF</button>`,
  `      <button id="meta-button" class="button button-toggle" type="button" aria-pressed="false" disabled${initiallyHidden("meta")}>Show meta blocks</button>`,
  `      <button id="unresolved-button" class="button button-toggle" type="button" aria-pressed="false" disabled${initiallyHidden("unresolved")}>Show unresolved</button>`,
  `      <button id="flight-button" class="button button-toggle" type="button" aria-pressed="false" disabled${initiallyHidden("flight")}>Fly camera</button>`,
  `      <button id="recenter-button" class="button" type="button" disabled${initiallyHidden("recenter")}>Recenter</button>`,
  `      <button id="top-button" class="button" type="button" disabled${initiallyHidden("top")}>Top view</button>`,
  `      <button id="info-button" class="button button-toggle" type="button" aria-controls="inspector" aria-expanded="false"${initiallyHidden("info")}>Show info</button>`,
  "    </div>",
  "  </header>",
  `  <section id="workspace" class="workspace${initialPresentationOptions.inspector ? "" : " is-inspector-hidden"}">`,
  '    <div id="viewport" class="viewport" aria-label="3D schematic viewport">',
  '      <div id="empty-state" class="empty-state">',
  '        <div class="empty-icon">◇</div>',
  `        <h1 id="empty-title">${initialEmptyTitle}</h1>`,
  `        <p id="empty-description">${initialEmptyDescription}</p>`,
  `        <button id="empty-open-button" class="button button-primary" type="button"${initiallyHidden("open")}>Choose schematic</button>`,
  "      </div>",
  '      <div id="drop-overlay" class="drop-overlay">Release to inspect schematic</div>',
  '      <div id="flight-hint" class="flight-hint">Click the viewport · WASD move · Space/Shift vertical · Ctrl boost · Esc frees cursor</div>',
  '      <div id="loading-overlay" class="loading-overlay" role="status" aria-live="polite" aria-atomic="true" hidden>',
  '        <div class="loading-card">',
  '          <div class="loading-heading"><strong id="loading-label">Loading schematic…</strong><span id="loading-percent">0%</span></div>',
  '          <div id="loading-track" class="loading-track" role="progressbar" aria-label="Schematic loading progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">',
  '            <div id="loading-fill" class="loading-fill"></div>',
  "          </div>",
  '          <span class="loading-note">Large schematics may take a moment while textures and shapes are prepared.</span>',
  "        </div>",
  "      </div>",
  "    </div>",
  `    <aside id="inspector" class="inspector"${initialInspectorHidden}>`,
  '      <section class="inspector-section file-section">',
  '        <span class="eyebrow">Loaded schematic</span>',
  '        <h2 id="file-name">Nothing loaded</h2>',
  '        <p id="file-version" class="muted">Waiting for a local JSON file</p>',
  "      </section>",
  '      <section class="inspector-section">',
  '        <h3>Structure</h3>',
  '        <dl id="structure-stats" class="stats-list">',
  '          <div><dt>Dimensions</dt><dd>—</dd></div>',
  '          <div><dt>Block entries</dt><dd>—</dd></div>',
  '          <div><dt>Unique mappings</dt><dd>—</dd></div>',
  "        </dl>",
  "      </section>",
  '      <section class="inspector-section">',
  '        <h3>Special data</h3>',
  '        <dl id="special-stats" class="stats-list">',
  '          <div><dt>Decors</dt><dd>—</dd></div>',
  '          <div><dt>Block entities</dt><dd>—</dd></div>',
  '          <div><dt>Entities</dt><dd>—</dd></div>',
  "        </dl>",
  "      </section>",
  '      <section class="inspector-section">',
  '        <h3>Schematic rendering</h3>',
  '        <p class="section-note">Placement counts are for this schematic. Hidden meta blocks remain resolved so they can be shown again.</p>',
  '        <dl id="asset-stats" class="stats-list">',
  '          <div><dt>Textured blocks</dt><dd>—</dd></div>',
  '          <div><dt>Unresolved blocks</dt><dd>—</dd></div>',
  '          <div><dt>Textures loaded</dt><dd>—</dd></div>',
  "        </dl>",
  "      </section>",
  '      <section class="inspector-section">',
  '        <h3>Unresolved blocks</h3>',
  '        <div id="unsupported-list" class="unsupported-list muted">No schematic loaded.</div>',
  "      </section>",
  '      <section class="inspector-section warnings-section">',
  '        <h3>Parser report</h3>',
  '        <div id="parser-report" class="report report-idle">No schematic parsed yet.</div>',
  "      </section>",
  "    </aside>",
  "  </section>",
  '  <footer class="statusbar">',
  '    <span id="status-message">Ready</span>',
  '    <span id="render-stats">0 draw calls · 0 triangles</span>',
  "  </footer>",
  "</main>",
].join("");

const viewportElement = requireElement<HTMLDivElement>("viewport");
const workspaceElement = requireElement<HTMLElement>("workspace");
const toolbarActions = requireElement<HTMLDivElement>("toolbar-actions");
const inputElement = requireElement<HTMLInputElement>("schematic-input");
const openButton = requireElement<HTMLButtonElement>("open-button");
const gridButton = requireElement<HTMLButtonElement>("grid-button");
const boundsButton = requireElement<HTMLButtonElement>("bounds-button");
const exportButton = requireElement<HTMLButtonElement>("export-button");
const metaButton = requireElement<HTMLButtonElement>("meta-button");
const unresolvedButton = requireElement<HTMLButtonElement>("unresolved-button");
const flightButton = requireElement<HTMLButtonElement>("flight-button");
const emptyOpenButton = requireElement<HTMLButtonElement>("empty-open-button");
const recenterButton = requireElement<HTMLButtonElement>("recenter-button");
const topButton = requireElement<HTMLButtonElement>("top-button");
const infoButton = requireElement<HTMLButtonElement>("info-button");
const inspectorElement = requireElement<HTMLElement>("inspector");
const emptyState = requireElement<HTMLDivElement>("empty-state");
const emptyTitle = requireElement<HTMLElement>("empty-title");
const emptyDescription = requireElement<HTMLElement>("empty-description");
const dropOverlay = requireElement<HTMLDivElement>("drop-overlay");
const fileNameElement = requireElement<HTMLElement>("file-name");
const fileVersionElement = requireElement<HTMLElement>("file-version");
const structureStats = requireElement<HTMLElement>("structure-stats");
const specialStats = requireElement<HTMLElement>("special-stats");
const parserReport = requireElement<HTMLElement>("parser-report");
const assetStats = requireElement<HTMLElement>("asset-stats");
const unsupportedList = requireElement<HTMLElement>("unsupported-list");
const statusMessage = requireElement<HTMLElement>("status-message");
const renderStats = requireElement<HTMLElement>("render-stats");
const flightHint = requireElement<HTMLElement>("flight-hint");
const loadingOverlay = requireElement<HTMLDivElement>("loading-overlay");
const loadingLabel = requireElement<HTMLElement>("loading-label");
const loadingPercent = requireElement<HTMLElement>("loading-percent");
const loadingTrack = requireElement<HTMLDivElement>("loading-track");
const loadingFill = requireElement<HTMLDivElement>("loading-fill");
const controlElements: Readonly<Record<ViewerControlId, readonly HTMLElement[]>> = {
  open: [openButton, emptyOpenButton],
  grid: [gridButton],
  bounds: [boundsButton],
  export: [exportButton],
  meta: [metaButton],
  unresolved: [unresolvedButton],
  flight: [flightButton],
  recenter: [recenterButton],
  top: [topButton],
  info: [infoButton],
};
const toolbarControlElements = [
  openButton,
  gridButton,
  boundsButton,
  exportButton,
  metaButton,
  unresolvedButton,
  flightButton,
  recenterButton,
  topButton,
  infoButton,
] as const;

const scene = new Scene();
scene.background = new Color(0x151814);

const camera = new PerspectiveCamera(42, 1, 0.05, 4096);
camera.position.set(18, 14, 18);

const renderer = new WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance",
});
renderer.outputColorSpace = SRGBColorSpace;
viewportElement.prepend(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.target.set(0, 3, 0);
controls.update();

scene.add(new AmbientLight(0xcdd7c5, 1.7));
scene.add(new HemisphereLight(0xdde8ff, 0x665035, 2.1));
const keyLight = new DirectionalLight(0xffe2b8, 3.2);
keyLight.position.set(18, 28, 14);
scene.add(keyLight);
const fillLight = new DirectionalLight(0xa8c7ff, 1.4);
fillLight.position.set(-16, 10, -18);
scene.add(fillLight);

const grid = new GridHelper(128, 128, 0x66705e, 0x2b3029);
grid.position.y = -0.002;
scene.add(grid);

const initialViewerOptions = readViewerOptions(window.location.search);
let presentationOptions = initialPresentationOptions;
let activeScene: SchematicScene | null = null;
let activeBounds: Box3Helper | null = null;
let activeSchematic: ParsedSchematic | null = null;
let dragDepth = 0;
let lastInfoUpdate = 0;
let loadSequence = 0;
let loadingSequence = 0;
let loadingHideTimeout: number | null = null;
let showGrid = initialViewerOptions.grid;
let showBounds = initialViewerOptions.bounds;
let showMetaBlocks = initialViewerOptions.metaBlocks;
let showUnresolvedBlocks = initialViewerOptions.unresolvedBlocks;
let gifExportRunning = false;
let gifExportProgress = 0;
let flightMode = false;
let flightSpeed = 8;
let flightLookDragging = false;
let flightPointerId: number | null = null;
let flightPointerX = 0;
let flightPointerY = 0;
let lastFrameTime = performance.now();
let nextFrameDeadline = 0;
let renderRequestId: number | null = null;
const pressedKeys = new Set<string>();
const flightEuler = new Euler(0, 0, 0, "YXZ");
const flightForward = new Vector3();
const flightRight = new Vector3();
const flightMovement = new Vector3();
const assetRegistryPromise = loadAssetRegistry();
const coarsePointerMedia = window.matchMedia("(pointer: coarse)");
const hoverUnavailableMedia = window.matchMedia("(hover: none)");
let flyCameraAvailable = readFlyCameraAvailability();

window.vsSchematicViewer = {
  version: VIEWER_VERSION,
  getOptions: getViewerOptions,
  setOptions: applyViewerOptions,
  getPresentationOptions,
  setPresentationOptions: applyPresentationOptions,
  loadSchematicJson,
  loadSchematicUrl,
  exportGif: exportActiveSchematicGif,
};
updateGridControls();
updateBoundsControls();
updateMetaControls();
updateGifExportControls();
updateFlightAvailability();
updatePresentationControls();

const resizeObserver = new ResizeObserver(() => resizeViewport());
resizeObserver.observe(viewportElement);
controls.addEventListener("change", requestRender);
coarsePointerMedia.addEventListener("change", updateFlightAvailability);
hoverUnavailableMedia.addEventListener("change", updateFlightAvailability);
resizeViewport();
requestRender();

openButton.addEventListener("click", openLocalSchematicPicker);
emptyOpenButton.addEventListener("click", openLocalSchematicPicker);
gridButton.addEventListener("click", () => {
  applyViewerOptions({ grid: !showGrid });
});
boundsButton.addEventListener("click", () => {
  applyViewerOptions({ bounds: !showBounds });
});
exportButton.addEventListener("click", () => {
  void downloadActiveSchematicGif();
});
metaButton.addEventListener("click", () => {
  applyViewerOptions({ metaBlocks: !showMetaBlocks });
});
unresolvedButton.addEventListener("click", () => {
  applyViewerOptions({ unresolvedBlocks: !showUnresolvedBlocks });
});
flightButton.addEventListener("click", () => {
  setFlightMode(!flightMode);
  if (flightMode) {
    requestFlightPointerLock();
  }
});
inputElement.addEventListener("change", () => {
  if (!allowsLocalFiles()) {
    inputElement.value = "";
    return;
  }
  const file = inputElement.files?.[0];
  if (file !== undefined) {
    void loadSchematicFile(file);
  }
  inputElement.value = "";
});

recenterButton.addEventListener("click", () => {
  if (activeSchematic !== null) {
    fitCamera(activeSchematic, false);
  }
});
topButton.addEventListener("click", () => {
  if (activeSchematic !== null) {
    fitCamera(activeSchematic, true);
  }
});
infoButton.addEventListener("click", () => {
  applyPresentationOptions({ inspector: !presentationOptions.inspector });
});

renderer.domElement.tabIndex = 0;
renderer.domElement.addEventListener("pointerdown", (event) => {
  if (!flightMode || event.button !== 0) return;
  renderer.domElement.focus();
  flightLookDragging = true;
  flightPointerId = event.pointerId;
  flightPointerX = event.clientX;
  flightPointerY = event.clientY;
  renderer.domElement.setPointerCapture(event.pointerId);
  renderer.domElement.classList.add("is-flight-dragging");
  if (document.pointerLockElement !== renderer.domElement) {
    requestFlightPointerLock();
  }
  updateFlightControls();
  event.preventDefault();
});
renderer.domElement.addEventListener("pointermove", (event) => {
  if (
    !flightMode
    || !flightLookDragging
    || document.pointerLockElement === renderer.domElement
  ) {
    return;
  }
  const movementX = event.clientX - flightPointerX;
  const movementY = event.clientY - flightPointerY;
  flightPointerX = event.clientX;
  flightPointerY = event.clientY;
  applyFlightLook(movementX, movementY);
});
renderer.domElement.addEventListener("pointerup", finishFlightDrag);
renderer.domElement.addEventListener("pointercancel", finishFlightDrag);
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === renderer.domElement) {
    finishFlightDrag();
  }
  updateFlightControls();
});
document.addEventListener("mousemove", (event) => {
  if (!flightMode || document.pointerLockElement !== renderer.domElement) {
    return;
  }
  applyFlightLook(event.movementX, event.movementY);
});
window.addEventListener("keydown", (event) => {
  if (!flightMode || !isFlightKey(event.code)) return;
  if (pressedKeys.size === 0) lastFrameTime = performance.now();
  pressedKeys.add(event.code);
  requestRender();
  event.preventDefault();
});
window.addEventListener("keyup", (event) => {
  pressedKeys.delete(event.code);
  requestRender();
});
window.addEventListener("blur", () => pressedKeys.clear());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    lastFrameTime = performance.now();
    nextFrameDeadline = 0;
    requestRender();
  }
});

viewportElement.addEventListener("dragenter", (event) => {
  event.preventDefault();
  if (!allowsLocalFiles()) return;
  dragDepth += 1;
  dropOverlay.classList.add("is-visible");
});
viewportElement.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer !== null) {
    event.dataTransfer.dropEffect = allowsLocalFiles() ? "copy" : "none";
  }
});
viewportElement.addEventListener("dragleave", (event) => {
  event.preventDefault();
  if (!allowsLocalFiles()) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    dropOverlay.classList.remove("is-visible");
  }
});
viewportElement.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  dropOverlay.classList.remove("is-visible");
  if (!allowsLocalFiles()) return;
  const file = event.dataTransfer?.files[0];
  if (file !== undefined) {
    void loadSchematicFile(file);
  }
});

async function loadSchematicFile(file: File): Promise<void> {
  if (!allowsLocalFiles()) return;
  const loadingToken = beginSchematicLoad(file.name);
  try {
    updateSchematicLoadProgress(loadingToken, 0.06, `Reading ${file.name}…`);
    await nextVisualFrame();
    await parseAndDisplaySchematic(await file.text(), file.name, loadingToken);
    completeSchematicLoad(loadingToken);
  } catch (error) {
    failSchematicLoad(loadingToken);
    const message = error instanceof Error ? error.message : String(error);
    showError(file.name, message);
    setStatus("Could not load schematic.");
  }
}

if (fixturePath !== null) {
  void loadDevelopmentFixture(fixturePath).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    showError("Development fixture", message);
    setStatus("Could not load development fixture.");
  });
} else if (remoteSchematicUrl !== null) {
  void loadSchematicUrl(remoteSchematicUrl).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    showError("Remote schematic", message);
    setStatus("Could not load remote schematic.");
  });
}

async function loadSchematicJson(
  jsonText: string,
  fileName = "schematic.json",
): Promise<void> {
  const loadingToken = beginSchematicLoad(fileName);
  try {
    await parseAndDisplaySchematic(jsonText, fileName, loadingToken);
    completeSchematicLoad(loadingToken);
  } catch (error) {
    failSchematicLoad(loadingToken);
    throw error;
  }
}

async function loadSchematicUrl(url: string): Promise<void> {
  const resolvedUrl = new URL(url, window.location.href);
  if (resolvedUrl.protocol !== "http:" && resolvedUrl.protocol !== "https:") {
    throw new Error("Remote schematic URLs must use HTTP or HTTPS.");
  }
  const fileName = decodeURIComponent(
    resolvedUrl.pathname.split("/").pop() || "schematic.json",
  );
  const loadingToken = beginSchematicLoad(fileName);
  try {
    updateSchematicLoadProgress(loadingToken, 0.04, `Downloading ${fileName}…`);
    const response = await fetch(resolvedUrl, {
      credentials: resolvedUrl.origin === window.location.origin ? "same-origin" : "omit",
    });
    if (!response.ok) {
      throw new Error(`Schematic request failed with HTTP ${response.status}.`);
    }
    const declaredLength = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REMOTE_SCHEMATIC_BYTES) {
      throw new Error("Remote schematic exceeds the 16 MB limit.");
    }
    const text = await readLimitedResponseText(
      response,
      MAX_REMOTE_SCHEMATIC_BYTES,
      (receivedBytes) => {
        const downloadFraction = Number.isFinite(declaredLength) && declaredLength > 0
          ? receivedBytes / declaredLength
          : Math.min(0.9, receivedBytes / MAX_REMOTE_SCHEMATIC_BYTES);
        updateSchematicLoadProgress(
          loadingToken,
          0.04 + Math.min(1, downloadFraction) * 0.14,
          `Downloading ${fileName}…`,
        );
      },
    );
    await parseAndDisplaySchematic(text, fileName, loadingToken);
    completeSchematicLoad(loadingToken);
  } catch (error) {
    failSchematicLoad(loadingToken);
    throw error;
  }
}

async function readLimitedResponseText(
  response: Response,
  maximumBytes: number,
  onProgress?: (receivedBytes: number) => void,
): Promise<string> {
  if (response.body === null) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    receivedBytes += result.value.byteLength;
    if (receivedBytes > maximumBytes) {
      await reader.cancel();
      throw new Error("Remote schematic exceeds the 16 MB limit.");
    }
    text += decoder.decode(result.value, { stream: true });
    onProgress?.(receivedBytes);
  }
  return text + decoder.decode();
}

async function loadDevelopmentFixture(fixturePath: string): Promise<void> {
  const normalizedPath = fixturePath.replaceAll("\\", "/");
  const fileName = normalizedPath.split("/").pop() ?? "fixture.json";
  const loadingToken = beginSchematicLoad(fileName);
  try {
    updateSchematicLoadProgress(loadingToken, 0.06, `Reading ${fileName}…`);
    const response = await fetch(`/@fs/${normalizedPath}`);
    if (!response.ok) {
      throw new Error(`Could not load development fixture ${fixturePath}.`);
    }
    await parseAndDisplaySchematic(await response.text(), fileName, loadingToken);
    completeSchematicLoad(loadingToken);
  } catch (error) {
    failSchematicLoad(loadingToken);
    throw error;
  }
}

async function parseAndDisplaySchematic(
  jsonText: string,
  fileName: string,
  loadingToken: number,
): Promise<void> {
  updateSchematicLoadProgress(loadingToken, 0.19, `Parsing ${fileName}…`);
  setStatus(`Parsing ${fileName}…`);
  await nextVisualFrame();
  const schematic = parseSchematicJson(jsonText);
  if (loadingToken !== loadingSequence) return;
  updateSchematicLoadProgress(loadingToken, 0.25, "Loading block asset registry…");
  await displaySchematic(fileName, schematic, loadingToken);
}

async function displaySchematic(
  fileName: string,
  schematic: ParsedSchematic,
  loadingToken: number,
): Promise<void> {
  if (loadingToken !== loadingSequence) return;
  const sequence = ++loadSequence;
  setStatus("Resolving local block assets and textures…");
  const registry = await assetRegistryPromise;
  if (loadingToken !== loadingSequence) return;
  clearActiveScene();
  updateSchematicLoadProgress(loadingToken, 0.28, "Preparing textures…");
  const createdScene = await createSchematicScene(schematic, registry, {
    onProgress: ({ stage, completed, total }) => {
      const fraction = total === 0 ? 1 : Math.min(1, completed / total);
      if (stage === "textures") {
        updateSchematicLoadProgress(
          loadingToken,
          0.28 + fraction * 0.44,
          total === 0
            ? "No additional textures needed"
            : `Loading textures… ${completed.toLocaleString()} / ${total.toLocaleString()}`,
        );
        return;
      }
      updateSchematicLoadProgress(
        loadingToken,
        0.72 + fraction * 0.25,
        `Building schematic geometry… ${completed.toLocaleString()} / ${total.toLocaleString()}`,
      );
    },
  });
  if (sequence !== loadSequence || loadingToken !== loadingSequence) {
    createdScene.dispose();
    return;
  }
  activeSchematic = schematic;
  activeScene = createdScene;
  activeScene.setMetaBlocksVisible(showMetaBlocks);
  activeScene.setPlaceholderBlocksVisible(showUnresolvedBlocks);
  scene.add(activeScene.object);

  const bounds = new Box3(
    new Vector3(-schematic.size.x / 2, 0, -schematic.size.z / 2),
    new Vector3(
      schematic.size.x / 2,
      schematic.size.y,
      schematic.size.z / 2,
    ),
  );
  activeBounds = new Box3Helper(bounds, 0xd3a85c);
  activeBounds.name = "Schematic bounds";
  activeBounds.visible = showBounds;
  scene.add(activeBounds);

  emptyState.classList.add("is-hidden");
  flightButton.disabled = !flyCameraAvailable;
  recenterButton.disabled = false;
  topButton.disabled = false;
  fileNameElement.textContent = fileName;
  fileVersionElement.textContent =
    "Saved by Vintage Story " + (schematic.gameVersion ?? "unknown version");
  updateInspectorStats();
  updateMetaControls();
  updateUnresolvedControls();
  updateBoundsControls();
  updateGifExportControls();

  if (schematic.warnings.length === 0) {
    parserReport.className = "report report-ok";
    parserReport.textContent =
      "Validated sparse arrays, mappings, bounds, and packed coordinates.";
  } else {
    parserReport.className = "report report-warning";
    parserReport.textContent =
      schematic.warnings.length +
      " warning(s). First: " +
      (schematic.warnings[0] ?? "Unknown warning");
  }

  fitCamera(schematic, false);
  flightSpeed = Math.max(
    4,
    Math.min(24, Math.max(schematic.size.x, schematic.size.y, schematic.size.z) * 0.65),
  );
  updateSchematicLoadProgress(loadingToken, 0.99, "Finalizing viewer…");
  setStatus(
    `Loaded ${schematic.diagnostics.blockCount.toLocaleString()} sparse entries · ` +
      `${activeScene.renderedBlocks.length.toLocaleString()} render placements · ` +
      `${activeScene.stats.texturedBlockCount.toLocaleString()} resolved · ` +
      `${activeScene.stats.placeholderBlockCount.toLocaleString()} unresolved.`,
  );
}

function updateInspectorStats(): void {
  if (activeSchematic === null || activeScene === null) {
    return;
  }
  const hiddenMetaCount = showMetaBlocks ? 0 : activeScene.stats.metaBlockCount;
  const hiddenPlaceholderCount = showUnresolvedBlocks
    ? 0
    : activeScene.stats.placeholderBlockCount;
  const doubleHiddenCount = !showMetaBlocks && !showUnresolvedBlocks
    ? activeScene.stats.metaPlaceholderBlockCount
    : 0;
  const displayedBlockCount = Math.max(
    0,
    activeScene.renderedBlocks.length
      - hiddenMetaCount
      - hiddenPlaceholderCount
      + doubleHiddenCount,
  );
  structureStats.innerHTML = statRows([
    ["Dimensions", formatDimensions(activeSchematic)],
    ["Block entries", activeSchematic.diagnostics.blockCount.toLocaleString()],
    ["Displayed blocks", displayedBlockCount.toLocaleString()],
    ["Unique mappings", activeSchematic.diagnostics.mappedBlockCodeCount.toLocaleString()],
    ["Referenced codes", activeSchematic.diagnostics.referencedBlockCodeCount.toLocaleString()],
  ]);
  specialStats.innerHTML = statRows([
    ["Decors", activeSchematic.diagnostics.decorCount.toLocaleString()],
    ["Block entities", activeSchematic.diagnostics.blockEntityCount.toLocaleString()],
    [
      "Decoded block entities",
      activeSchematic.blockEntities.filter((entity) => entity.attributes !== null).length.toLocaleString(),
    ],
    ["Entities", activeSchematic.diagnostics.entityCount.toLocaleString()],
    ["Repeated positions", activeSchematic.diagnostics.repeatedPositionCount.toLocaleString()],
  ]);
  assetStats.innerHTML = statRows([
    ["Render placements", activeScene.renderedBlocks.length.toLocaleString()],
    ["Currently visible", displayedBlockCount.toLocaleString()],
    [
      "Rendering coverage",
      formatCoverage(activeScene.stats.texturedBlockCount, activeScene.renderedBlocks.length),
    ],
    ["Resolved placements", activeScene.stats.texturedBlockCount.toLocaleString()],
    ["JSON-shape placements", activeScene.stats.shapedBlockCount.toLocaleString()],
    ["Chiseled placements", activeScene.stats.microblockBlockCount.toLocaleString()],
    ["Ground-storage placements", activeScene.stats.groundStorageBlockCount.toLocaleString()],
    ["Support-beam placements", activeScene.stats.supportBeamBlockCount.toLocaleString()],
    ["Fruit-tree placements", activeScene.stats.fruitTreeBlockCount.toLocaleString()],
    [
      "Decor overlays",
      `${activeScene.stats.decorCount.toLocaleString()} / ${activeSchematic.diagnostics.decorCount.toLocaleString()}`,
    ],
    ["Decor codes", activeScene.stats.decorCodeCount.toLocaleString()],
    ["Unresolved decors", activeScene.stats.unresolvedDecorCount.toLocaleString()],
    [
      "Unresolved blocks",
      `${activeScene.stats.placeholderBlockCount.toLocaleString()} ${showUnresolvedBlocks ? "shown" : "hidden"}`,
    ],
    ["Resolved code types", activeScene.stats.texturedCodeCount.toLocaleString()],
    ["JSON-shape code types", activeScene.stats.shapedCodeCount.toLocaleString()],
    ["Chiseled code types", activeScene.stats.microblockCodeCount.toLocaleString()],
    ["Support-beam code types", activeScene.stats.supportBeamCodeCount.toLocaleString()],
    ["Unresolved code types", activeScene.stats.placeholderCodeCount.toLocaleString()],
    ["Textures loaded", activeScene.stats.loadedTextureCount.toLocaleString()],
    [
      "Meta blocks",
      `${activeScene.stats.metaBlockCount.toLocaleString()} ${showMetaBlocks ? "shown" : "hidden"}`,
    ],
    [
      "Embedded meta materials",
      `${activeScene.stats.embeddedMetaMaterialCount.toLocaleString()} ${showMetaBlocks ? "shown" : "hidden"}`,
    ],
  ]);
  const placeholders = activeScene.stats.placeholderBreakdown;
  unsupportedList.className = placeholders.length === 0
    ? "unsupported-list unsupported-list-empty"
    : "unsupported-list";
  unsupportedList.innerHTML = placeholders.length === 0
    ? "All referenced blocks use a supported renderer."
    : placeholders.slice(0, 10).map((entry) =>
        `<div class="unsupported-entry"><div><code>${escapeHtml(entry.code)}</code>`
        + `<strong>${entry.count.toLocaleString()}</strong></div>`
        + `<span>${escapeHtml(entry.reason)}</span></div>`,
      ).join("");
}

function updateMetaControls(): void {
  const hasMetaBlocks = (activeScene?.stats.metaBlockCount ?? 0) > 0
    || (activeScene?.stats.embeddedMetaMaterialCount ?? 0) > 0;
  metaButton.disabled = !hasMetaBlocks;
  metaButton.textContent = showMetaBlocks && hasMetaBlocks ? "Hide meta blocks" : "Show meta blocks";
  metaButton.setAttribute("aria-pressed", String(showMetaBlocks && hasMetaBlocks));
}

function updateUnresolvedControls(): void {
  const hasUnresolvedBlocks = (activeScene?.stats.placeholderBlockCount ?? 0) > 0;
  unresolvedButton.disabled = !hasUnresolvedBlocks;
  unresolvedButton.textContent = showUnresolvedBlocks && hasUnresolvedBlocks
    ? "Hide unresolved"
    : "Show unresolved";
  unresolvedButton.setAttribute(
    "aria-pressed",
    String(showUnresolvedBlocks && hasUnresolvedBlocks),
  );
}

function updateGridControls(): void {
  grid.visible = showGrid;
  gridButton.textContent = `Grid: ${showGrid ? "On" : "Off"}`;
  gridButton.setAttribute("aria-pressed", String(showGrid));
}

function updateBoundsControls(): void {
  if (activeBounds !== null) activeBounds.visible = showBounds;
  boundsButton.textContent = `Bounds: ${showBounds ? "On" : "Off"}`;
  boundsButton.setAttribute("aria-pressed", String(showBounds));
}

function getViewerOptions(): ViewerOptions {
  return {
    grid: showGrid,
    bounds: showBounds,
    metaBlocks: showMetaBlocks,
    unresolvedBlocks: showUnresolvedBlocks,
  };
}

function applyViewerOptions(options: Partial<ViewerOptions>): ViewerOptions {
  if (typeof options.grid === "boolean") showGrid = options.grid;
  if (typeof options.bounds === "boolean") showBounds = options.bounds;
  if (typeof options.metaBlocks === "boolean") {
    showMetaBlocks = options.metaBlocks;
  }
  if (typeof options.unresolvedBlocks === "boolean") {
    showUnresolvedBlocks = options.unresolvedBlocks;
  }
  activeScene?.setMetaBlocksVisible(showMetaBlocks);
  activeScene?.setPlaceholderBlocksVisible(showUnresolvedBlocks);
  updateGridControls();
  updateBoundsControls();
  updateMetaControls();
  updateUnresolvedControls();
  updateInspectorStats();
  requestRender();
  const applied = getViewerOptions();
  window.dispatchEvent(new CustomEvent("vsvieweroptionschange", { detail: applied }));
  return applied;
}

function getPresentationOptions(): ViewerPresentationOptions {
  return {
    mode: presentationOptions.mode,
    controls: [...presentationOptions.controls],
    inspector: presentationOptions.inspector,
  };
}

function applyPresentationOptions(
  options: Partial<ViewerPresentationOptions>,
): ViewerPresentationOptions {
  presentationOptions = normalizeViewerPresentationOptions({
    mode: options.mode ?? presentationOptions.mode,
    controls: options.controls ?? presentationOptions.controls,
    inspector: options.inspector ?? presentationOptions.inspector,
  });
  updatePresentationControls();
  const applied = getPresentationOptions();
  window.dispatchEvent(
    new CustomEvent("vsviewerpresentationchange", { detail: applied }),
  );
  return applied;
}

function updatePresentationControls(): void {
  const visibleControls = new Set(presentationOptions.controls);
  for (const [control, elements] of Object.entries(controlElements) as [
    ViewerControlId,
    readonly HTMLElement[],
  ][]) {
    const hidden = !visibleControls.has(control);
    for (const element of elements) element.hidden = hidden;
  }
  toolbarActions.hidden = toolbarControlElements.every((element) => element.hidden);
  inputElement.disabled = !allowsLocalFiles();
  inspectorElement.hidden = !presentationOptions.inspector;
  workspaceElement.classList.toggle(
    "is-inspector-hidden",
    !presentationOptions.inspector,
  );
  infoButton.textContent = presentationOptions.inspector ? "Hide info" : "Show info";
  infoButton.setAttribute("aria-pressed", String(presentationOptions.inspector));
  infoButton.setAttribute("aria-expanded", String(presentationOptions.inspector));
  if (!allowsLocalFiles()) {
    dragDepth = 0;
    dropOverlay.classList.remove("is-visible");
  }
  updateEmptyStateCopy();
  resizeViewport();
}

function allowsLocalFiles(): boolean {
  return presentationOptions.mode === "standalone";
}

function openLocalSchematicPicker(): void {
  if (allowsLocalFiles()) inputElement.click();
}

function showEmbeddedLoadingState(): void {
  if (presentationOptions.mode !== "embed" || activeSchematic !== null) return;
  emptyTitle.textContent = "Loading schematic";
  emptyDescription.textContent = "The website selected this schematic preview.";
}

function beginSchematicLoad(fileName: string): number {
  loadingSequence += 1;
  if (loadingHideTimeout !== null) {
    window.clearTimeout(loadingHideTimeout);
    loadingHideTimeout = null;
  }
  showEmbeddedLoadingState();
  loadingOverlay.hidden = false;
  loadingOverlay.classList.remove("is-complete");
  viewportElement.setAttribute("aria-busy", "true");
  updateSchematicLoadProgress(
    loadingSequence,
    0.02,
    `Preparing ${fileName}…`,
  );
  return loadingSequence;
}

function updateSchematicLoadProgress(
  loadingToken: number,
  progress: number,
  message: string,
): void {
  if (loadingToken !== loadingSequence) return;
  const percentage = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  loadingLabel.textContent = message;
  loadingPercent.textContent = `${percentage}%`;
  loadingFill.style.width = `${percentage}%`;
  loadingTrack.setAttribute("aria-valuenow", String(percentage));
  loadingTrack.setAttribute("aria-valuetext", `${message} ${percentage}%`);
}

function completeSchematicLoad(loadingToken: number): void {
  if (loadingToken !== loadingSequence) return;
  updateSchematicLoadProgress(loadingToken, 1, "Schematic ready");
  loadingOverlay.classList.add("is-complete");
  viewportElement.setAttribute("aria-busy", "false");
  loadingHideTimeout = window.setTimeout(() => {
    if (loadingToken !== loadingSequence) return;
    loadingOverlay.hidden = true;
    loadingOverlay.classList.remove("is-complete");
    loadingHideTimeout = null;
  }, 360);
}

function failSchematicLoad(loadingToken: number): void {
  if (loadingToken !== loadingSequence) return;
  if (loadingHideTimeout !== null) {
    window.clearTimeout(loadingHideTimeout);
    loadingHideTimeout = null;
  }
  loadingOverlay.hidden = true;
  loadingOverlay.classList.remove("is-complete");
  viewportElement.setAttribute("aria-busy", "false");
}

async function nextVisualFrame(): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

function updateEmptyStateCopy(): void {
  if (activeSchematic !== null) return;
  if (presentationOptions.mode === "embed") {
    const hasStartupSchematic = remoteSchematicUrl !== null || fixturePath !== null;
    emptyTitle.textContent = hasStartupSchematic
      ? "Loading schematic"
      : "Waiting for the host website";
    emptyDescription.textContent = hasStartupSchematic
      ? "The website selected this schematic preview."
      : "This embedded viewer accepts schematics from its host page.";
    return;
  }
  emptyTitle.textContent = "Drop a Vintage Story schematic here";
  emptyDescription.textContent =
    "Open any local JSON schematic. Game assets remain on this computer.";
}

function updateGifExportControls(): void {
  exportButton.disabled = activeScene === null || gifExportRunning;
  exportButton.textContent = gifExportRunning
    ? `GIF ${Math.round(gifExportProgress * 100)}%`
    : "Export GIF";
}

async function exportActiveSchematicGif(
  options: GifExportOptions = {},
): Promise<Blob> {
  if (activeSchematic === null || activeScene === null) {
    throw new Error("Load a schematic before exporting a GIF.");
  }
  if (gifExportRunning) {
    throw new Error("A GIF export is already running.");
  }
  const schematic = activeSchematic;
  const schematicScene = activeScene;
  const bounds = activeBounds;
  const includeMetaBlocks = options.includeMetaBlocks ?? false;
  const includeUnresolvedBlocks = options.includeUnresolvedBlocks ?? false;
  const previousMetaBlocksVisibility = showMetaBlocks;
  const previousUnresolvedBlocksVisibility = showUnresolvedBlocks;
  const previousStatus = statusMessage.textContent ?? "Ready";
  gifExportRunning = true;
  gifExportProgress = 0;
  updateGifExportControls();
  try {
    schematicScene.setMetaBlocksVisible(includeMetaBlocks);
    schematicScene.setPlaceholderBlocksVisible(includeUnresolvedBlocks);
    scene.updateMatrixWorld(true);
    const contentBounds = visibleRenderableBounds(schematicScene.object);
    const metaBlockCodes = collectMetaBlockCodes(schematicScene.object);
    const { exportRotatingGif } = await import("./exportRotatingGif.js");
    return await exportRotatingGif(
      {
        scene,
        schematic,
        grid,
        bounds,
        contentBounds,
        metaBlockCodes,
      },
      options,
      (progress) => {
        gifExportProgress = progress;
        updateGifExportControls();
        setStatus(`Rendering rotating GIF… ${Math.round(progress * 100)}%`);
      },
    );
  } finally {
    schematicScene.setMetaBlocksVisible(previousMetaBlocksVisibility);
    schematicScene.setPlaceholderBlocksVisible(previousUnresolvedBlocksVisibility);
    gifExportRunning = false;
    gifExportProgress = 0;
    updateGifExportControls();
    setStatus(previousStatus);
    requestRender();
  }
}

function visibleRenderableBounds(root: Object3D): Box3 {
  const bounds = new Box3();
  root.traverseVisible((object) => {
    if (!("geometry" in object)) return;
    bounds.union(new Box3().setFromObject(object));
  });
  return bounds;
}

function collectMetaBlockCodes(root: Object3D): ReadonlySet<string> {
  const codes = new Set<string>();
  root.traverse((object) => {
    if (object.userData.isMeta !== true) return;
    const code = object.userData.blockCode;
    if (typeof code === "string") codes.add(code);
  });
  return codes;
}

async function downloadActiveSchematicGif(): Promise<void> {
  try {
    const blob = await exportActiveSchematicGif();
    const fileName = rotatingPreviewFileName(fileNameElement.textContent ?? "schematic");
    downloadBlob(blob, fileName);
    setStatus(`Exported ${fileName} · ${formatFileSize(blob.size)}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`GIF export failed: ${message}`);
  }
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function rotatingPreviewFileName(sourceName: string): string {
  const withoutExtension = sourceName.replace(/\.json$/i, "");
  const safeName = withoutExtension
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .trim();
  return `${safeName || "schematic"}-preview.gif`;
}

function formatFileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadAssetRegistry(): Promise<AssetRegistry | null> {
  try {
    const registryUrl =
      new URLSearchParams(window.location.search).get("registry") ??
      import.meta.env.VITE_VS_REGISTRY_URL ??
      "/@vs-registry";
    const response = await fetch(registryUrl, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const value = (await response.json()) as AssetRegistry;
    return value.formatVersion === 2 ? value : null;
  } catch {
    return null;
  }
}

function clearActiveScene(): void {
  setFlightMode(false);
  flightButton.disabled = true;
  recenterButton.disabled = true;
  topButton.disabled = true;
  activeSchematic = null;
  if (activeScene !== null) {
    scene.remove(activeScene.object);
    activeScene.dispose();
    activeScene = null;
  }
  updateMetaControls();
  if (activeBounds !== null) {
    scene.remove(activeBounds);
    activeBounds.geometry.dispose();
    const boundsMaterials = Array.isArray(activeBounds.material)
      ? activeBounds.material
      : [activeBounds.material];
    for (const material of boundsMaterials) {
      material.dispose();
    }
    activeBounds = null;
  }
  updateGifExportControls();
  requestRender();
}

function fitCamera(schematic: ParsedSchematic, topView: boolean): void {
  setFlightMode(false);
  const maxDimension = Math.max(
    schematic.size.x,
    schematic.size.y,
    schematic.size.z,
    1,
  );
  const halfFovRadians = (camera.fov * Math.PI) / 360;
  const distance = (maxDimension / (2 * Math.tan(halfFovRadians))) * 1.55;
  const target = new Vector3(0, schematic.size.y / 2, 0);

  if (topView) {
    camera.position.set(0, target.y + distance, 0.001);
  } else {
    const direction = new Vector3(1, 0.72, 1).normalize();
    camera.position.copy(target).addScaledVector(direction, distance);
  }
  camera.near = Math.max(0.02, distance / 1000);
  camera.far = Math.max(2048, distance * 20);
  camera.updateProjectionMatrix();
  controls.target.copy(target);
  controls.update();
}

function showError(fileName: string, message: string): void {
  if (presentationOptions.mode === "embed" && activeSchematic === null) {
    emptyTitle.textContent = "Could not load schematic";
    emptyDescription.textContent =
      "The host website's predefined schematic could not be loaded.";
  }
  fileNameElement.textContent = fileName;
  fileVersionElement.textContent = "Invalid or unsupported schematic";
  parserReport.className = "report report-error";
  parserReport.textContent = message;
}

function statRows(rows: readonly (readonly [string, string])[]): string {
  return rows
    .map(
      ([label, value]) =>
        "<div><dt>" + escapeHtml(label) + "</dt><dd>" + escapeHtml(value) + "</dd></div>",
    )
    .join("");
}

function formatDimensions(schematic: ParsedSchematic): string {
  return (
    schematic.size.x +
    " × " +
    schematic.size.y +
    " × " +
    schematic.size.z
  );
}

function formatCoverage(rendered: number, total: number): string {
  return total === 0 ? "100.0%" : `${((rendered / total) * 100).toFixed(1)}%`;
}

function setStatus(message: string): void {
  statusMessage.textContent = message;
}

function resizeViewport(): void {
  const width = Math.max(1, viewportElement.clientWidth);
  const height = Math.max(1, viewportElement.clientHeight);
  const pixelRatio = calculateAdaptivePixelRatio({
    width,
    height,
    devicePixelRatio: window.devicePixelRatio,
  });
  if (renderer.getPixelRatio() !== pixelRatio) {
    renderer.setPixelRatio(pixelRatio);
  }
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  requestRender();
}

function renderFrame(time: number): void {
  renderRequestId = null;
  if (document.hidden) return;
  if (nextFrameDeadline > 0 && time + 0.5 < nextFrameDeadline) {
    requestRender();
    return;
  }
  if (nextFrameDeadline === 0 || time - nextFrameDeadline > MIN_FRAME_INTERVAL_MS * 2) {
    nextFrameDeadline = time;
  }
  do {
    nextFrameDeadline += MIN_FRAME_INTERVAL_MS;
  } while (nextFrameDeadline <= time);
  const deltaSeconds = Math.min(0.1, Math.max(0, (time - lastFrameTime) / 1000));
  lastFrameTime = time;
  let cameraChanged = false;
  if (flightMode) {
    cameraChanged = updateFlightMovement(deltaSeconds);
  } else {
    cameraChanged = controls.update();
  }
  renderer.render(scene, camera);
  if (time - lastInfoUpdate > 500) {
    renderStats.textContent =
      renderer.info.render.calls.toLocaleString() +
      " draw calls · " +
      renderer.info.render.triangles.toLocaleString() +
      " triangles";
    lastInfoUpdate = time;
  }
  if (cameraChanged || (flightMode && pressedKeys.size > 0)) {
    requestRender();
  }
}

function requestRender(): void {
  if (renderRequestId !== null || document.hidden) return;
  renderRequestId = window.requestAnimationFrame(renderFrame);
}

function setFlightMode(enabled: boolean): void {
  if (
    enabled === flightMode
    || (enabled && (activeSchematic === null || !flyCameraAvailable))
  ) {
    updateFlightControls();
    return;
  }
  flightMode = enabled;
  pressedKeys.clear();
  finishFlightDrag();
  controls.enabled = !enabled;
  renderer.domElement.classList.toggle("is-flight-look", enabled);
  if (enabled) {
    flightEuler.setFromQuaternion(camera.quaternion, "YXZ");
    lastFrameTime = performance.now();
  } else {
    if (document.pointerLockElement === renderer.domElement) {
      document.exitPointerLock();
    }
    camera.getWorldDirection(flightForward);
    controls.target.copy(camera.position).addScaledVector(flightForward, 10);
    controls.update();
  }
  updateFlightControls();
  requestRender();
}

function updateFlightControls(): void {
  const locked = flightMode && document.pointerLockElement === renderer.domElement;
  flightButton.textContent = flightMode ? "Orbit camera" : "Fly camera";
  flightButton.setAttribute("aria-pressed", String(flightMode));
  flightHint.classList.toggle("is-visible", flightMode);
  flightHint.classList.toggle("is-locked", locked || flightLookDragging);
  flightHint.textContent = locked
    ? "WASD move · Space/Shift vertical · Ctrl boost · Esc frees cursor"
    : flightLookDragging
      ? "Drag to look · WASD move · Space/Shift vertical · Ctrl boost"
      : "Click or drag the viewport to look · WASD move · Space/Shift vertical · Ctrl boost";
}

function requestFlightPointerLock(): void {
  try {
    const request = renderer.domElement.requestPointerLock();
    void request?.catch(() => updateFlightControls());
  } catch {
    updateFlightControls();
  }
}

function applyFlightLook(movementX: number, movementY: number): void {
  flightEuler.y -= movementX * 0.0022;
  flightEuler.x -= movementY * 0.0022;
  flightEuler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, flightEuler.x));
  camera.quaternion.setFromEuler(flightEuler);
  requestRender();
}

function finishFlightDrag(event?: PointerEvent): void {
  const pointerId = event?.pointerId ?? flightPointerId;
  if (
    pointerId !== null
    && renderer.domElement.hasPointerCapture(pointerId)
  ) {
    renderer.domElement.releasePointerCapture(pointerId);
  }
  flightLookDragging = false;
  flightPointerId = null;
  renderer.domElement.classList.remove("is-flight-dragging");
  if (flightMode) updateFlightControls();
}

function updateFlightMovement(deltaSeconds: number): boolean {
  camera.getWorldDirection(flightForward).normalize();
  flightRight.crossVectors(flightForward, camera.up).normalize();
  flightMovement.set(0, 0, 0);
  if (pressedKeys.has("KeyW")) flightMovement.add(flightForward);
  if (pressedKeys.has("KeyS")) flightMovement.sub(flightForward);
  if (pressedKeys.has("KeyD")) flightMovement.add(flightRight);
  if (pressedKeys.has("KeyA")) flightMovement.sub(flightRight);
  if (pressedKeys.has("Space")) flightMovement.y += 1;
  if (pressedKeys.has("ShiftLeft") || pressedKeys.has("ShiftRight")) flightMovement.y -= 1;
  if (flightMovement.lengthSq() === 0) return false;
  const boosted = pressedKeys.has("ControlLeft") || pressedKeys.has("ControlRight");
  camera.position.addScaledVector(
    flightMovement.normalize(),
    flightSpeed * (boosted ? 3 : 1) * deltaSeconds,
  );
  return true;
}

function readFlyCameraAvailability(): boolean {
  return supportsFlyCamera({
    coarsePointer: coarsePointerMedia.matches,
    hoverUnavailable: hoverUnavailableMedia.matches,
  });
}

function updateFlightAvailability(): void {
  flyCameraAvailable = readFlyCameraAvailability();
  if (!flyCameraAvailable) setFlightMode(false);
  flightButton.hidden = !flyCameraAvailable;
  flightButton.disabled = !flyCameraAvailable || activeSchematic === null;
}

function isFlightKey(code: string): boolean {
  return code === "KeyW"
    || code === "KeyA"
    || code === "KeyS"
    || code === "KeyD"
    || code === "Space"
    || code === "ShiftLeft"
    || code === "ShiftRight"
    || code === "ControlLeft"
    || code === "ControlRight";
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error("Missing required element #" + id + ".");
  }
  return element as T;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
