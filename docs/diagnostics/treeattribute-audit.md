# TreeAttribute schematic audit

The copied Vintage Story 1.22.5 survival schematic set was used as a broad
compatibility audit after implementing the block-entity decoder.

| Field | Result |
| --- | ---: |
| Schematic files | 701 |
| Parsed successfully | 701 |
| Parse failures | 0 |
| Block entities | 102,291 |
| Block entities decoded | 102,291 |
| Decode failures | 0 |
| Microblock entities | 15,829 |
| Schematics containing microblocks | 217 |

The decoder follows the current official game API format: Ascii85 transport,
.NET `BinaryReader` strings, recursive attribute type tags, item stacks, and
primitive/array attribute values. Decode failures are non-fatal to schematic
loading and are surfaced as parser warnings so one malformed custom entity does
not prevent the rest of a structure from rendering.
