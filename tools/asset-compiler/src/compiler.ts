import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import JSON5 from "json5";
import type {
  AssetRegistry,
  CompiledBlockDefinition,
  CompiledColorMapReference,
  CompiledDecorProperties,
  CompiledEntityShapeSet,
  CompiledGroundStorageProperties,
  CompiledItemDefinition,
  CompiledModelTransform,
  CompiledPileProperties,
  CompiledShape,
  CompiledShapeElement,
  CompiledShapeFace,
  CompiledShapeReference,
  CubeFace,
  RegistryCubeTextures,
  RegistryFaceTexture,
  RegistryTexture,
} from "./types.js";

const PACKS = ["game", "survival", "creative"] as const;
const MAX_VARIANTS_PER_TYPE = 250_000;
const CUBE_FACES = ["east", "west", "up", "down", "south", "north"] as const;
const FACE_TEXTURE_KEYS: Readonly<Record<CubeFace, readonly string[]>> = {
  east: ["east", "westeast", "horizontals", "sides", "all"],
  west: ["west", "westeast", "horizontals", "sides", "all"],
  up: ["up", "verticals", "all"],
  down: ["down", "verticals", "all"],
  south: ["south", "northsouth", "horizontals", "sides", "all"],
  north: ["north", "northsouth", "horizontals", "sides", "all"],
};
const LEGACY_LIQUID_REMAPS: readonly LegacyCodeRemap[] = Array.from(
  { length: 7 },
  (_, index) => ({
    currentCode: `game:water-still-${index + 1}`,
    legacyCode: `game:water-${index + 1}`,
  }),
);

type JsonRecord = Record<string, unknown>;

interface AssetDocument {
  readonly pack: (typeof PACKS)[number];
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly data: JsonRecord;
}

interface TextureAsset {
  readonly pack: (typeof PACKS)[number];
  readonly virtualPath: string;
  readonly assetPath: string;
}

interface VariantResolution {
  readonly parts: Record<string, string>;
  readonly codePath: string;
}

export interface LegacyCodeRemap {
  readonly currentCode: string;
  readonly legacyCode: string;
}

export interface CompileAssetRegistryOptions {
  readonly textureBaseUrl?: string;
  readonly portable?: boolean;
}

export async function compileAssetRegistry(
  assetRoot: string,
  options: CompileAssetRegistryOptions = {},
): Promise<AssetRegistry> {
  const diagnostics: string[] = [];
  const parseErrors: string[] = [];
  const [blockDocuments, itemDocuments, worldPropertyDocuments, shapeDocuments, textureAssets, colorMaps, legacyRemaps, patchFileCount, assetFileCount] =
    await Promise.all([
      loadDocuments(assetRoot, "blocktypes", parseErrors),
      loadDocuments(assetRoot, "itemtypes", parseErrors),
      loadDocuments(assetRoot, "worldproperties", parseErrors),
      loadDocuments(assetRoot, "shapes", parseErrors),
      loadTextures(assetRoot),
      loadColorMaps(assetRoot, parseErrors),
      loadLegacyRemaps(assetRoot, parseErrors),
      countCategoryFiles(assetRoot, "patches"),
      countAllFiles(assetRoot),
    ]);

  const worldProperties = new Map<string, readonly string[]>();
  for (const document of worldPropertyDocuments.values()) {
    const variants = asArray(getCaseInsensitive(document.data, "variants"))
      .map((entry) => asRecord(entry))
      .map((entry) => asString(getCaseInsensitive(entry, "code")))
      .filter((code): code is string => code !== null)
      .map(assetPathOnly);
    worldProperties.set(stripJsonExtension(document.relativePath).toLowerCase(), variants);
  }

  const resolvedDocumentCache = new Map<string, JsonRecord>();
  const textureCache = new Map<string, RegistryTexture>();
  const compiledColorMaps: Record<string, RegistryTexture> = {};
  for (const [code, base] of colorMaps) {
    const texture = resolveTextureAsset(base, textureAssets, textureCache, diagnostics);
    if (texture.url !== null) {
      compiledColorMaps[code] = texture;
    }
  }
  const blocks: Record<string, CompiledBlockDefinition> = {};
  const items: Record<string, CompiledItemDefinition> = {};
  const shapes: Record<string, CompiledShape> = {};
  let unresolvedTextureCodeCount = 0;
  let texturedCubeCodeCount = 0;

  for (const document of blockDocuments.values()) {
    let inherited: JsonRecord;
    try {
      inherited = resolveInheritance(
        document,
        blockDocuments,
        resolvedDocumentCache,
        new Set<string>(),
      );
    } catch (error) {
      diagnostics.push(
        `Could not resolve inheritance for ${document.pack}/blocktypes/${document.relativePath}: ${errorMessage(error)}`,
      );
      inherited = structuredClone(document.data);
    }

    const enabled = getCaseInsensitive(inherited, "enabled");
    if (enabled === false) {
      continue;
    }
    const rawBaseCode = asString(getCaseInsensitive(inherited, "code"));
    if (rawBaseCode === null) {
      diagnostics.push(`Ignored blocktype without a code: ${document.pack}/blocktypes/${document.relativePath}`);
      continue;
    }

    const baseCode = normalizeAssetLocation(rawBaseCode);
    const variantWarnings: string[] = [];
    const variants = gatherVariants(
      baseCode.path,
      getCaseInsensitive(inherited, "variantgroups"),
      getCaseInsensitive(inherited, "allowedVariants"),
      getCaseInsensitive(inherited, "skipVariants"),
      worldProperties,
      variantWarnings,
    );
    const sourceFile = toPosix(path.join(document.pack, "blocktypes", document.relativePath));

    for (const variant of variants) {
      const code = `${baseCode.domain}:${variant.codePath}`;
      const resolvedJson = solveByTypeAndPlaceholders(
        removeLoaderProperties(structuredClone(inherited)),
        variant.codePath,
        variant.parts,
      );
      const definitionWarnings = [...variantWarnings];
      const shape = asRecord(getCaseInsensitive(resolvedJson, "shape"));
      const shapeBase = asString(getCaseInsensitive(shape, "base"));
      const drawType = asString(getCaseInsensitive(resolvedJson, "drawtype"));
      const renderPass = asString(getCaseInsensitive(resolvedJson, "renderpass"));
      const className = asString(getCaseInsensitive(resolvedJson, "class"));
      const renderShapeBase = className === "BlockFirewoodPile"
        ? "block/wood/firewoodpile"
        : shapeBase;
      const renderShape = className === "BlockFirewoodPile"
        ? { ...shape, base: renderShapeBase }
        : shape;
      const cubeTextures = resolveCubeTextures(
        resolvedJson,
        className,
        drawType,
        renderPass,
        shapeBase,
        textureAssets,
        textureCache,
        definitionWarnings,
      );
      const compiledShape = cubeTextures === null
        ? resolveShapeReference(
            resolvedJson,
            renderShape,
            renderShapeBase,
            shapeDocuments,
            shapes,
            textureAssets,
            textureCache,
            definitionWarnings,
          )
        : null;
      const supportBeamShapes = className === "BlockSupportBeam"
        ? resolveSupportBeamShapes(
            resolvedJson,
            shape,
            shapeBase,
            shapeDocuments,
            shapes,
            textureAssets,
            textureCache,
            definitionWarnings,
          )
        : null;
      const entityShapes = cubeTextures === null
        ? resolveEntityShapeSet(
            resolvedJson,
            className,
            variant.codePath,
            worldProperties,
            shapeDocuments,
            shapes,
            textureAssets,
            textureCache,
            definitionWarnings,
          )
        : null;
      if (cubeTextures !== null) {
        texturedCubeCodeCount += 1;
      } else if (isCubeBlock(drawType, shapeBase)) {
        unresolvedTextureCodeCount += 1;
      }

      blocks[code] = {
        code,
        sourceFile,
        className,
        drawType,
        renderPass,
        shapeBase,
        isMeta: renderPass?.toLowerCase() === "meta"
          || code.startsWith("game:meta-")
          || sourceFile.toLowerCase().includes("/blocktypes/meta/")
          || className === "BlockMultiblock",
        ignoreTintInventory:
          getCaseInsensitive(asRecord(getCaseInsensitive(resolvedJson, "attributes")), "ignoreTintInventory")
            === true,
        variant: variant.parts,
        cubeTextures,
        shape: compiledShape,
        supportBeamShapes,
        entityShapes,
        climateColorMap: resolveColorMapReference(
          getCaseInsensitive(resolvedJson, "climateColorMap"),
          colorMaps,
          textureAssets,
          textureCache,
          definitionWarnings,
        ),
        seasonColorMap: resolveColorMapReference(
          getCaseInsensitive(resolvedJson, "seasonColorMap"),
          colorMaps,
          textureAssets,
          textureCache,
          definitionWarnings,
        ),
        groundStorage: resolveGroundStorageProperties(
          resolvedJson,
          shapeDocuments,
          shapes,
          textureAssets,
          textureCache,
          definitionWarnings,
        ),
        decor: resolveDecorProperties(
          resolvedJson,
          drawType,
          variant.parts,
          textureAssets,
          textureCache,
          definitionWarnings,
        ),
        pile: resolvePileProperties(
          resolvedJson,
          className,
          textureAssets,
          textureCache,
          definitionWarnings,
        ),
        warnings: definitionWarnings,
      };
    }
  }

  const resolvedItemDocumentCache = new Map<string, JsonRecord>();
  for (const document of itemDocuments.values()) {
    let inherited: JsonRecord;
    try {
      inherited = resolveInheritance(
        document,
        itemDocuments,
        resolvedItemDocumentCache,
        new Set<string>(),
      );
    } catch (error) {
      diagnostics.push(
        `Could not resolve inheritance for ${document.pack}/itemtypes/${document.relativePath}: ${errorMessage(error)}`,
      );
      inherited = structuredClone(document.data);
    }

    const enabled = getCaseInsensitive(inherited, "enabled");
    if (enabled === false) {
      continue;
    }
    const rawBaseCode = asString(getCaseInsensitive(inherited, "code"));
    if (rawBaseCode === null) {
      diagnostics.push(`Ignored itemtype without a code: ${document.pack}/itemtypes/${document.relativePath}`);
      continue;
    }

    const baseCode = normalizeAssetLocation(rawBaseCode);
    const variantWarnings: string[] = [];
    const variants = gatherVariants(
      baseCode.path,
      getCaseInsensitive(inherited, "variantgroups"),
      getCaseInsensitive(inherited, "allowedVariants"),
      getCaseInsensitive(inherited, "skipVariants"),
      worldProperties,
      variantWarnings,
    );
    const sourceFile = toPosix(path.join(document.pack, "itemtypes", document.relativePath));

    for (const variant of variants) {
      const code = `${baseCode.domain}:${variant.codePath}`;
      const resolvedJson = solveByTypeAndPlaceholders(
        removeLoaderProperties(structuredClone(inherited)),
        variant.codePath,
        variant.parts,
      );
      const definitionWarnings = [...variantWarnings];
      const texturedJson = resolvedWithTypeTextureFallback(resolvedJson, variant.codePath);
      const compositeShape = asRecord(getCaseInsensitive(texturedJson, "shape"));
      const shapeBase = asString(getCaseInsensitive(compositeShape, "base"));
      const compiledShape = resolveShapeReference(
        texturedJson,
        compositeShape,
        shapeBase,
        shapeDocuments,
        shapes,
        textureAssets,
        textureCache,
        definitionWarnings,
      );
      items[code] = {
        code,
        sourceFile,
        className: asString(getCaseInsensitive(resolvedJson, "class")),
        variant: variant.parts,
        shape: compiledShape,
        groundStorage: resolveGroundStorageProperties(
          texturedJson,
          shapeDocuments,
          shapes,
          textureAssets,
          textureCache,
          definitionWarnings,
        ),
        warnings: definitionWarnings,
      };
    }
  }

  const legacyBlockAliasCount = applyLegacyAliases(blocks, legacyRemaps);
  const legacyLiquidAliasCount = applyLegacyAliases(blocks, LEGACY_LIQUID_REMAPS);
  const legacyItemAliasCount = applyLegacyAliases(items, legacyRemaps);

  diagnostics.push(
    `Applied the 1.22.5 variant expansion, first-match ByType resolution, and placeholder substitution rules.`,
  );
  diagnostics.push(
    `Resolved ${legacyBlockAliasCount} legacy block and ${legacyItemAliasCount} legacy item aliases from game/config/remaps.json.`,
  );
  diagnostics.push(
    `Resolved ${legacyLiquidAliasCount} pre-flow-state water aliases used by shipped schematics.`,
  );
  diagnostics.push(
    `Inventoried ${patchFileCount} JSON patch files; patch mutation is deferred until the general patch engine milestone.`,
  );
  diagnostics.push(...parseErrors.slice(0, 50));

  const registry: AssetRegistry = {
    formatVersion: 2,
    generatedAt: new Date().toISOString(),
    compatibility: {
      gameVersion: "1.22.5",
      essentialsCommit: "0cd7da3",
      variantRules: "RegistryObjectTypeLoader + RegistryObjectType.solveByType",
    },
    assetRoot: options.portable === true ? "." : path.resolve(assetRoot),
    loadOrder: PACKS,
    stats: {
      assetFileCount,
      blockTypeFileCount: blockDocuments.size,
      itemTypeFileCount: itemDocuments.size,
      worldPropertyFileCount: worldPropertyDocuments.size,
      patchFileCount,
      textureFileCount: textureAssets.size,
      shapeFileCount: shapeDocuments.size,
      compiledShapeCount: Object.keys(shapes).length,
      resolvedBlockCodeCount: Object.keys(blocks).length,
      resolvedItemCodeCount: Object.keys(items).length,
      legacyBlockAliasCount,
      legacyItemAliasCount,
      texturedCubeCodeCount,
      unresolvedTextureCodeCount,
      parseErrorCount: parseErrors.length,
    },
    diagnostics,
    blocks,
    items,
    colorMaps: compiledColorMaps,
    shapes,
  };
  rewriteTextureUrls(registry, options.textureBaseUrl ?? "/@vs-assets");
  return registry;
}

async function loadDocuments(
  assetRoot: string,
  category: string,
  parseErrors: string[],
): Promise<Map<string, AssetDocument>> {
  const documents = new Map<string, AssetDocument>();
  for (const pack of PACKS) {
    const categoryRoot = path.join(assetRoot, pack, category);
    for (const absolutePath of await listFiles(categoryRoot, (file) => file.endsWith(".json"))) {
      const relativePath = toPosix(path.relative(categoryRoot, absolutePath));
      try {
        const parsed = JSON5.parse(await readFile(absolutePath, "utf8")) as unknown;
        const data = asRecord(parsed);
        documents.set(relativePath.toLowerCase(), {
          pack,
          relativePath,
          absolutePath,
          data,
        });
      } catch (error) {
        parseErrors.push(`${pack}/${category}/${relativePath}: ${errorMessage(error)}`);
      }
    }
  }
  return documents;
}

async function loadTextures(assetRoot: string): Promise<Map<string, TextureAsset>> {
  const textures = new Map<string, TextureAsset>();
  for (const pack of PACKS) {
    const textureRoot = path.join(assetRoot, pack, "textures");
    for (const absolutePath of await listFiles(textureRoot, (file) => file.endsWith(".png"))) {
      const virtualPath = toPosix(path.relative(textureRoot, absolutePath));
      textures.set(virtualPath.toLowerCase(), {
        pack,
        virtualPath,
        assetPath: toPosix(path.join(pack, "textures", virtualPath)),
      });
    }
  }
  return textures;
}

async function loadColorMaps(
  assetRoot: string,
  parseErrors: string[],
): Promise<Map<string, string>> {
  const colorMaps = new Map<string, string>();
  for (const pack of PACKS) {
    const absolutePath = path.join(assetRoot, pack, "config", "colormaps.json");
    try {
      const parsed = JSON5.parse(await readFile(absolutePath, "utf8")) as unknown;
      for (const rawEntry of asArray(parsed)) {
        const entry = asRecord(rawEntry);
        const code = asString(getCaseInsensitive(entry, "code"));
        const texture = asRecord(getCaseInsensitive(entry, "texture"));
        const base = asString(getCaseInsensitive(texture, "base"));
        if (code !== null && base !== null) {
          colorMaps.set(code.toLowerCase(), base);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        parseErrors.push(`${pack}/config/colormaps.json: ${errorMessage(error)}`);
      }
    }
  }
  return colorMaps;
}

async function loadLegacyRemaps(
  assetRoot: string,
  parseErrors: string[],
): Promise<LegacyCodeRemap[]> {
  const absolutePath = path.join(assetRoot, "game", "config", "remaps.json");
  try {
    return extractLegacyRemaps(JSON5.parse(await readFile(absolutePath, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      parseErrors.push(`game/config/remaps.json: ${errorMessage(error)}`);
    }
    return [];
  }
}

export function extractLegacyRemaps(value: unknown): LegacyCodeRemap[] {
  const remaps: LegacyCodeRemap[] = [];
  for (const commands of Object.values(asRecord(value))) {
    for (const command of asArray(commands)) {
      if (typeof command !== "string") continue;
      const match = /^\/bir\s+remapq\s+(\S+)\s+(\S+)/i.exec(command.trim());
      if (match?.[1] === undefined || match[2] === undefined) continue;
      remaps.push({
        // Block id remapper commands are written as NEW_CODE OLD_CODE.
        currentCode: normalizedCode(match[1]),
        legacyCode: normalizedCode(match[2]),
      });
    }
  }
  return remaps;
}

function applyLegacyAliases<T extends { readonly code: string; readonly warnings: readonly string[] }>(
  definitions: Record<string, T>,
  remaps: readonly LegacyCodeRemap[],
): number {
  const directRemaps = new Map(remaps.map((entry) => [entry.legacyCode, entry.currentCode]));
  let count = 0;
  for (const remap of remaps) {
    if (definitions[remap.legacyCode] !== undefined) continue;
    let currentCode = remap.currentCode;
    const visited = new Set([remap.legacyCode]);
    while (definitions[currentCode] === undefined && !visited.has(currentCode)) {
      visited.add(currentCode);
      const nextCode = directRemaps.get(currentCode);
      if (nextCode === undefined) break;
      currentCode = nextCode;
    }
    const current = definitions[currentCode];
    if (current === undefined) continue;
    definitions[remap.legacyCode] = {
      ...current,
      code: remap.legacyCode,
      warnings: [...current.warnings, `Legacy code remapped to ${currentCode}.`],
    };
    count += 1;
  }
  return count;
}

function resolveInheritance(
  document: AssetDocument,
  documents: ReadonlyMap<string, AssetDocument>,
  cache: Map<string, JsonRecord>,
  stack: Set<string>,
): JsonRecord {
  const key = document.relativePath.toLowerCase();
  const cached = cache.get(key);
  if (cached !== undefined) {
    return structuredClone(cached);
  }
  if (stack.has(key)) {
    throw new Error(`inheritFrom cycle at ${document.relativePath}`);
  }
  stack.add(key);
  const inheritFrom = asString(getCaseInsensitive(document.data, "inheritFrom"));
  let result = structuredClone(document.data);
  if (inheritFrom !== null) {
    const parentKey = normalizeInheritedBlockPath(inheritFrom);
    const parent = documents.get(parentKey);
    if (parent === undefined) {
      throw new Error(`missing parent ${inheritFrom}`);
    }
    result = mergeObjects(resolveInheritance(parent, documents, cache, stack), result, false);
    deleteCaseInsensitive(result, "inheritFrom");
  }
  stack.delete(key);
  cache.set(key, structuredClone(result));
  return result;
}

function gatherVariants(
  baseCodePath: string,
  rawGroups: unknown,
  rawAllowed: unknown,
  rawSkipped: unknown,
  worldProperties: ReadonlyMap<string, readonly string[]>,
  warnings: string[],
): VariantResolution[] {
  const groups = asArray(rawGroups).map(asRecord);
  if (groups.length === 0) {
    return [{ parts: {}, codePath: baseCodePath }];
  }

  const multiplied = new Map<string, string[]>();
  const additive: Record<string, string>[] = [];
  for (const group of groups) {
    const combine = (asString(getCaseInsensitive(group, "combine")) ?? "multiply").toLowerCase();
    if (combine === "selectivemultiply") {
      continue;
    }
    const explicitCode = asString(getCaseInsensitive(group, "code"));
    const propertyRefs = [
      ...asStringArray(getCaseInsensitive(group, "loadFromPropertiesCombine")),
      ...asStringArray(getCaseInsensitive(group, "loadFromProperties")),
    ];
    const propertyValues: string[] = [];
    for (const propertyRef of propertyRefs) {
      const propertyKey = normalizeWorldPropertyPath(propertyRef);
      const values = worldProperties.get(propertyKey);
      if (values === undefined) {
        warnings.push(`Missing worldproperty ${propertyRef}.`);
      } else {
        propertyValues.push(...values);
      }
    }
    const states = asStringArray(getCaseInsensitive(group, "states"));
    const values = [...states, ...propertyValues];
    const inferredCode = propertyRefs.length === 1
      ? path.posix.basename(normalizeWorldPropertyPath(propertyRefs[0] ?? ""))
      : null;
    const type = explicitCode ?? inferredCode;
    if (type === null || values.length === 0) {
      continue;
    }
    if (combine === "add") {
      additive.push(...values.map((value) => ({ [type]: value })));
    } else {
      multiplied.set(type, [...(multiplied.get(type) ?? []), ...values]);
    }
  }

  let productSize = 1;
  for (const values of multiplied.values()) {
    productSize *= values.length;
  }
  if (productSize > MAX_VARIANTS_PER_TYPE) {
    warnings.push(`Variant expansion capped at ${MAX_VARIANTS_PER_TYPE.toLocaleString()} entries.`);
  }
  const products = cartesianParts([...multiplied.entries()], MAX_VARIANTS_PER_TYPE);
  const allParts = [...additive, ...products];
  const allowed = asStringArray(rawAllowed);
  const skipped = asStringArray(rawSkipped);
  const seen = new Set<string>();
  const resolved: VariantResolution[] = [];
  for (const parts of allParts.length === 0 ? [{}] : allParts) {
    const suffix = Object.values(parts).filter((value) => value.length > 0).join("-");
    const codePath = suffix.length === 0 ? baseCodePath : `${baseCodePath}-${suffix}`;
    if (skipped.some((pattern) => wildcardMatch(assetPathOnly(pattern), codePath))) {
      continue;
    }
    if (allowed.length > 0 && !allowed.some((pattern) => wildcardMatch(assetPathOnly(pattern), codePath))) {
      continue;
    }
    if (!seen.has(codePath)) {
      seen.add(codePath);
      resolved.push({ parts, codePath });
    }
  }
  return resolved;
}

function cartesianParts(
  entries: readonly (readonly [string, readonly string[]])[],
  limit: number,
): Record<string, string>[] {
  let products: Record<string, string>[] = [{}];
  for (const [type, values] of entries) {
    const next: Record<string, string>[] = [];
    for (const product of products) {
      for (const value of values) {
        next.push({ ...product, [type]: value });
        if (next.length >= limit) {
          return next;
        }
      }
    }
    products = next;
  }
  return products;
}

export function solveByTypeAndPlaceholders(
  value: JsonRecord,
  codePath: string,
  variant: Readonly<Record<string, string>>,
): JsonRecord {
  solveNode(value, codePath, variant);
  return value;
}

function solveNode(
  value: unknown,
  codePath: string,
  variant: Readonly<Record<string, string>>,
): unknown {
  if (typeof value === "string") {
    return fillPlaceholders(value, variant);
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = solveNode(value[index], codePath, variant);
    }
    return value;
  }
  if (!isRecord(value)) {
    return value;
  }

  const byTypeKeys = Object.keys(value).filter((key) => key.toLowerCase().endsWith("bytype"));
  for (const byTypeKey of byTypeKeys) {
    const trueKey = byTypeKey.slice(0, -"bytype".length);
    const choices = asRecord(value[byTypeKey]);
    const selected = Object.entries(choices).find(([pattern]) => wildcardMatch(pattern, codePath));
    delete value[byTypeKey];
    if (selected !== undefined) {
      const existingKey = findKeyCaseInsensitive(value, trueKey);
      const existing = existingKey === null ? undefined : value[existingKey];
      if (isRecord(existing) && isRecord(selected[1])) {
        value[existingKey ?? trueKey] = mergeObjects(existing, selected[1], true);
      } else {
        value[existingKey ?? trueKey] = structuredClone(selected[1]);
      }
    }
  }
  for (const key of Object.keys(value)) {
    value[key] = solveNode(value[key], codePath, variant);
  }
  return value;
}

function resolveShapeReference(
  resolved: JsonRecord,
  compositeShape: JsonRecord,
  shapeBase: string | null,
  shapeDocuments: ReadonlyMap<string, AssetDocument>,
  compiledShapes: Record<string, CompiledShape>,
  textureAssets: ReadonlyMap<string, TextureAsset>,
  textureCache: Map<string, RegistryTexture>,
  warnings: string[],
): CompiledShapeReference | null {
  if (shapeBase === null || isIgnoredStaticShape(shapeBase)) {
    return null;
  }
  const normalizedBase = assetPathOnly(shapeBase).replace(/^shapes\//i, "");
  const pattern = normalizedBase.toLowerCase().endsWith(".json")
    ? normalizedBase
    : `${normalizedBase}.json`;
  const exactDocument = pattern.includes("*") || pattern.startsWith("@")
    ? undefined
    : shapeDocuments.get(pattern.toLowerCase());
  const matches = exactDocument === undefined
    ? [...shapeDocuments.values()]
        .filter((document) => wildcardMatch(pattern, document.relativePath))
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    : [exactDocument];
  const document = matches[0];
  if (document === undefined) {
    warnings.push(`Shape ${shapeBase} did not match a local JSON shape.`);
    return null;
  }
  if (matches.length > 1) {
    warnings.push(`Shape ${shapeBase} matched ${matches.length} files; selected ${document.relativePath}.`);
  }

  const key = `${document.pack}:shapes/${stripJsonExtension(document.relativePath)}`;
  let compiledShape: CompiledShape | null | undefined = compiledShapes[key];
  if (compiledShape === undefined) {
    compiledShape = compileShapeDocument(key, document, warnings);
    if (compiledShape === null) {
      return null;
    }
    compiledShapes[key] = compiledShape;
  }
  if (compiledShape === null || compiledShape === undefined) {
    return null;
  }

  const blockTextures = asRecord(getCaseInsensitive(resolved, "textures"));
  const shapeTextures = asRecord(getCaseInsensitive(document.data, "textures"));
  const aliases = collectShapeTextureAliases(compiledShape.elements);
  const textures: Record<string, RegistryFaceTexture> = {};
  for (const alias of aliases) {
    const rawTexture = shapeTextureSource(alias, blockTextures, shapeTextures, new Set<string>());
    const faceTexture = resolveFaceTexture(rawTexture, textureAssets, textureCache, warnings);
    if (faceTexture === null) {
      warnings.push(`Shape ${document.relativePath} has no resolvable texture for #${alias}.`);
      return null;
    }
    textures[alias] = faceTexture;
  }

  return {
    key,
    rotateX: asNumber(getCaseInsensitive(compositeShape, "rotateX")) ?? 0,
    rotateY: asNumber(getCaseInsensitive(compositeShape, "rotateY")) ?? 0,
    rotateZ: asNumber(getCaseInsensitive(compositeShape, "rotateZ")) ?? 0,
    offsetX: asNumber(getCaseInsensitive(compositeShape, "offsetX")) ?? 0,
    offsetY: asNumber(getCaseInsensitive(compositeShape, "offsetY")) ?? 0,
    offsetZ: asNumber(getCaseInsensitive(compositeShape, "offsetZ")) ?? 0,
    scale: asNumber(getCaseInsensitive(compositeShape, "scale")) ?? 1,
    textures,
  };
}

function resolveSupportBeamShapes(
  resolved: JsonRecord,
  compositeShape: JsonRecord,
  shapeBase: string | null,
  shapeDocuments: ReadonlyMap<string, AssetDocument>,
  compiledShapes: Record<string, CompiledShape>,
  textureAssets: ReadonlyMap<string, TextureAsset>,
  textureCache: Map<string, RegistryTexture>,
  warnings: string[],
): readonly CompiledShapeReference[] | null {
  if (shapeBase === null) {
    return null;
  }
  const attributes = asRecord(getCaseInsensitive(resolved, "attributes"));
  const partialEnds = getCaseInsensitive(attributes, "partialEnds") === true;
  if (!partialEnds) {
    const reference = resolveShapeReference(
      resolved,
      compositeShape,
      shapeBase,
      shapeDocuments,
      compiledShapes,
      textureAssets,
      textureCache,
      warnings,
    );
    return reference === null ? null : [reference];
  }
  const slash = shapeBase.lastIndexOf("/");
  if (slash < 0) {
    return null;
  }
  const references = [4, 8, 12, 16].map((length) => {
    const segmentBase = `${shapeBase.slice(0, slash + 1)}${length}`;
    return resolveShapeReference(
      resolved,
      { ...compositeShape, base: segmentBase },
      segmentBase,
      shapeDocuments,
      compiledShapes,
      textureAssets,
      textureCache,
      warnings,
    );
  });
  return references.every((reference) => reference !== null)
    ? references as readonly CompiledShapeReference[]
    : null;
}

function resolveColorMapReference(
  rawCode: unknown,
  colorMaps: ReadonlyMap<string, string>,
  textureAssets: ReadonlyMap<string, TextureAsset>,
  textureCache: Map<string, RegistryTexture>,
  warnings: string[],
): CompiledColorMapReference | null {
  const code = asString(rawCode);
  if (code === null) {
    return null;
  }
  const base = colorMaps.get(code.toLowerCase());
  if (base === undefined) {
    warnings.push(`Color map ${code} is not defined in config/colormaps.json.`);
    return null;
  }
  const texture = resolveTextureAsset(base, textureAssets, textureCache, warnings);
  return texture.url === null ? null : { code, texture };
}

function resolveEntityShapeSet(
  resolved: JsonRecord,
  className: string | null,
  blockCodePath: string,
  worldProperties: ReadonlyMap<string, readonly string[]>,
  shapeDocuments: ReadonlyMap<string, AssetDocument>,
  compiledShapes: Record<string, CompiledShape>,
  textureAssets: ReadonlyMap<string, TextureAsset>,
  textureCache: Map<string, RegistryTexture>,
  warnings: string[],
): CompiledEntityShapeSet | null {
  const attributes = asRecord(getCaseInsensitive(resolved, "attributes"));
  const rawTypes = asArray(getCaseInsensitive(attributes, "types"));
  const types = rawTypes
    .map(asString)
    .filter((type): type is string => type !== null);
  const variants: Record<string, CompiledShapeReference> = {};

  if (className?.startsWith("BlockGenericTypedContainer") === true) {
    const defaultType = asString(getCaseInsensitive(attributes, "defaultType")) ?? types[0];
    if (defaultType === undefined) {
      return null;
    }
    const typeShapes = asRecord(getCaseInsensitive(attributes, "shape"));
    for (const type of types) {
      const shapeBase = asString(getCaseInsensitive(typeShapes, type));
      if (shapeBase === null) {
        continue;
      }
      const reference = resolveShapeReference(
        resolvedWithTypedTextures(resolved, type),
        { base: shapeBase },
        shapeBase,
        shapeDocuments,
        compiledShapes,
        textureAssets,
        textureCache,
        warnings,
      );
      if (reference !== null) {
        variants[entityShapeKey([type])] = reference;
      }
    }
    return Object.keys(variants).length === 0
      ? null
      : { attributeKeys: ["type"], defaultValues: [defaultType], variants };
  }

  if (className === "BlockCrate") {
    const defaultType = asString(getCaseInsensitive(attributes, "defaultType")) ?? types[0];
    if (defaultType === undefined) {
      return null;
    }
    const properties = asRecord(getCaseInsensitive(attributes, "properties"));
    for (const type of types) {
      const typeProperties = asRecord(
        getCaseInsensitive(properties, type) ?? getCaseInsensitive(properties, "*"),
      );
      const closedShape = asRecord(getCaseInsensitive(typeProperties, "shape"));
      const closedBase = asString(getCaseInsensitive(closedShape, "base"));
      if (closedBase === null) {
        continue;
      }
      for (const lidState of ["closed", "opened"] as const) {
        const shapeBase = lidState === "closed"
          ? closedBase
          : closedBase.replace(/closed/gi, "opened");
        const compositeShape: JsonRecord = { ...closedShape, base: shapeBase };
        const reference = resolveShapeReference(
          resolvedWithTypedTextures(resolved, type),
          compositeShape,
          shapeBase,
          shapeDocuments,
          compiledShapes,
          textureAssets,
          textureCache,
          warnings,
        );
        if (reference !== null) {
          variants[entityShapeKey([type, lidState])] = reference;
        }
      }
    }
    return Object.keys(variants).length === 0
      ? null
      : {
          attributeKeys: ["type", "lidState"],
          defaultValues: [defaultType, "closed"],
          variants,
        };
  }

  if (className === "BlockClutter" || className === "ToggleCollisionBox") {
    const shapeBasePath = asString(getCaseInsensitive(attributes, "shapeBasePath"));
    if (shapeBasePath === null) {
      return null;
    }
    const clutterTypes = rawTypes.map(asRecord);
    for (const type of clutterTypes) {
      const typeCode = asString(getCaseInsensitive(type, "code"));
      if (typeCode === null) {
        continue;
      }
      const explicitShapePath = asString(getCaseInsensitive(type, "shapePath"));
      const shapeBase = explicitShapePath === null
        ? `${shapeBasePath}/${typeCode}`
        : explicitShapePath.startsWith("/")
          ? explicitShapePath.slice(1)
          : `${shapeBasePath}/${explicitShapePath}`;
      const reference = resolveShapeReference(
        resolvedWithAdditionalTextures(resolved, asRecord(getCaseInsensitive(type, "textures"))),
        { base: shapeBase },
        shapeBase,
        shapeDocuments,
        compiledShapes,
        textureAssets,
        textureCache,
        warnings,
      );
      if (reference !== null) {
        variants[entityShapeKey([typeCode])] = reference;
      }
    }
    const defaultType = asString(getCaseInsensitive(clutterTypes[0] ?? {}, "code"));
    return defaultType === null || Object.keys(variants).length === 0
      ? null
      : { attributeKeys: ["type"], defaultValues: [defaultType], variants };
  }

  if (
    className === "BlockClutterBookshelf" ||
    className === "BlockClutterBookshelfWithLore"
  ) {
    const shapeBasePath = asString(getCaseInsensitive(attributes, "shapeBasePath"));
    const variantGroups = asRecord(getCaseInsensitive(attributes, "variantGroups"));
    if (shapeBasePath === null) {
      return null;
    }
    const typeCodes = new Set<string>();
    for (const group of Object.values(variantGroups).map(asRecord)) {
      for (const type of asArray(getCaseInsensitive(group, "types")).map(asRecord)) {
        const typeCode = asString(getCaseInsensitive(type, "code"));
        if (typeCode !== null) {
          typeCodes.add(typeCode);
        }
      }
    }
    for (const typeCode of typeCodes) {
      const shapeBase = `${shapeBasePath}/${typeCode}`;
      const reference = resolveShapeReference(
        resolved,
        { base: shapeBase },
        shapeBase,
        shapeDocuments,
        compiledShapes,
        textureAssets,
        textureCache,
        warnings,
      );
      if (reference !== null) {
        variants[entityShapeKey([typeCode])] = reference;
      }
    }
    const defaultType = typeCodes.values().next().value as string | undefined;
    return defaultType === undefined || Object.keys(variants).length === 0
      ? null
      : { attributeKeys: ["type"], defaultValues: [defaultType], variants };
  }

  if (className === "BlockRockTyped") {
    const rocks = worldProperties.get("block/rock") ?? [];
    for (const type of rawTypes.map(asRecord)) {
      const baseTypeCode = asString(getCaseInsensitive(type, "code"));
      const shapeChoices = asRecord(getCaseInsensitive(type, "shapePathByType"));
      const selectedShape = Object.entries(shapeChoices)
        .find(([pattern]) => wildcardMatch(pattern, blockCodePath));
      const shapeBase = asString(getCaseInsensitive(type, "shapePath"))
        ?? asString(selectedShape?.[1]);
      if (baseTypeCode === null || shapeBase === null) {
        continue;
      }
      for (const rock of rocks) {
        const typeCode = `${baseTypeCode}-${rock}`;
        const typeTextures = solveByTypeAndPlaceholders(
          structuredClone(asRecord(getCaseInsensitive(type, "textures"))),
          blockCodePath,
          { rock },
        );
        const reference = resolveShapeReference(
          resolvedWithAdditionalTextures(resolved, typeTextures),
          { base: shapeBase },
          shapeBase,
          shapeDocuments,
          compiledShapes,
          textureAssets,
          textureCache,
          warnings,
        );
        if (reference !== null) {
          variants[entityShapeKey([typeCode])] = reference;
        }
      }
    }
    const defaultType = Object.keys(variants)[0];
    return defaultType === undefined
      ? null
      : { attributeKeys: ["type"], defaultValues: [defaultType], variants };
  }

  return null;
}

function resolveGroundStorageProperties(
  resolved: JsonRecord,
  shapeDocuments: ReadonlyMap<string, AssetDocument>,
  compiledShapes: Record<string, CompiledShape>,
  textureAssets: ReadonlyMap<string, TextureAsset>,
  textureCache: Map<string, RegistryTexture>,
  warnings: string[],
): CompiledGroundStorageProperties | null {
  const behavior = asArray(getCaseInsensitive(resolved, "behaviors"))
    .map(asRecord)
    .find((candidate) =>
      asString(getCaseInsensitive(candidate, "name"))?.toLowerCase() === "groundstorable",
    );
  if (behavior === undefined) {
    return null;
  }

  const properties = asRecord(getCaseInsensitive(behavior, "properties"));
  const rawLayout = asString(getCaseInsensitive(properties, "layout")) ?? "SingleCenter";
  const layout = canonicalGroundStorageLayout(rawLayout);
  const attributes = asRecord(getCaseInsensitive(resolved, "attributes"));
  const rawTransform = asRecord(getCaseInsensitive(attributes, "groundStorageTransform"));
  const stackingModel = asString(getCaseInsensitive(properties, "stackingModel"));
  const stackingTextures = asRecord(getCaseInsensitive(properties, "stackingTextures"));
  const stackingResolved = resolvedWithAdditionalTextures(resolved, stackingTextures);
  const transferQuantity = asNumber(getCaseInsensitive(properties, "transferQuantity")) ?? 1;
  const itemsPerModel = Math.max(
    1,
    Math.round(asNumber(getCaseInsensitive(properties, "itemsPerModel")) ?? transferQuantity),
  );
  const legacyRatio = asNumber(getCaseInsensitive(properties, "modelItemsToStackSizeRatio")) ?? 1;
  const cuboidsPerModel = Math.max(
    1,
    Math.round(
      asNumber(getCaseInsensitive(properties, "cuboidsPerModel"))
        ?? itemsPerModel * legacyRatio,
    ),
  );
  return {
    layout,
    modelTransform: Object.keys(rawTransform).length === 0
      ? null
      : compileModelTransform(rawTransform),
    stackingReference: layout !== "Stacking" || stackingModel === null
      ? null
      : resolveShapeReference(
          stackingResolved,
          { base: stackingModel },
          stackingModel,
          shapeDocuments,
          compiledShapes,
          textureAssets,
          textureCache,
          warnings,
        ),
    itemsPerModel,
    cuboidsPerModel,
  };
}

function canonicalGroundStorageLayout(
  value: string,
): CompiledGroundStorageProperties["layout"] {
  switch (value.toLowerCase()) {
    case "halves": return "Halves";
    case "wallhalves": return "WallHalves";
    case "quadrants": return "Quadrants";
    case "stacking": return "Stacking";
    case "messy12": return "Messy12";
    default: return "SingleCenter";
  }
}

function compileModelTransform(value: JsonRecord): CompiledModelTransform {
  const scaleValue = getCaseInsensitive(value, "scale");
  const uniformScale = asNumber(scaleValue);
  return {
    translation: asNamedVector3(getCaseInsensitive(value, "translation"), [0, 0, 0]),
    rotation: asNamedVector3(getCaseInsensitive(value, "rotation"), [0, 0, 0]),
    origin: asNamedVector3(getCaseInsensitive(value, "origin"), [0.5, 0.5, 0.5]),
    scale: uniformScale === null
      ? asNamedVector3(
          getCaseInsensitive(value, "scaleXyz") ?? getCaseInsensitive(value, "scaleXYZ"),
          [1, 1, 1],
        )
      : [uniformScale, uniformScale, uniformScale],
  };
}

function asNamedVector3(
  value: unknown,
  fallback: readonly [number, number, number],
): [number, number, number] {
  const record = asRecord(value);
  return [
    asNumber(getCaseInsensitive(record, "x")) ?? fallback[0],
    asNumber(getCaseInsensitive(record, "y")) ?? fallback[1],
    asNumber(getCaseInsensitive(record, "z")) ?? fallback[2],
  ];
}

function resolvedWithTypedTextures(resolved: JsonRecord, type: string): JsonRecord {
  const sourceTextures = asRecord(getCaseInsensitive(resolved, "textures"));
  const textures: JsonRecord = { ...sourceTextures };
  const prefix = `${type}-`.toLowerCase();
  for (const [key, value] of Object.entries(sourceTextures)) {
    if (key.toLowerCase().startsWith(prefix)) {
      textures[key.slice(prefix.length)] = value;
    }
  }
  return { ...resolved, textures };
}

function resolvedWithAdditionalTextures(
  resolved: JsonRecord,
  additionalTextures: JsonRecord,
): JsonRecord {
  return {
    ...resolved,
    textures: {
      ...asRecord(getCaseInsensitive(resolved, "textures")),
      ...additionalTextures,
    },
  };
}

function resolvedWithTypeTextureFallback(
  resolved: JsonRecord,
  codePath: string,
): JsonRecord {
  const textures = asRecord(getCaseInsensitive(resolved, "textures"));
  if (Object.keys(textures).length > 0) {
    return resolved;
  }
  const singularTexture = getCaseInsensitive(resolved, "texture");
  if (singularTexture !== undefined && singularTexture !== null) {
    return resolvedWithAdditionalTextures(resolved, { all: singularTexture });
  }
  const byType = asRecord(getCaseInsensitive(resolved, "textureByType"));
  const selected = Object.entries(byType).find(([pattern]) => wildcardMatch(pattern, codePath));
  if (selected === undefined || selected[1] === null) {
    return resolved;
  }
  return resolvedWithAdditionalTextures(resolved, { all: selected[1] });
}

function entityShapeKey(values: readonly string[]): string {
  return values.join("\u001f");
}

function resolveDecorProperties(
  resolved: JsonRecord,
  drawType: string | null,
  variant: Readonly<Record<string, string>>,
  textureAssets: ReadonlyMap<string, TextureAsset>,
  textureCache: Map<string, RegistryTexture>,
  warnings: string[],
): CompiledDecorProperties | null {
  const behavior = asArray(getCaseInsensitive(resolved, "behaviors"))
    .map(asRecord)
    .find((entry) => asString(getCaseInsensitive(entry, "name"))?.toLowerCase() === "decor");
  if (behavior === undefined) {
    return null;
  }
  const properties = asRecord(getCaseInsensitive(behavior, "properties"));
  let surfaceTexture: RegistryFaceTexture | null = null;
  if (drawType?.toLowerCase() === "surfacelayer") {
    const textures = asRecord(getCaseInsensitive(resolved, "textures"));
    const rawTexture = firstDefinedTexture(textures, ["all", "up", "north", "sides"])
      ?? Object.values(textures)[0];
    surfaceTexture = resolveFaceTexture(rawTexture, textureAssets, textureCache, warnings);
  }
  const column = Number(variant.col);
  const row = Number(variant.row);
  const textureTile: readonly [number, number, number, number] | null =
    Number.isInteger(column) && column >= 1 && column <= 6
    && Number.isInteger(row) && row >= 1 && row <= 6
      ? [column - 1, row - 1, 6, 6]
      : null;
  return {
    surfaceTexture,
    randomizeRotations: getCaseInsensitive(resolved, "randomizeRotations") === true,
    sidedVariants: getCaseInsensitive(properties, "sidedVariants") === true,
    textureTile,
  };
}

function isIgnoredStaticShape(shapeBase: string): boolean {
  const normalized = stripJsonExtension(assetPathOnly(shapeBase).replace(/^shapes\//i, "")).toLowerCase();
  return normalized === "block/basic/cube"
    || normalized === "block/basic/empty"
    || normalized === "block/basic/invisible";
}

function compileShapeDocument(
  key: string,
  document: AssetDocument,
  warnings: string[],
): CompiledShape | null {
  const textureWidth = asNumber(getCaseInsensitive(document.data, "textureWidth")) ?? 16;
  const textureHeight = asNumber(getCaseInsensitive(document.data, "textureHeight")) ?? 16;
  const elements = asArray(getCaseInsensitive(document.data, "elements"))
    .map((element) => compileShapeElement(asRecord(element), textureWidth, textureHeight));
  if (elements.length === 0) {
    warnings.push(`Shape ${document.relativePath} has no elements.`);
    return null;
  }
  return {
    key,
    sourceFile: toPosix(path.join(document.pack, "shapes", document.relativePath)),
    textureWidth,
    textureHeight,
    elements,
  };
}

function compileShapeElement(
  element: JsonRecord,
  textureWidth: number,
  textureHeight: number,
): CompiledShapeElement {
  const faces: Partial<Record<CubeFace, CompiledShapeFace>> = {};
  const rawFaces = asRecord(getCaseInsensitive(element, "faces"));
  for (const face of CUBE_FACES) {
    const rawFace = getCaseInsensitive(rawFaces, face);
    if (!isRecord(rawFace)) {
      continue;
    }
    const texture = asString(getCaseInsensitive(rawFace, "texture"));
    if (texture === null) {
      continue;
    }
    const rawUv = asArray(getCaseInsensitive(rawFace, "uv"));
    const uv: [number, number, number, number] = rawUv.length >= 4
      ? [
          asNumber(rawUv[0]) ?? 0,
          asNumber(rawUv[1]) ?? 0,
          asNumber(rawUv[2]) ?? textureWidth,
          asNumber(rawUv[3]) ?? textureHeight,
        ]
      : [0, 0, textureWidth, textureHeight];
    faces[face] = {
      texture: texture.startsWith("#") ? texture.slice(1) : texture,
      uv,
      rotation: asNumber(getCaseInsensitive(rawFace, "rotation")) ?? 0,
      enabled: getCaseInsensitive(rawFace, "enabled") !== false
        && texture.replace(/^#/, "").toLowerCase() !== "null",
    };
  }
  return {
    from: asVector3(getCaseInsensitive(element, "from"), [0, 0, 0]),
    to: asVector3(getCaseInsensitive(element, "to"), [16, 16, 16]),
    rotationOrigin: asVector3(getCaseInsensitive(element, "rotationOrigin"), [0, 0, 0]),
    rotationX: asNumber(getCaseInsensitive(element, "rotationX")) ?? 0,
    rotationY: asNumber(getCaseInsensitive(element, "rotationY")) ?? 0,
    rotationZ: asNumber(getCaseInsensitive(element, "rotationZ")) ?? 0,
    scaleX: asNumber(getCaseInsensitive(element, "scaleX")) ?? 1,
    scaleY: asNumber(getCaseInsensitive(element, "scaleY")) ?? 1,
    scaleZ: asNumber(getCaseInsensitive(element, "scaleZ")) ?? 1,
    climateColorMap: asString(getCaseInsensitive(element, "climateColorMap")),
    seasonColorMap: asString(getCaseInsensitive(element, "seasonColorMap")),
    faces,
    children: asArray(getCaseInsensitive(element, "children"))
      .map((child) => compileShapeElement(asRecord(child), textureWidth, textureHeight)),
  };
}

function asVector3(
  value: unknown,
  fallback: readonly [number, number, number],
): [number, number, number] {
  const values = asArray(value);
  return [
    asNumber(values[0]) ?? fallback[0],
    asNumber(values[1]) ?? fallback[1],
    asNumber(values[2]) ?? fallback[2],
  ];
}

function collectShapeTextureAliases(elements: readonly CompiledShapeElement[]): string[] {
  const aliases = new Set<string>();
  const visit = (element: CompiledShapeElement): void => {
    for (const face of Object.values(element.faces)) {
      if (face !== undefined && face.enabled) {
        aliases.add(face.texture);
      }
    }
    element.children.forEach(visit);
  };
  elements.forEach(visit);
  return [...aliases];
}

function shapeTextureSource(
  alias: string,
  blockTextures: JsonRecord,
  shapeTextures: JsonRecord,
  seen: Set<string>,
): unknown {
  const normalizedAlias = alias.toLowerCase();
  if (seen.has(normalizedAlias)) {
    return null;
  }
  seen.add(normalizedAlias);

  let value: unknown;
  if (alias === "-1") {
    value = firstDefinedTexture(blockTextures, ["all"])
      ?? Object.values(blockTextures)[0]
      ?? firstDefinedTexture(shapeTextures, ["all"])
      ?? Object.values(shapeTextures)[0];
  } else {
    value = getCaseInsensitive(blockTextures, alias);
    if (value === undefined && CUBE_FACES.includes(alias as CubeFace)) {
      value = firstDefinedTexture(blockTextures, FACE_TEXTURE_KEYS[alias as CubeFace]);
      value ??= firstDefinedTexture(blockTextures, ["all", "sides", "horizontals", "verticals"]);
    }
    if (value === undefined && Object.keys(blockTextures).length === 1) {
      value = Object.values(blockTextures)[0];
    }
    value ??= getCaseInsensitive(shapeTextures, alias);
    if (value === undefined && CUBE_FACES.includes(alias as CubeFace)) {
      value = firstDefinedTexture(shapeTextures, FACE_TEXTURE_KEYS[alias as CubeFace]);
      value ??= firstDefinedTexture(shapeTextures, ["all", "sides", "horizontals", "verticals"]);
    }
    if (value === undefined && Object.keys(shapeTextures).length === 1) {
      value = Object.values(shapeTextures)[0];
    }
  }
  if (typeof value === "string" && value.startsWith("#")) {
    return shapeTextureSource(value.slice(1), blockTextures, shapeTextures, seen);
  }
  return value;
}

function resolveCubeTextures(
  resolved: JsonRecord,
  className: string | null,
  drawType: string | null,
  renderPass: string | null,
  shapeBase: string | null,
  textureAssets: ReadonlyMap<string, TextureAsset>,
  textureCache: Map<string, RegistryTexture>,
  warnings: string[],
): RegistryCubeTextures | null {
  const declaredWorldTextures = asRecord(getCaseInsensitive(resolved, "textures"));
  const singularTexture = getCaseInsensitive(resolved, "texture");
  const isImplicitCube = (className === null || className === "Block")
    && drawType === null
    && shapeBase === null
    && (Object.keys(declaredWorldTextures).length > 0 || singularTexture !== undefined);
  if (!isCubeBlock(drawType, shapeBase) && !isImplicitCube) {
    return null;
  }
  const isTopSoil = drawType?.toLowerCase() === "topsoil" || renderPass?.toLowerCase() === "topsoil";
  const inventoryTextures = asRecord(getCaseInsensitive(resolved, "texturesInventory"));
  const worldTextures = Object.keys(declaredWorldTextures).length > 0
    ? declaredWorldTextures
    : singularTexture === undefined || singularTexture === null
      ? {}
      : { all: singularTexture };
  const textures = isTopSoil && Object.keys(inventoryTextures).length > 0
    ? inventoryTextures
    : worldTextures;
  const faces = {} as Record<CubeFace, RegistryFaceTexture>;

  for (const face of CUBE_FACES) {
    const rawFaceTexture = firstDefinedTexture(textures, FACE_TEXTURE_KEYS[face]);
    const faceTexture = resolveFaceTexture(
      rawFaceTexture,
      textureAssets,
      textureCache,
      warnings,
    );
    if (faceTexture === null) {
      warnings.push(`Cube block has no directly resolvable ${face}-face texture.`);
      return null;
    }
    faces[face] = faceTexture;
  }
  return faces;
}

function resolvePileProperties(
  resolved: JsonRecord,
  className: string | null,
  textureAssets: ReadonlyMap<string, TextureAsset>,
  textureCache: Map<string, RegistryTexture>,
  warnings: string[],
): CompiledPileProperties | null {
  if (className !== "BlockCoalPile") {
    return null;
  }
  const textures: Record<string, RegistryFaceTexture> = {};
  for (const [code, rawTexture] of Object.entries(
    asRecord(getCaseInsensitive(resolved, "textures")),
  )) {
    const texture = resolveFaceTexture(rawTexture, textureAssets, textureCache, warnings);
    if (texture !== null) {
      textures[code.toLowerCase()] = texture;
    }
  }
  return Object.keys(textures).length === 0 ? null : { textures };
}

function firstDefinedTexture(textures: JsonRecord, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = getCaseInsensitive(textures, key);
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return null;
}

function resolveFaceTexture(
  rawTexture: unknown,
  textureAssets: ReadonlyMap<string, TextureAsset>,
  textureCache: Map<string, RegistryTexture>,
  warnings: string[],
): RegistryFaceTexture | null {
  const composite = asRecord(rawTexture);
  const base = typeof rawTexture === "string"
    ? rawTexture
    : asString(getCaseInsensitive(composite, "base"));
  if (base === null || base.startsWith("#")) {
    return null;
  }
  const resolvedBase = resolveTextureAsset(base, textureAssets, textureCache, warnings);
  if (resolvedBase.assetPath === null) {
    return null;
  }
  const overlays: RegistryTexture[] = [];
  for (const overlay of asStringArray(getCaseInsensitive(composite, "overlays"))) {
    const resolvedOverlay = resolveTextureAsset(overlay, textureAssets, textureCache, warnings);
    if (resolvedOverlay.assetPath === null) {
      return null;
    }
    overlays.push(resolvedOverlay);
  }
  return {
    base: resolvedBase,
    overlays,
    rotation: asNumber(getCaseInsensitive(composite, "rotation")) ?? 0,
  };
}

function resolveTextureAsset(
  base: string,
  textureAssets: ReadonlyMap<string, TextureAsset>,
  textureCache: Map<string, RegistryTexture>,
  warnings: string[],
): RegistryTexture {

  const normalizedBase = assetPathOnly(base).replace(/^textures\//i, "");
  const cached = textureCache.get(normalizedBase.toLowerCase());
  if (cached !== undefined) {
    if (cached.assetPath === null) {
      warnings.push(`Texture ${base} did not match a local PNG.`);
    }
    return cached;
  }
  const pattern = normalizedBase.toLowerCase().endsWith(".png")
    ? normalizedBase
    : `${normalizedBase}.png`;
  const exactTexture = pattern.includes("*") || pattern.startsWith("@")
    ? undefined
    : textureAssets.get(pattern.toLowerCase());
  const matches = exactTexture === undefined
    ? [...textureAssets.values()]
        .filter((texture) => wildcardMatch(pattern, texture.virtualPath))
        .sort((left, right) => left.virtualPath.localeCompare(right.virtualPath))
    : [exactTexture];
  const chosen = matches[0] ?? null;
  if (chosen === null) {
    warnings.push(`Texture ${base} did not match a local PNG.`);
  }
  const resolvedTexture = {
    base,
    assetPath: chosen?.assetPath ?? null,
    url: chosen === null ? null : assetUrl(chosen.assetPath),
    alternativeCount: matches.length,
  };
  textureCache.set(normalizedBase.toLowerCase(), resolvedTexture);
  return resolvedTexture;
}

function isCubeBlock(drawType: string | null, shapeBase: string | null): boolean {
  const normalizedShape = shapeBase === null ? null : assetPathOnly(shapeBase).toLowerCase();
  const normalizedDrawType = drawType?.toLowerCase();
  return normalizedDrawType === "cube" || normalizedDrawType === "topsoil" || normalizedShape === "block/basic/cube";
}

function removeLoaderProperties(value: JsonRecord): JsonRecord {
  for (const key of ["variantgroups", "allowedVariants", "skipVariants", "enabled"] as const) {
    deleteCaseInsensitive(value, key);
  }
  return value;
}

function mergeObjects(base: JsonRecord, overlay: JsonRecord, mergeArrays: boolean): JsonRecord {
  const result = structuredClone(base);
  for (const [overlayKey, overlayValue] of Object.entries(overlay)) {
    const existingKey = findKeyCaseInsensitive(result, overlayKey);
    const targetKey = existingKey ?? overlayKey;
    const current = result[targetKey];
    if (isRecord(current) && isRecord(overlayValue)) {
      result[targetKey] = mergeObjects(current, overlayValue, mergeArrays);
    } else if (mergeArrays && Array.isArray(current) && Array.isArray(overlayValue)) {
      result[targetKey] = [...current, ...structuredClone(overlayValue)];
    } else {
      result[targetKey] = structuredClone(overlayValue);
    }
  }
  return result;
}

export function wildcardMatch(pattern: string, value: string): boolean {
  if (pattern.startsWith("@")) {
    try {
      return new RegExp(`^(?:${pattern.slice(1)})$`, "i").test(value);
    } catch {
      return false;
    }
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

function fillPlaceholders(value: string, variant: Readonly<Record<string, string>>): string {
  let resolved = value;
  for (const [key, replacement] of Object.entries(variant)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `\\{(?:(?:[^{}]*\\|)?${escapedKey}(?:\\|[^{}]*)?)\\}`,
      "g",
    );
    resolved = resolved.replace(pattern, replacement);
  }
  return resolved;
}

function normalizeAssetLocation(value: string): { domain: string; path: string } {
  const separator = value.indexOf(":");
  return separator < 0
    ? { domain: "game", path: value }
    : { domain: value.slice(0, separator), path: value.slice(separator + 1) };
}

function normalizedCode(value: string): string {
  const location = normalizeAssetLocation(value);
  return `${location.domain}:${location.path}`.toLowerCase();
}

function assetPathOnly(value: string): string {
  return normalizeAssetLocation(value).path;
}

function normalizeWorldPropertyPath(value: string): string {
  return stripJsonExtension(assetPathOnly(value).replace(/^worldproperties\//i, "")).toLowerCase();
}

function normalizeInheritedBlockPath(value: string): string {
  const assetPath = assetPathOnly(value).replace(/^blocktypes\//i, "");
  return (assetPath.toLowerCase().endsWith(".json") ? assetPath : `${assetPath}.json`).toLowerCase();
}

function stripJsonExtension(value: string): string {
  return value.replace(/\.json$/i, "");
}

function assetUrl(assetPath: string, baseUrl = "/@vs-assets"): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const encodedPath = assetPath.split("/").map(encodeURIComponent).join("/");
  return `${normalizedBase}/${encodedPath}`;
}

function rewriteTextureUrls(registry: AssetRegistry, baseUrl: string): void {
  const visited = new WeakSet<object>();
  function visit(value: unknown): void {
    if (typeof value !== "object" || value === null || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    const record = value as JsonRecord;
    if (typeof record["assetPath"] === "string" && "url" in record) {
      record["url"] = assetUrl(record["assetPath"], baseUrl);
    }
    for (const entry of Object.values(record)) visit(entry);
  }
  visit(registry);
}

function getCaseInsensitive(record: JsonRecord, key: string): unknown {
  const actualKey = findKeyCaseInsensitive(record, key);
  return actualKey === null ? undefined : record[actualKey];
}

function findKeyCaseInsensitive(record: JsonRecord, key: string): string | null {
  const lowerKey = key.toLowerCase();
  return Object.keys(record).find((candidate) => candidate.toLowerCase() === lowerKey) ?? null;
}

function deleteCaseInsensitive(record: JsonRecord, key: string): void {
  const actualKey = findKeyCaseInsensitive(record, key);
  if (actualKey !== null) {
    delete record[actualKey];
  }
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  return asArray(value).filter((entry): entry is string => typeof entry === "string");
}

async function countCategoryFiles(assetRoot: string, category: string): Promise<number> {
  let count = 0;
  for (const pack of PACKS) {
    count += (await listFiles(path.join(assetRoot, pack, category), () => true)).length;
  }
  return count;
}

async function countAllFiles(assetRoot: string): Promise<number> {
  return (await listFiles(assetRoot, () => true)).length;
}

async function listFiles(
  root: string,
  include: (fileNameLowerCase: string) => boolean,
): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      const code = isRecord(error) ? error["code"] : null;
      if (code === "ENOENT") {
        return;
      }
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && include(entry.name.toLowerCase())) {
        files.push(absolutePath);
      }
    }
  }
  await visit(root);
  return files;
}

function toPosix(value: string): string {
  return value.replaceAll(path.sep, "/");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
