# Security policy

## Supported versions

Security fixes currently target the latest commit on `main` while the project
is pre-1.0.

## Reporting a vulnerability

Please use GitHub's private security-advisory reporting for this repository.
Do not open a public issue for vulnerabilities involving remote schematic
loading, asset URL handling, path traversal, denial of service, or dependency
compromise.

Include reproduction steps, affected commit, impact, and any suggested
mitigation. Please avoid attaching proprietary game assets.

## Scope notes

The viewer treats schematics and registries as untrusted data. Remote
schematics are restricted to HTTP(S) and 16 MB. The local development asset
server exposes only PNG files beneath the configured game-asset root.
Production deployers are responsible for CORS, CSP, authentication, rate
limits, and the trust policy for registry URLs.
