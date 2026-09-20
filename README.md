# Vintage Story Schematic Viewer

[![CI](https://github.com/NicIAss/vintage-story-schematic-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/NicIAss/vintage-story-schematic-viewer/actions/workflows/ci.yml)

An unofficial, local-first renderer for Vintage Story JSON schematics. It
parses the game's sparse schematic format, resolves vanilla block and item
assets, renders block-entity geometry, and exports rotating GIF previews.

The project is currently **v0.4.4 alpha**. The renderer works as a Vite web app
and reusable TypeScript core. A standards-based web component and published npm
packages are planned; the supported website integration today is an iframe or
the same-origin JavaScript bridge.

## What is included

- strict schematic parsing, packed positions, decors, and block entities;
- compiled cube textures and JSON shapes, including variants and `ByType`;
- chiseled/microblock geometry with schematic rotation handling;
- chests, crates, shelves, ground storage, piles, support beams, liquids,
  block-entity-selected tapestries, shape-conforming surface overlays, fruit
  trees, soil and foliage tinting;
- chunked solid-cube and microblock rendering with buried-face removal and
  camera-frustum culling for large schematics;
- orbit and no-clip fly cameras, with fly mode omitted on touch-only devices;
- accessible phase and percentage feedback while schematics are loading;
- optional grid, schematic bounds, technical/meta blocks, and a collapsible
  information panel;
- auto-framed rotating GIF export; and
- unresolved blocks hidden by default, with diagnostics and an optional viewer
  toggle.

## Are Vintage Story assets required?

For real textures and shapes, **yes—but they are not committed to this
repository**.

A schematic contains block codes and saved block-entity data; it does not
contain the normal block textures or JSON models. The asset compiler reads a
legally obtained Vintage Story `assets` directory and produces an
`asset-registry.json` file:

- block/item variants and JSON shapes are converted into renderer-ready data;
- texture choices are resolved to URLs; and
- the PNG pixels themselves remain separate files.

After compilation, a website needs only the generated registry and the
referenced PNG hierarchy. It does not need the raw blocktype, itemtype,
worldproperty, or shape JSON at runtime. DLLs and readable-source checkouts are
not runtime inputs.

See [Asset pipeline](docs/asset-pipeline.md) for the exact folder layout,
compiler command, website output, update workflow, and licensing boundary.

## Local development

Requirements:

- Node.js 24 or newer
- pnpm 11
- a legally obtained Vintage Story asset directory for textured rendering

Windows 10/11 and Ubuntu are tested platforms. See
[Windows and Ubuntu](docs/windows-and-ubuntu.md) for platform-specific tool
installation, game-asset locations, local linking, production compilation, and
an Ubuntu/Nginx deployment example.

```bash
pnpm install
```

Copy the contents of the game's `assets` folder so the following directories
exist:

```text
_local/game/assets/game/
_local/game/assets/survival/
_local/game/assets/creative/
```

Then run:

```bash
pnpm dev
```

Open <http://127.0.0.1:5173/> and choose or drop a schematic JSON file. `pnpm
dev` runs the compiler automatically. Use `pnpm assets:compile` separately only
when you want to inspect the compiler or refresh assets while Vite is already
running. A full first compile can take several minutes.

Without a registry the viewer can still parse schematics. Its optional fallback
geometry can aid diagnostics, but it cannot reproduce the real block
appearance and unresolved placeholders are hidden by default.

## Website integration

Build the viewer:

```bash
pnpm build
```

Deploy `apps/desktop/dist/`, a compiled registry, and its referenced textures.
The current iframe endpoint accepts URL-encoded `schematic` and `registry`
parameters:

```html
<iframe
  src="https://viewer.example.org/?schematic=https%3A%2F%2Fexample.org%2Fwatchtower.json&registry=https%3A%2F%2Fcdn.example.org%2Fvs-assets%2F1.22.5%2Fasset-registry.json&mode=embed&controls=recenter%2Ctop%2Cinfo&grid=off&bounds=off&meta=off&unresolved=off&inspector=off"
  loading="lazy"
  allow="fullscreen">
</iframe>
```

Remote servers must allow CORS. Same-origin pages can also call
`window.vsSchematicViewer.loadSchematicJson()`, `loadSchematicUrl()`,
`setOptions()`, and `exportGif()`.

See [Website integration](docs/website-integration.md) for deployment layouts,
the complete current API, GIF automation, caching, and security limits.

## Compatibility

The latest stable Vintage Story release at the time of publication is 1.22.7.
The checked local asset corpus and generated-registry semantics are currently
audited against 1.22.5. Those are deliberately separate claims: a new game
release must be compiled and tested before its asset manifest is labelled
compatible.

Vanilla `game`, `survival`, and `creative` domains are supported. General mod
domain compilation is not implemented yet; unknown modded blocks use fallback
geometry.

## Repository layout

```text
apps/desktop/                 Current Vite viewer and iframe endpoint
packages/renderer-core/       Parser, decoders, asset types, Three.js scenes
tools/asset-compiler/         Local game-assets to renderer-registry compiler
docs/                         Integration, assets, diagnostics, architecture
_local/                       Ignored local game/mod/source inputs
.vsviewer/                    Ignored generated registry and local cache
```

## Documentation

- [Windows and Ubuntu setup and deployment](docs/windows-and-ubuntu.md)
- [Asset pipeline](docs/asset-pipeline.md)
- [Website integration](docs/website-integration.md)
- [Upgrading and rollback](docs/upgrading.md)
- [Embedding and release architecture](docs/embedding-and-releases.md)
- [Local-only input layout](docs/local-inputs.md)
- [Audited Vintage Story asset inventory](docs/vintage-story-assets.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Legal and attribution

This project is unofficial and is not affiliated with or endorsed by Anego
Studios. “Vintage Story” and the game assets belong to their respective owner.
This repository contains only the project's original implementation under the
MIT License; it does not include Vintage Story game assets, official schematics,
DLLs, or Anego source code.

Vintage Story's official FAQ says game assets may be used for Vintage
Story-related content. The readable-source repositories use separate
proprietary terms and must not be copied here. Site operators remain
responsible for ensuring their asset hosting and use comply with the current
official terms.

- [Vintage Story FAQ](https://www.vintagestory.at/faq.html/)
- [Vintage Story Terms of Service](https://www.vintagestory.at/tos.html/)
- [Anego Studios GitHub](https://github.com/anegostudios)

## License

[MIT](LICENSE) © 2026 NicIAss
