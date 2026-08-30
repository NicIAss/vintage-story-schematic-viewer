# Changelog

All notable changes will be documented in this file.

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
