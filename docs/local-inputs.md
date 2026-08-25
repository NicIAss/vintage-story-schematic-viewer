# Local development inputs

The project consumes the user's installed Vintage Story data. Game assets and
official readable-source checkouts are development inputs, not project source,
and must not be committed or redistributed with this repository.

## Local staging tree

All local-only inputs live below `_local/`, which is excluded by `.gitignore`.

```text
_local/
  game/
    assets/                 Installed game's `assets` directory contents
    install/                Optional full game installation
  schematics/
    vanilla/                Selected vanilla/worldgen schematic JSON files
    modded/                 BetterRuins and other mod schematic JSON files
  mods/                     Mod packages/folders needed for asset resolution
  source/                   Official readable-source repository checkouts
    vsapi/
    vsessentialsmod/
    vssurvivalmod/
    vscreativemod/
```

Copy the *contents* of the installed Vintage Story `assets` directory into
`_local/game/assets/`. The expected result is that domain directories such as
`game`, `survival`, and `creative` are direct children of that folder.

The full game installation is optional at first. It will be useful later for
inspecting the exact shipped assemblies, version metadata, and runtime behavior
that are not covered by the readable-source repositories.

## Official source repositories

These Anego Studios repositories are checked out locally:

| Repository | Primary use in this project |
| --- | --- |
| [vsapi](https://github.com/anegostudios/vsapi) | `BlockSchematic`, `TreeAttribute`, `Ascii85`, `ItemStack`, shapes, composite textures/shapes, draw types, and client API contracts |
| [vsessentialsmod](https://github.com/anegostudios/vsessentialsmod) | Core vanilla block behaviors plus standard world-generation schematic structures and loading behavior |
| [vssurvivalmod](https://github.com/anegostudios/vssurvivalmod) | Microblocks/chisels, support beams, display/storage entities, and most survival-specific custom rendering behavior |
| [vscreativemod](https://github.com/anegostudios/vscreativemod) | WorldEdit, schematic capture/import/export workflows, and creative-mode tooling |

The repositories are readable source with Anego Studios' proprietary license
terms. They are references for compatible implementation; substantial source
must not be copied into or redistributed with this project.

## Version alignment

Each repository exposes `stable`, `rc`, `pre`, and `master` branches rather
than version tags. The initial checkouts are on `master` only for discovery.
Before verifying formats or porting behavior:

1. Read the version from the copied game installation/assets and sample
   schematics.
2. Identify the matching repository branch/commit for that shipped version.
3. Record the four exact commit hashes in the asset diagnostic.
4. Treat the shipped assets and assemblies as the final authority when a
   readable-source branch does not exactly match the installation.

## First inspection after copying

The first diagnostic pass will record:

- installed game version and asset-domain roots;
- counts and locations for blocktypes, itemtypes, shapes, textures, and
  worldgen schematics;
- one real schematic's dimensions, block mappings and counts, asset domains,
  decors, block entities, and entities;
- several end-to-end block definition, shape, and texture resolutions.
