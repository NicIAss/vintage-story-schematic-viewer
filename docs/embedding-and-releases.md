# Embedding and release architecture

## Goal

One renderer implementation should power the desktop viewer, wiki embeds, and
a future schematic database. A consumer supplies one schematic URL or object;
the viewer owns parsing, asset resolution, rendering, cameras, and diagnostics.

## Package boundaries

| Package/application | Responsibility |
| --- | --- |
| `@vs-schematic/renderer-core` | Schematic parser, block-entity decoders, asset-registry types, and Three.js scene creation. No product-specific page layout. |
| `@vs-schematic/viewer-element` | Future standards-based `<vs-schematic-viewer>` web component with toolbar, orbit/fly cameras, loading state, and error events. This will become the recommended wiki integration. |
| `@vs-schematic/asset-compiler` | Build-time conversion of a locally supplied Vintage Story asset tree into a versioned renderer registry. |
| `apps/desktop` | Current Vite UI and deployable iframe endpoint; it may later become a Tauri desktop application. |
| `apps/demo` | Future small hosted web-component example. It must contain no renderer logic of its own. |

The web component is preferable to a React-only package because MediaWiki,
plain HTML, Vue, React, and database frontends can all use it. Thin React/Vue
wrappers can be published later if demand justifies them.

## Consumer API

### Current v0.4.0 bridge

Before the web component is extracted, the viewer accepts a schematic URL,
asset-registry URL, and stable display options through its URL. This lets wiki
and database prototypes load a structure and choose different presets without
changing renderer code:

```text
https://viewer.example.org/?schematic=https%3A%2F%2Fwiki.example.org%2Fwatchtower.json&registry=https%3A%2F%2Fcdn.example.org%2Fvs-assets%2F1.22.5%2Fasset-registry.json&mode=embed&controls=recenter%2Ctop&grid=off&bounds=off&meta=off&unresolved=off
```

The accepted boolean values are `on`/`off`, `true`/`false`, `1`/`0`, and
`yes`/`no`. Same-origin host pages can also update a running viewer:

```js
iframe.contentWindow.vsSchematicViewer.setOptions({
  grid: false,
  bounds: false,
  metaBlocks: false,
  unresolvedBlocks: false,
});
```

`getOptions()` returns the applied values, and the viewer emits a
`vsvieweroptionschange` window event after runtime changes. The URL form remains
the cross-origin iframe option; the eventual web component will expose the same
settings as element properties and attributes.

`mode=embed` removes local file selection and drag/drop before first paint.
`controls` is a comma-separated allowlist containing any of `open`, `grid`,
`bounds`, `export`, `meta`, `unresolved`, `flight`, `recenter`, `top`, and
`info`.
`controls=none` creates a display-only toolbar, while a setting such as
`meta=off` remains applied even when its button is not in the allowlist.
The side information panel starts hidden. The `info` action toggles it, and
`inspector=on|off` selects its initial state.
Same-origin hosts can update this presentation policy at runtime:

```js
iframe.contentWindow.vsSchematicViewer.setPresentationOptions({
  mode: "embed",
  controls: ["recenter", "top", "info"],
  inspector: false,
});
```

The viewer emits `vsviewerpresentationchange` after runtime changes. This is UI
policy rather than a security boundary; same-origin host scripts retain access
to the documented loading and settings API.

Same-origin hosts can load or replace the schematic without reloading the
iframe:

```js
await iframe.contentWindow.vsSchematicViewer.loadSchematicUrl(
  "/schematics/watchtower.json",
);
await iframe.contentWindow.vsSchematicViewer.loadSchematicJson(
  schematicJsonText,
  "watchtower.json",
);
```

The current viewer also exposes the same rotating-preview pipeline used by its
`Export GIF` button:

```js
const gif = await iframe.contentWindow.vsSchematicViewer.exportGif({
  size: 560,
  frameCount: 42,
  framesPerSecond: 14,
  includeGrid: false,
  includeBounds: false,
  includeMetaBlocks: false,
  includeUnresolvedBlocks: false,
});
```

The result is an `image/gif` `Blob`. Grid and schematic bounds are excluded by
default even when they are visible in the interactive viewer. Meta blocks are
also hidden and excluded from camera framing unless `includeMetaBlocks` is set
explicitly. Unresolved placeholders follow the same rule through
`includeUnresolvedBlocks`. Sizes are clamped to 128–1024 pixels, frame counts
to 12–90, and rates to 4–30 frames per second.
The default camera measures the rendered silhouette throughout the rotation and
uses one stable, structure-specific zoom instead of fitting the schematic's
full 3D diagonal.

### Automated preview generation

The database should generate previews when a schematic is uploaded rather than
making each visitor render one. A headless browser worker can open the pinned
viewer release, load the schematic and matching asset manifest, call
`exportGif()`, and store the result next to the schematic. The cache key should
include the schematic content hash, renderer version, asset-manifest version,
and export settings so previews are regenerated only when their rendering input
changes.

List and wiki pages should initially show the generated image and instantiate
the interactive viewer only after a click. GIF is useful for downloads and
social sharing; a production preview worker should eventually derive a still
WebP poster and animated WebP or MP4/WebM from the same captured frames for
smaller page payloads. The original GIF can remain available as a share action.

### Future web component

The simple embed should require only a module and a schematic:

```html
<script type="module"
  src="https://cdn.example.org/@vs-schematic/viewer-element/0.4.0/index.js"></script>

<vs-schematic-viewer
  schematic="/schematics/watchtower.json"
  assets="https://cdn.example.org/vs-assets/1.22.7/manifest.json"
  camera="orbit"
  meta-blocks="hidden"
  grid="hidden"
  bounds="hidden">
</vs-schematic-viewer>
```

The element should also accept an already parsed object and expose JavaScript
methods for applications that need tighter control:

```ts
const viewer = document.querySelector("vs-schematic-viewer");
await viewer.load(schematicObject);
viewer.fitToView();
```

Events such as `viewer-load`, `viewer-error`, `viewer-selection`, and
`viewer-coverage` let a database page add its own metadata UI without forking
the renderer.

An iframe endpoint is a useful fallback for wiki engines that cannot load a
custom module. It should use the same component internally:

```html
<iframe
  src="https://viewer.example.org/embed?schematic=https%3A%2F%2Fwiki.example.org%2Fwatchtower.json&assets=1.22.7"
  loading="lazy"
  allow="fullscreen">
</iframe>
```

Remote schematic servers must opt in with CORS. URL inputs need protocol,
size, and schema validation before loading.

## Independent versioning

Renderer releases and game-asset compatibility are different things and must
not share one version number.

- Renderer packages use semantic versions, for example `0.4.0`.
- Asset manifests use the exact game version, for example `1.22.7`.
- Each manifest records its registry format, compiler version/commit, source
  game version, creation time, and content hash.
- The renderer declares which registry-format versions it accepts.
- Websites pin a tested renderer version and select an asset channel such as
  `1.22`; that channel can move from `1.22.6` to `1.22.7` without changing the
  embed code. Content-hashed files make that safe to cache.
- Old asset manifests remain available so older schematics and regression
  fixtures can still be reproduced.

A game update then becomes: copy the new assets locally, update the official
source references, compile, run the full schematic audit and visual fixtures,
publish a new immutable asset manifest, and finally move the tested channel.
Wiki and database pages do not copy renderer source or block mappings.

## Repository and release workflow

The current monorepo already has the correct first split: reusable core,
asset compiler, and product UI. The next packaging milestones should add:

1. the web-component package and a small embed fixture;
2. CI for tests, type checks, production build, and corpus coverage thresholds;
3. a public-code license, contribution guide, changelog, and security policy;
4. Changesets or an equivalent tool for coordinated package versions;
5. GitHub Releases plus npm packages, with an optional CDN mirror;
6. a compatibility report attached to every asset-pack release.

Consumers should pin versions in production. A `latest` URL is convenient for
demos but is unsuitable for a wiki or database because an untested update could
change thousands of existing embeds at once.

See [Upgrading and rollback](upgrading.md) for the current staged deployment,
registry-rebuild decision, compatibility checks, and instructions intended for
both human operators and automated maintenance agents.

## Game asset licensing boundary

The renderer's original TypeScript code is released under MIT. Vintage Story's
Survival, Essentials and API repositories identify their code as proprietary
and disallow redistribution in unmodified form. The official Vintage Story FAQ
separately says game assets may be used for Vintage Story-related content.

The safe default is:

- keep `_local/game`, source checkouts, and `.vsviewer` ignored;
- publish the renderer and compiler, not copied game files;
- let each site compile from a legally obtained asset tree and provide its own
  asset endpoint; and
- review the current FAQ and terms, and ask Anego Studios when a public asset
  distribution falls outside clearly Vintage Story-related content.

This repository deliberately contains no game files or compiled asset registry.
See `docs/asset-pipeline.md` for the exact runtime boundary and portable build.
