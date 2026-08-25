# Contributing

Thanks for helping improve the Vintage Story Schematic Viewer.

## Development setup

Use Node.js 24 or newer and pnpm 11:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

Textured local development additionally requires a legally obtained Vintage
Story asset tree. Follow [docs/asset-pipeline.md](docs/asset-pipeline.md).
Platform-specific setup and asset-location instructions are in
[docs/windows-and-ubuntu.md](docs/windows-and-ubuntu.md).

## Pull requests

- Keep renderer logic in `packages/renderer-core`; product UI belongs in
  `apps/desktop`.
- Add focused tests for parser, geometry, variant, or block-entity changes.
- Run tests, type-checking, and the production build before opening a PR.
- Describe the game version and schematic/block codes used to verify visual
  fixes.
- Preserve existing unrelated work and avoid generated build output.

## Do not upload game files

Issues and pull requests must not contain Vintage Story textures, shapes,
blocktype/itemtype files, official schematics, DLLs, or copied Anego source.
Use code names, small independently written synthetic fixtures, diagnostic
counts, or screenshots where the official terms allow them.

The ignored `_local/` and `.vsviewer/` directories are the intended place for
private development inputs and generated registries.

## Reporting rendering gaps

Include:

- renderer commit/version;
- Vintage Story version;
- schematic `GameVersion` if present;
- unresolved block code or block class;
- expected versus actual orientation/texture/shape; and
- the smallest reproducible description that does not redistribute game data.
