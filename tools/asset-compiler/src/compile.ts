import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { compileAssetRegistry } from "./compiler.js";

const projectRoot = path.resolve(import.meta.dirname, "../../..");
const argumentsByName = parseArguments(process.argv.slice(2));
if (argumentsByName.has("help")) {
  process.stdout.write(helpText());
  process.exit(0);
}

const assetRoot = resolveProjectPath(
  argumentsByName.get("assets") ??
    process.env["VS_ASSET_ROOT"] ??
    "_local/game/assets",
);
const outputPath = resolveProjectPath(
  argumentsByName.get("output") ??
    process.env["VS_REGISTRY_OUTPUT"] ??
    ".vsviewer/cache/asset-registry.json",
);
const textureBaseUrl =
  argumentsByName.get("texture-base-url") ??
  process.env["VS_TEXTURE_BASE_URL"] ??
  "/@vs-assets";

const registry = await compileAssetRegistry(assetRoot, {
  textureBaseUrl,
  portable: argumentsByName.has("portable"),
});
if (registry.stats.blockTypeFileCount === 0 || registry.stats.textureFileCount === 0) {
  throw new Error(
    `No usable Vintage Story assets found at ${assetRoot}. ` +
      "Expected game, survival, and creative domain folders. See docs/asset-pipeline.md.",
  );
}
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(registry)}\n`, "utf8");

process.stdout.write(
  [
    `Compiled ${registry.stats.resolvedBlockCodeCount.toLocaleString()} block codes`,
    `${registry.stats.resolvedItemCodeCount.toLocaleString()} item codes`,
    `${registry.stats.texturedCubeCodeCount.toLocaleString()} textured cubes`,
    `${registry.stats.compiledShapeCount.toLocaleString()} shared JSON shapes`,
    `${registry.stats.parseErrorCount.toLocaleString()} parse errors`,
    `Texture URL: ${textureBaseUrl}`,
    `Output: ${outputPath}`,
  ].join(" · ") + "\n",
);

function parseArguments(arguments_: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();
  const flags = new Set(["portable", "help"]);
  const values = new Set(["assets", "output", "texture-base-url"]);
  for (let index = 0; index < arguments_.length; index += 1) {
    const token = arguments_[index];
    if (token === "--") continue;
    if (token === undefined || !token.startsWith("--")) {
      throw new Error(`Unknown argument ${token ?? ""}. Run assets:compile -- --help.`);
    }
    const name = token.slice(2);
    if (flags.has(name)) {
      result.set(name, "true");
      continue;
    }
    if (!values.has(name)) {
      throw new Error(`Unknown option --${name}. Run assets:compile -- --help.`);
    }
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}.`);
    }
    result.set(name, value);
    index += 1;
  }
  return result;
}

function helpText(): string {
  return [
    "Compile a Vintage Story asset tree into the viewer registry.",
    "",
    "Usage:",
    "  pnpm assets:compile -- [options]",
    "",
    "Options:",
    "  --assets <directory>          Root containing game/, survival/, creative/",
    "  --output <file>               Registry JSON output path",
    "  --texture-base-url <url>      Public URL prefix for texture files",
    "  --portable                    Remove the absolute local asset path",
    "  --help                        Show this help",
    "",
    "Environment alternatives: VS_ASSET_ROOT, VS_REGISTRY_OUTPUT,",
    "VS_TEXTURE_BASE_URL.",
    "",
  ].join("\n");
}

function resolveProjectPath(value: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(projectRoot, value);
}
