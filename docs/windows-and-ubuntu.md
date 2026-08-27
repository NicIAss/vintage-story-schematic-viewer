# Windows and Ubuntu

The viewer is supported on Windows and Linux, with Ubuntu as the reference
Linux distribution. Every change is built, type-checked, and tested on both
`windows-latest` and `ubuntu-latest` in GitHub Actions.

The application is a browser-based TypeScript/WebGL project. Its development
and build commands are the same on both platforms; only path syntax and the
location of the private Vintage Story assets differ.

## Support matrix

| Environment | Status | Notes |
| --- | --- | --- |
| Windows 10/11, PowerShell | Supported | Primary development environment and CI verified |
| Ubuntu, Bash | Supported | CI verified; Ubuntu is the reference Linux distribution |
| Other current Linux distributions | Expected to work | Node.js, pnpm, filesystem, and browser requirements are the same, but they are not in CI |
| macOS | Unverified | No known architectural dependency, but it is not currently tested |

Runtime viewers need a current WebGL-capable browser. Developers and build
servers need Node.js 24 or newer and the pnpm version pinned in
`package.json` (currently 11.19.0). The game itself and .NET are not needed to
build or host this viewer. A legally obtained game `assets` directory is needed
only to compile and serve the real block shapes and textures.

## Install the development tools

Install the current Node.js 24 release from the official Node.js downloads,
then verify it:

```text
node --version
```

The result should begin with `v24` or a newer supported major version. Node.js
24 includes Corepack, which can activate the exact pnpm release used by this
repository:

```text
corepack enable
corepack install --global pnpm@11.19.0
pnpm --version
```

If a managed Windows installation does not allow Corepack to create its
command shims, install the pinned version with npm instead:

```powershell
npm install --global pnpm@11.19.0
```

Official references:

- [Node.js 24 downloads](https://nodejs.org/en/download/archive/v24)
- [pnpm installation](https://pnpm.io/installation)

## Clone and install

The following commands work in PowerShell and Bash:

```text
git clone https://github.com/NicIAss/vintage-story-schematic-viewer.git
cd vintage-story-schematic-viewer
pnpm install --frozen-lockfile
```

The untextured fallback viewer can now be checked with `pnpm build`. Follow the
next section before `pnpm dev` when real game textures are required.

## Connect local game assets

Local textured development expects this exact repository-relative layout:

```text
_local/game/assets/
  game/
  survival/
  creative/
```

`_local/` is ignored by Git. Copying the game assets there is the simplest
option. A directory junction or symbolic link avoids duplicating the files.
Do not point at `VintagestoryData`: it contains saves, settings, logs, and mods,
not the installed game assets.

### Windows

The usual installed asset path is
`$env:APPDATA\Vintagestory\assets`. If the game was installed elsewhere, use
`<installation directory>\assets` instead.

Copy the assets in PowerShell:

```powershell
New-Item -ItemType Directory -Force "_local\game" | Out-Null
Copy-Item -Recurse "$env:APPDATA\Vintagestory\assets" "_local\game\assets"
```

Or create a junction without copying the files:

```powershell
New-Item -ItemType Directory -Force "_local\game" | Out-Null
New-Item -ItemType Junction -Path "_local\game\assets" -Target "$env:APPDATA\Vintagestory\assets"
```

Change the target when using a custom installation. The target is correct when
`Test-Path "_local\game\assets\survival\textures"` returns `True`.

### Ubuntu

The official Vintage Story asset documentation lists these common locations:

```text
# Official per-user Flatpak
~/.local/share/flatpak/app/at.vintagestory.VintageStory/current/active/files/extra/vintagestory/assets

# System-wide Flatpak
/usr/lib/flatpak/app/at.vintagestory.VintageStory/current/active/files/extra/vintagestory/assets

# install.sh installation
~/ApplicationData/vintagestory/assets

# Manually extracted archive
<extracted vintagestory directory>/assets
```

For a per-user Flatpak installation, create a symbolic link in Bash:

```bash
mkdir -p _local/game
ln -s "$HOME/.local/share/flatpak/app/at.vintagestory.VintageStory/current/active/files/extra/vintagestory/assets" _local/game/assets
```

Replace the source with the appropriate path for another installation method.
The target is correct when this command prints the three vanilla packs:

```bash
find -L _local/game/assets -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort
```

Linux paths are case-sensitive. Preserve the original lowercase pack,
directory, and texture names; renaming `survival` to `Survival`, for example,
will break asset resolution.

Official asset-location reference:
[Vintage Story asset system](https://wiki.vintagestory.at/Basic_Modding).

## Run and verify locally

On either platform:

```text
pnpm dev
```

The `predev` script first compiles `_local/game/assets` into the ignored
`.vsviewer/cache/asset-registry.json`, then starts Vite at
<http://127.0.0.1:5173/>. A full initial asset compile can take several
minutes. Stop the server with `Ctrl+C`.

Before contributing or deploying, run the same checks as CI:

```text
pnpm test
pnpm typecheck
pnpm build
```

The production viewer is written to `apps/desktop/dist/`.

## Compile production assets from any location

The fixed `_local/game/assets` path applies only to the convenient local Vite
workflow. Production compilation accepts any absolute or relative input path.

PowerShell example:

```powershell
pnpm assets:compile -- --assets "$env:APPDATA\Vintagestory\assets" --output ".\deploy\vs-assets\1.22.5\asset-registry.json" --texture-base-url "https://cdn.example.org/vs-assets/1.22.5" --portable
```

Ubuntu/Bash example for the per-user Flatpak:

```bash
pnpm assets:compile -- \
  --assets "$HOME/.local/share/flatpak/app/at.vintagestory.VintageStory/current/active/files/extra/vintagestory/assets" \
  --output "./deploy/vs-assets/1.22.5/asset-registry.json" \
  --texture-base-url "https://cdn.example.org/vs-assets/1.22.5" \
  --portable
```

The website also needs the referenced PNGs under the same
`game/textures`, `survival/textures`, and `creative/textures` hierarchy. See
[Asset pipeline](asset-pipeline.md) for the complete production layout and
release asset process. For an existing website, follow
[Upgrading and rollback](upgrading.md) before replacing the live version.

## Ubuntu static hosting example

The build has no Node.js server requirement. It can be copied to any static
host. One Nginx layout is:

```text
/srv/vs-viewer/
  index.html                 from apps/desktop/dist/
  assets/                    Vite's compiled JavaScript and CSS
  vs-assets/1.22.5/
    asset-registry.json
    game/textures/
    survival/textures/
    creative/textures/
```

An example server block follows. Replace the hostnames and restrict the CORS
origin to the actual wiki or database origin. The fallback to `index.html`
keeps the standalone viewer endpoint usable, while versioned registries,
textures, and Vite bundles receive long-lived caching.

```nginx
server {
    listen 80;
    server_name viewer.example.org;
    root /srv/vs-viewer;
    index index.html;

    include /etc/nginx/mime.types;
    gzip on;
    gzip_vary on;
    gzip_types application/json application/javascript text/css;

    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location /vs-assets/ {
        try_files $uri =404;
        add_header Access-Control-Allow-Origin "https://wiki.example.org" always;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache" always;
    }
}
```

Use HTTPS in production. The standard Nginx gzip module handles the large JSON
registry when `application/json` is included. Brotli requires an additional
Nginx module and is optional; do not assume it is available in a default Ubuntu
package. If schematics are served from a separate origin, that server must also
allow the viewer origin through CORS.

Nginx references:

- [gzip module](https://nginx.org/en/docs/http/ngx_http_gzip_module.html)
- [response headers](https://nginx.org/en/docs/http/ngx_http_headers_module.html)

## Platform troubleshooting

### The viewer has colored fallback cubes but no textures

- Confirm `_local/game/assets/game`, `survival`, and `creative` exist.
- Confirm `.vsviewer/cache/asset-registry.json` was generated.
- Restart `pnpm dev` after changing the linked or copied asset tree.
- On Ubuntu, check spelling and letter case throughout the texture hierarchy.

### `pnpm` is not found

Open a new terminal after installing pnpm. Then run `where.exe pnpm` on Windows
or `command -v pnpm` on Ubuntu. Re-run the Corepack commands above if needed.

### Ubuntu returns `EACCES`

Keep the repository and generated registry writable by the normal development
user. Read access to the game assets is sufficient; do not run the viewer or
compiler as root merely to bypass permissions.

### A remote registry or texture fails in the browser

Check the browser network panel for a 404, incorrect MIME type, mixed HTTP/HTTPS
content, or a missing `Access-Control-Allow-Origin` response header. URLs in a
portable registry use forward slashes on both Windows and Linux.
