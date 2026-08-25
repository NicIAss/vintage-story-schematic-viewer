# Schematic diagnostic: m-noble-room

Fixture:

    _local/game/assets/survival/worldgen/schematics/underground/medium/m-noble-room.json

## Summary

| Field | Value |
| --- | ---: |
| GameVersion | 1.22.0-rc.7 |
| Size | 16 × 8 × 16 |
| Block entries | 1,278 |
| BlockIds entries | 1,278 |
| BlockCodes mappings | 60 |
| Referenced BlockCodes | 39 |
| ItemCodes mappings | 13 |
| Decors | 180 |
| Block entities | 179 |
| Entities | 0 |
| Repeated packed block positions | 0 |
| ReplaceMode | 2 |

The fixture validates cleanly with the TypeScript parser: sparse-array lengths
match, every BlockId resolves through BlockCodes, and all decoded positions fit
inside the declared bounds.

All codes use the game domain. The domain is explicit in this newer fixture;
the parser also normalizes older unqualified codes to game.

## Most frequent block entries

| Count | Code |
| ---: | --- |
| 610 | game:rock-granite |
| 155 | game:meta-filler |
| 135 | game:agedstonebricks-granite |
| 89 | game:drystone-granite |
| 82 | game:microblock |
| 45 | game:clutter |
| 19 | game:cobblestone-granite |
| 16 | game:clutteredbookshelf |
| 16 | game:spiderweb |
| 14 | game:rocktyped-rubble-free |
| 12 | game:loosestones-granite-free |
| 11 | game:crackedrock-granite |

This is a useful progressive fixture because it combines ordinary cubes,
JSON-shaped blocks, cross geometry, decors, microblocks, clutter/display block
entities, storage, fences, stairs, slabs, planters, and ground storage.

## Current rendering status

The current audited renderer resolves all 1,278 entries with real textures,
including 139 JSON-shaped entries, 82 chiseled/microblock entries, and both
ground-storage displays. It reports 100.0% rendering coverage for this fixture.
All 179 block entities decode as Vintage Story `TreeAttribute` data without
errors.

The 174 technical/meta entries are hidden by default and can be shown with the
viewer control. Block-entity-selected clutter, bookshelf, rubble, chest, and
crate variants use their real shapes, textures, rotations, and offsets. The two
ground-storage entities now decode their sparse inventories and render the
ruined dagger, rotten book, and metal-parts models at their saved layout slots
and mesh angles.

Live verification completed with 1,104 visible entries, zero placeholders, 675
draw calls, and 32,504 triangles without browser-console errors. The
comparatively high draw call count is expected from the first
correctness-oriented microblock mesh; internal-face culling and batching are
later optimization work.
