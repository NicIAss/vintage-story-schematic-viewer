# Changelog

All notable changes will be documented in this file.

## 0.4.2 - 2026-09-20

Schematic loading feedback and camera controls:

- added a centered, accessible loading panel with a percentage bar and current
  loading phase for standalone, embedded, local-file, URL, and host-API loads;
- connected the indicator to actual file download, parsing, registry, texture,
  geometry, and finalization work instead of an estimated timer;
- added renderer-core progress callbacks for texture and geometry creation;
- yielded periodically during geometry construction so large schematics keep
  repainting and visibly advance the progress bar; and
- added clean completion fading, error cleanup, and stale-load protection when
  a newer schematic is selected before an older load finishes;
- shortened the orbit camera's damping tail while retaining smooth rotational
  momentum; and
- restored a build-aware orbit pivot after leaving fly mode, so returning to
  orbit mode rotates around the viewed schematic instead of behaving like a
  fixed-distance first-person camera.

This is a viewer and renderer-runtime update. Existing format-v2 registries,
texture trees, embed settings, and schematic JSON files require no migration or
rebuild.

## 0.4.1 - 2026-09-20

Surface-decor geometry correction:

- changed texture-only decors such as dust, grime, gravel, moss, and damaged
  stone to reuse the resolved host block model instead of a full-cell plane;
- limited each generated decal mesh to triangles facing its saved attachment
  side and retained the host model's UV layout, rotations, offsets, and shape;
- applied the same path to block-entity-selected models such as clutter and
  rotated wagon wheels, as well as regular JSON shapes and partial cuboids;
- retained the existing face-plane fallback for unsupported dynamic hosts and
  voxel sub-position decors; and
- added geometry regression tests for partial-block sizing and face selection.

This is a renderer-only patch. Existing format-v2 registries, texture trees,
embed settings, and schematic JSON files require no migration or rebuild.

## 0.4.0 - 2026-09-07

Compact viewer interface update:

- removed the non-interactive asset-mode badge from the viewport;
- removed the decorative `VS` mark while retaining the viewer name and version;
- made the side information panel hidden by default so the viewport receives
  the full available width;
- added an accessible `Show info` / `Hide info` toolbar control;
- added `inspector=on|off`, the `info` control allowlist entry, and the
  `inspector` same-origin presentation option for website-specific layouts; and
- made the information panel an overlay on narrow screens instead of reducing
  the viewport width.

This release changes only the viewer application. Existing format-v2
registries, textures, and schematic JSON files require no migration.

## 0.3.0 - 2026-08-30

Website embedding controls:

- added `mode=embed`, which removes local file selection and drag/drop before
  the viewer's first paint while still accepting a predefined schematic URL or
  same-origin host API load;
- added the `controls` URL allowlist so hosts can independently expose or hide
  open, grid, bounds, GIF export, meta, unresolved, fly, recenter, and top-view
  actions;
- added same-origin `getPresentationOptions()` and
  `setPresentationOptions()` methods for runtime presentation changes;
- added embed-specific loading, waiting, and failure copy that never invites
  visitors to select a local file; and
- documented fixed wiki/database presets and the distinction between UI policy
  and a security boundary.

This release changes only the viewer application. It requires no asset-registry,
texture, or schematic migration.

## 0.2.0 - 2026-08-27

Rendering, embedding, and performance update:

- added dynamic fruit-tree branches, foliage, growth direction, fruiting state,
  and climate/season tinting from schematic block-entity data;
- hid unresolved placeholder blocks by default while retaining diagnostics and
  adding URL, toolbar, same-origin API, and GIF-export controls;
- switched the interactive viewer to event-driven rendering with adaptive
  pixel density, a 60 FPS ceiling, and background-tab pausing;
- disabled the keyboard-oriented fly camera on touch-only mobile devices;
- preserved per-texture dimensions and per-element render passes in compiled
  shapes, fixing stretched tall-door textures and transparent window glass;
- corrected displaced or apparently mirrored short support beams;
- expanded renderer, compiler, embed-option, and performance regression tests;
  and
- added a production upgrade and rollback guide for website operators and
  automated maintenance agents.

The registry remains format v2, but a registry rebuilt with the 0.2.0 compiler
is required to receive the door, window, and fruit-tree improvements. Existing
schematic JSON files require no migration.

## 0.1.0 - 2026-08-25

Initial public alpha:

- validated Vintage Story schematic parser and block-entity decoding;
- Three.js renderer for vanilla cubes, JSON shapes, chiseled blocks, storage,
  beams, liquids, decors, overlays, tinting, and technical blocks;
- local Vintage Story asset compiler and format-v2 registry;
- orbit and no-clip fly cameras with grid/bounds/meta controls;
- auto-framed rotating GIF export;
- iframe URL loading and same-origin bridge; and
- public asset-pipeline, deployment, architecture, and contribution docs.
