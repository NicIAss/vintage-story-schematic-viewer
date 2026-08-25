# Asset pipeline

## Short answer

The renderer has its own parsing and geometry implementation, but it does not
invent or embed Vintage Story's normal block appearance. A vanilla schematic
usually stores only block codes and block-entity state. Real rendering needs:

1. a compiled asset registry; and
2. the PNG textures referenced by that registry.

The compiler converts definitions and shapes into renderer-ready JSON. Raw
blocktype, itemtype, worldproperty, and shape files are not needed by the web
viewer after compilation. PNG texture pixels are not placed inside the
registry, JavaScript bundle, or schematic.

## Input directory

Point the compiler at the directory whose direct children are the three
vanilla asset packs:

```text
assets/
  game/
    blocktypes/
    config/
    shapes/
    textures/
  survival/
    blocktypes/
    config/
    itemtypes/
    patches/
    shapes/
    textures/
    worldproperties/
  creative/
    blocktypes/
    itemtypes/
    shapes/
    textures/
```

The compiler currently reads:

- `blocktypes` and `itemtypes` for codes, classes, variants, textures and
  shapes;
- `worldproperties` for variant expansion;
- `shapes` for cuboid model geometry and UVs;
- `textures/**/*.png` for URL resolution;
- `config/colormaps.json` for climate/season tint maps; and
- `game/config/remaps.json` for legacy block and item codes.

Patch files are inventoried, but the general JSON patch engine is not yet
implemented. Music, sounds, recipes, language files, shaders, DLLs, and
world-generation configuration are not required to render an already supplied
schematic. Worldgen schematics are useful only as test/viewer inputs.

The current compiler load order is `game`, `survival`, `creative`. Arbitrary
mod domains are not yet compiled.

## Local development compile

The default command expects `_local/game/assets/` and writes the ignored local
registry `.vsviewer/cache/asset-registry.json`:

```bash
pnpm assets:compile
```

The Vite development server exposes that registry as `/@vs-registry` and only
serves PNG files under the copied asset root as `/@vs-assets/...`.

## Portable website compile

All paths are configurable:

```bash
pnpm assets:compile -- \
  --assets "D:/Games/Vintagestory/assets" \
  --output "./deploy/vs-assets/1.22.5/asset-registry.json" \
  --texture-base-url "https://cdn.example.org/vs-assets/1.22.5" \
  --portable
```

PowerShell can use the same command on one line. The options are:

| Option | Purpose |
| --- | --- |
| `--assets <directory>` | Input root containing `game/`, `survival/`, `creative/` |
| `--output <file>` | Registry JSON destination |
| `--texture-base-url <url>` | URL prefix written into resolved texture entries |
| `--portable` | Replaces the developer's absolute asset-root path with `.` |
| `--help` | Prints command help |

Environment alternatives are `VS_ASSET_ROOT`, `VS_REGISTRY_OUTPUT`, and
`VS_TEXTURE_BASE_URL`.

With the example base URL, the website must make the following paths available:

```text
https://cdn.example.org/vs-assets/1.22.5/game/textures/...
https://cdn.example.org/vs-assets/1.22.5/survival/textures/...
https://cdn.example.org/vs-assets/1.22.5/creative/textures/...
```

Copy or serve the PNG files while preserving the `<pack>/textures/...`
hierarchy. Do not place them in the Git repository. If the registry or textures
are on a different origin from the viewer, that server must send an appropriate
`Access-Control-Allow-Origin` header.

The complete vanilla registry is large as uncompressed JSON (the audited
1.22.5 corpus is roughly 82 MB, about 3.4 MB with gzip or 2.2 MB with Brotli in
the current build). Serve it with compression, an immutable content-hashed
filename, and long-lived cache headers. A page should share one registry across
schematic loads rather than creating a separate viewer and registry download
for every list card. Registry segmentation is a future optimization.

## What the registry contains

The generated `asset-registry.json` contains:

- expanded concrete block and item codes;
- resolved legacy aliases and texture candidates;
- cube face textures, overlays and rotations;
- compiled JSON shape elements, UVs, transforms and texture bindings;
- block-entity-selected shapes and ground-storage layouts;
- support-beam, decor, pile and tint metadata; and
- compiler statistics, diagnostics and compatibility metadata.

Chiseled/microblock cuboids are different: their detailed geometry and material
IDs are stored in each schematic's block-entity data and are decoded at load
time. The registry still supplies the referenced material textures.

## Updating for a game release

1. Copy the new installation's `assets` directory to a new local staging path.
2. Compile it to a versioned output directory.
3. Run `pnpm test`, `pnpm typecheck`, and `pnpm build`.
4. Audit representative vanilla schematics and the unresolved-block report.
5. Publish the immutable registry and matching PNG hierarchy.
6. Change a website's tested asset channel only after the audit passes.

Renderer releases and asset manifests are versioned independently. A renderer
bug fix should not require republishing textures; a game asset update should not
require copying renderer source into every consumer website.

## Licensing boundary

No Vintage Story assets or official source are stored in this repository. The
official FAQ currently permits game-asset use for Vintage Story-related
content, while the official readable-source repositories carry proprietary
terms that prohibit unmodified redistribution. These are separate materials
and terms.

This documentation is not legal advice. Keep the viewer clearly unofficial,
review the current official terms before public asset hosting, and contact
Anego Studios when the intended distribution is unclear.

- [Vintage Story FAQ](https://www.vintagestory.at/faq.html/)
- [Vintage Story Terms of Service](https://www.vintagestory.at/tos.html/)
- [Anego Studios repositories](https://github.com/anegostudios)
