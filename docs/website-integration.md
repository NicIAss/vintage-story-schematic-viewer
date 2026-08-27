# Website integration

## Current release surface

Version 0.2.0 provides a Vite viewer that can be deployed as a standalone page
and embedded in an iframe. A custom element and npm packages are planned but do
not exist yet. Consumers should pin a Git commit or release tag while the API is
alpha.

The viewer deployment needs three independent resources:

```text
viewer application  -> apps/desktop/dist/
asset registry      -> asset-registry.json compiled for one game asset set
texture hierarchy   -> game/textures, survival/textures, creative/textures
schematic            -> one Vintage Story schematic JSON
```

See [Asset pipeline](asset-pipeline.md) before deploying the registry or
textures. Existing installations should also follow the staged procedure in
[Upgrading and rollback](upgrading.md).

## Build and deploy

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

Deploy the contents of `apps/desktop/dist/` to a static host. The viewer reads
the registry from the `registry` query parameter, the Vite build-time
`VITE_VS_REGISTRY_URL`, or `/@vs-registry` in that order.

Enable Brotli/gzip and immutable caching for a versioned registry. The complete
vanilla registry is intentionally comprehensive and is large without HTTP
compression. Reuse one viewer/registry for successive schematics where the
host layout allows it.

An environment example is available at `apps/desktop/.env.example`.

## Iframe embed

```html
<iframe
  title="Vintage Story schematic preview"
  src="https://viewer.example.org/?schematic=https%3A%2F%2Fwiki.example.org%2Fschematics%2Fwatchtower.json&registry=https%3A%2F%2Fcdn.example.org%2Fvs-assets%2F1.22.5%2Fasset-registry.json&grid=off&bounds=off&meta=off&unresolved=off"
  loading="lazy"
  allow="fullscreen"
  style="width: 100%; aspect-ratio: 16 / 9; border: 0">
</iframe>
```

Supported query parameters:

| Parameter | Meaning |
| --- | --- |
| `schematic` | HTTP(S) URL of the schematic JSON, limited to 16 MB |
| `registry` | URL of a format-v2 compiled asset registry |
| `grid` | `on/off`, `true/false`, `1/0`, or `yes/no` |
| `bounds` | Show or hide the declared schematic boundary |
| `meta` | Show or hide technical/meta blocks |
| `unresolved` | Show or hide unresolved colored placeholder blocks; hidden by default |

Remote schematic and registry servers must allow the viewer origin through
CORS. Texture URLs embedded in the registry must do the same. Prefer HTTPS for
all production resources to avoid mixed-content blocking.

## Same-origin JavaScript bridge

When the host and iframe share an origin, the current bridge is available at
`iframe.contentWindow.vsSchematicViewer`:

```js
const viewer = document.querySelector("iframe").contentWindow.vsSchematicViewer;

await viewer.loadSchematicUrl("/schematics/watchtower.json");

viewer.setOptions({
  grid: false,
  bounds: false,
  metaBlocks: false,
  unresolvedBlocks: false,
});

console.log(viewer.version);
console.log(viewer.getOptions());
```

Raw JSON can be supplied without another viewer-side request:

```js
await viewer.loadSchematicJson(jsonText, "watchtower.json");
```

Methods return promises when loading or rendering work is asynchronous. A
cross-origin parent cannot call this bridge because of the browser same-origin
policy; use query parameters there.

## GIF export

```js
const gif = await viewer.exportGif({
  size: 560,
  frameCount: 42,
  framesPerSecond: 14,
  includeGrid: false,
  includeBounds: false,
  includeMetaBlocks: false,
  includeUnresolvedBlocks: false,
});
```

The result is an `image/gif` `Blob`. Defaults hide grid, bounds, meta blocks,
and unresolved placeholders. Framing is based only on visible renderable
geometry, so technical placement blocks do not shrink the preview.

For a schematic database, generate previews at upload time in a browser worker
and cache by:

```text
schematic hash + renderer version + registry version/hash + export settings
```

List pages should use a still or generated animation and instantiate the 3D
viewer only after user interaction. This substantially reduces WebGL contexts,
texture downloads, and parsing work.

The interactive viewer renders on visual changes rather than continuously,
caps its effective pixel count, pauses in background tabs, and targets at most
60 frames per second. The no-clip fly camera depends on keyboard movement and
pointer lock, so it is intentionally hidden on touch-only mobile devices; orbit
controls remain available there.

## Hosting presets

The wiki and database can use the same viewer release with different URLs:

```text
Wiki:     ?grid=off&bounds=off&meta=off&unresolved=off
Database: ?grid=on&bounds=on&meta=off&unresolved=off
Editor:   ?grid=on&bounds=on&meta=on&unresolved=on
```

Do not fork the renderer to change these defaults. Keep the renderer and asset
registry version pinned centrally so a game update can be rolled out and
reverted consistently.

## Security and operational limits

- Only HTTP(S) remote schematics are accepted.
- Remote schematic responses are capped at 16 MB.
- JSON is parsed as data; it is never evaluated as JavaScript.
- The development asset middleware restricts requests to PNG files inside the
  configured local asset root.
- Production hosts should set CSP, MIME types, cache headers, and CORS
  deliberately.
- Do not accept an arbitrary user-controlled registry URL on a privileged
  origin unless that is part of the site's threat model.

## Planned package API

The intended next public surface is a standards-based
`<vs-schematic-viewer>` custom element backed by `@vs-schematic/renderer-core`.
It will replace iframe-only integration without tying consumers to React, Vue,
or a particular wiki engine. The current bridge and URL option names are the
compatibility baseline for that component.
