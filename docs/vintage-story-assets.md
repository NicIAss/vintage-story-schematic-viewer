# Vintage Story asset inventory

Inspection date: 2026-08-25

## Version policy

The renderer targets the newest readable code available on the official master
branches. Exact reference commits at inspection time:

| Repository | Commit | Repository version message |
| --- | --- | --- |
| vsapi | 324ccf9e | Updated to Version 1.22.5 |
| vsessentialsmod | 0cd7da3 | Updated to Version 1.22.5 |
| vssurvivalmod | dfaeb44 | Updated to Version 1.22.5 |
| vscreativemod | 1c64971 | Updated to Version 1.22.0-rc.1 |

Creative has not published a newer master commit. It remains the newest
available Creative reference while API, Essentials, and Survival use 1.22.5.

The official latest stable game release is now 1.22.7. The local inputs and
registry deliberately remain pinned to 1.22.5 until a fresh 1.22.7 asset copy
is supplied and audited. Source-branch freshness alone is not enough to claim
asset compatibility with a newer game release.

Release reference: [Vintage Story 1.22.7 announcement](https://www.vintagestory.at/forums/topic/22215-v1227-auction-house-upgrades/).

Bundled schematic GameVersion fields are not used to select renderer semantics.
They indicate the version that last saved each fixture and are used for
backward-compatibility/remapping tests.

## Copied domains

The local asset root is:

    _local/game/assets/

Present domains:

- game
- survival
- creative

Total files: 16,936.

| Domain | Category | Files |
| --- | --- | ---: |
| game | blocktypes | 2 |
| game | config | 24 |
| game | lang | 34 |
| game | shapes | 1 |
| game | textures | 182 |
| survival | blocktypes | 533 |
| survival | config | 128 |
| survival | dialog | 3 |
| survival | itemtypes | 312 |
| survival | shapes | 4,735 |
| survival | textures | 9,358 |
| survival | worldgen | 1,454 |
| survival | worldproperties | 25 |
| survival | patches | 10 |
| creative | blocktypes | 8 |
| creative | dialog | 15 |
| creative | itemtypes | 3 |
| creative | shapes | 8 |
| creative | textures | 101 |

The copied worldgen tree contains 701 valid BlockSchematic JSON fixtures.

## Required variant and patch inputs

The following essential source asset categories were added after the initial
inspection:

- survival/worldproperties: 25 files
- survival/patches: 10 files

They are required for accurate asset compilation. There are 281
loadFromProperties, loadFromPropertiesCombine, climateColorMap, or
seasonColorMap references in the copied block/item definitions.

Examples:

- rock-granite loads its rock state from block/rockwithdeposit;
- cobblestone stairs load rock and orientation states from world properties;
- patches can change a block/item definition before variants and ByType fields
  are resolved.

The currently copied vanilla definitions resolve these inputs from the
survival domain. Sounds, music, recipes, and shaders are not required for the
first renderer milestones.

Color-map configuration and textures are already present under config and
textures, including game/config/colormaps.json and survival/config/colormaps.json.

## Format findings

- Schematic JSON is strict JSON.
- Blocktype and itemtype definitions are JSON5-like: comments, unquoted keys,
  and trailing commas are common.
- Position packing in current vsapi uses 10 bits per coordinate:

      x = packed & 0x3ff
      z = (packed >> 10) & 0x3ff
      y = (packed >> 20) & 0x3ff

- A repeated packed position can be valid because solid and fluid layers can be
  stored as separate sparse entries at the same coordinate.
- DecorIds pack the decor block id into the low 24 bits and the decor
  face/subposition value above bit 23.
- ByType properties use the first matching key in source order.
- Variant multiplication, allowedVariants, skipVariants, inheritance,
  first-match ByType selection, regex/glob matching, and placeholder filling
  are now ported from the current `RegistryObjectTypeLoader` and
  `RegistryObjectType.solveByType` behavior.

## Compiled registry

Run `pnpm assets:compile` to generate the ignored local file:

    .vsviewer/cache/asset-registry.json

Current compilation result:

| Field | Count |
| --- | ---: |
| Parsed blocktype files | 543 |
| Parsed itemtype files | 315 |
| Parsed worldproperty files | 25 |
| Inventoried patch files | 10 |
| Indexed PNG textures | 9,582 |
| Concrete block codes | 16,068 |
| Concrete item codes | 3,918 |
| Compiled shared JSON shapes | 2,953 |
| Cube codes with a resolved texture | 2,185 |
| Cube codes missing a direct all-face texture | 57 |
| JSON5 parse errors | 0 |

The development server exposes only this generated registry and PNGs beneath
the copied asset root. Patch files are inventoried but are not mutated into
definitions yet; the general patch engine remains a later compatibility step.

## Verified resolution examples

| Schematic block | Definition | Shape | Texture candidates |
| --- | --- | --- | --- |
| game:rock-granite | survival/blocktypes/stone/rock.json | game:block/basic/cube | survival/textures/block/stone/rock/granite1..4.png |
| game:agedstonebricks-granite | survival/blocktypes/stone/stonebrick/agedstonebricks.json | game:block/basic/cube | survival/textures/block/stone/agedbrick/granite1..4.png |
| game:drystone-granite | survival/blocktypes/stone/drystone.json | game:block/basic/cube | survival/textures/block/stone/drystone/granite1..8.png |
| game:cobblestonestairs-granite-up-east-free | survival/blocktypes/stone/cobble/cobblestonestairs.json | survival:block/basic/stairs/normal rotated 270 degrees | survival/textures/block/stone/cobblestonestairs/granite.png |
| game:spiderweb | survival/blocktypes/spiderweb.json | survival:block/basic/cross-short-static | survival/textures/block/creature/spiderwebs/normal1..2.png |
| game:microblock | survival/blocktypes/chiseled/microblock.json | block entity geometry | materials and cuboids from BlockEntity data |

The cube and stair shape files were both located and inspected successfully.

## Chiseled-block rotation

`BEMicroBlock.RotateModel()` in the current survival source transforms the
packed cuboid coordinates when a schematic is rotated. The separately saved
`rotation` value is then used by `GenRotatedMaterialIds()` for directional
material and decor lookup; it is not an additional geometry transform.

The copied `trader/treehouse/hut3.json` fixture contains a direct regression
example: the same one-cuboid material appears at `(8, 6, 8)` with rotation 0
and packed cuboid `16776396`, and at `(10, 6, 13)` with rotation -180 and packed
cuboid `4141248`. Applying the saved rotation to geometry a second time makes
those distinct stored corners coincide. The renderer now preserves the stored
cuboids and retains the rotation only in the material-resolution signature.
