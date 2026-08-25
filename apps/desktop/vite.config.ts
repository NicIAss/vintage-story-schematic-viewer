import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const assetRoot = path.join(projectRoot, "_local/game/assets");
const registryPath = path.join(projectRoot, ".vsviewer/cache/asset-registry.json");

export default defineConfig({
  plugins: [localVintageStoryAssets()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2023",
  },
});

function localVintageStoryAssets(): Plugin {
  return {
    name: "local-vintage-story-assets",
    configureServer(server): void {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = request.url?.split("?", 1)[0] ?? "";
        if (requestUrl === "/@vs-registry") {
          try {
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.setHeader("Cache-Control", "no-store");
            response.end(await readFile(registryPath));
          } catch {
            response.statusCode = 404;
            response.end("Asset registry not compiled. Run pnpm assets:compile.");
          }
          return;
        }

        const prefix = "/@vs-assets/";
        if (!requestUrl.startsWith(prefix)) {
          next();
          return;
        }
        let decodedPath: string;
        try {
          decodedPath = decodeURIComponent(requestUrl.slice(prefix.length));
        } catch {
          response.statusCode = 400;
          response.end("Malformed asset path.");
          return;
        }
        const absolutePath = path.resolve(assetRoot, decodedPath.replaceAll("/", path.sep));
        const relativePath = path.relative(assetRoot, absolutePath);
        const outsideRoot = relativePath.startsWith("..") || path.isAbsolute(relativePath);
        if (outsideRoot || path.extname(absolutePath).toLowerCase() !== ".png") {
          response.statusCode = 403;
          response.end("Only local PNG textures inside the copied asset root are exposed.");
          return;
        }
        response.statusCode = 200;
        response.setHeader("Content-Type", "image/png");
        response.setHeader("Cache-Control", "public, max-age=3600");
        const stream = createReadStream(absolutePath);
        stream.on("error", () => {
          if (!response.headersSent) {
            response.statusCode = 404;
          }
          response.end();
        });
        stream.pipe(response);
      });
    },
  };
}
