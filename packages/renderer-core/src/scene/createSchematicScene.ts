import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  DoubleSide,
  FrontSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  NearestFilter,
  NearestMipmapNearestFilter,
  PlaneGeometry,
  SRGBColorSpace,
  StaticDrawUsage,
  Texture,
  TextureLoader,
} from "three";
import type {
  AssetRegistry,
  CompiledBlockDefinition,
  CompiledColorMapReference,
  CompiledDecorProperties,
  CompiledEntityShapeSet,
  CompiledShapeReference,
  CubeFace,
  RegistryFaceTexture,
} from "../assets/types";
import type { ParsedSchematic, SchematicBlock, SchematicDecor } from "../schematic/types";
import {
  getIntArrayAttribute,
  getIntAttribute,
  getNumberAttribute,
  getStringAttribute,
  type TreeAttribute,
} from "../schematic/treeAttribute";
import {
  createJsonShapeGeometry,
  type ShapeMaterialColorMaps,
} from "./createJsonShapeGeometry";
import {
  createMicroblockGeometry,
  type MicroblockGeometryData,
} from "./createMicroblockGeometry";
import {
  resolveGroundStorageContents,
  type ResolvedGroundStorageContent,
} from "./resolveGroundStorage";
import {
  createSupportBeamSegments,
  decodeSupportBeamArray,
  type DecodedSupportBeam,
} from "./supportBeams";
import { resolveCoalPiles, type ResolvedCoalPile } from "./coalPiles";
import { resolveMicroblockFaceTexture } from "./microblockMaterials";
import {
  isFruitTreeDefinition,
  resolveFruitTrees,
  type ResolvedFruitTreePart,
} from "./fruitTrees";

export interface SchematicSceneStats {
  readonly texturedBlockCount: number;
  readonly placeholderBlockCount: number;
  readonly texturedCodeCount: number;
  readonly placeholderCodeCount: number;
  readonly shapedBlockCount: number;
  readonly shapedCodeCount: number;
  readonly microblockBlockCount: number;
  readonly microblockCodeCount: number;
  readonly groundStorageBlockCount: number;
  readonly groundStorageCodeCount: number;
  readonly supportBeamBlockCount: number;
  readonly supportBeamCodeCount: number;
  readonly fruitTreeBlockCount: number;
  readonly fruitTreeCodeCount: number;
  readonly decorCount: number;
  readonly decorCodeCount: number;
  readonly unresolvedDecorCount: number;
  readonly loadedTextureCount: number;
  readonly failedTextureCount: number;
  readonly metaBlockCount: number;
  readonly metaCodeCount: number;
  readonly metaPlaceholderBlockCount: number;
  readonly embeddedMetaMaterialCount: number;
  readonly placeholderBreakdown: readonly PlaceholderBreakdownEntry[];
}

export interface PlaceholderBreakdownEntry {
  readonly code: string;
  readonly count: number;
  readonly reason: string;
}

export interface SchematicScene {
  readonly object: Group;
  readonly renderedBlocks: readonly SchematicBlock[];
  readonly stats: SchematicSceneStats;
  setMetaBlocksVisible(visible: boolean): void;
  setPlaceholderBlocksVisible(visible: boolean): void;
  dispose(): void;
}

interface SupportBeamRenderGroup {
  readonly geometry: BufferGeometry;
  readonly material: MeshBasicMaterial[];
  readonly matrices: Matrix4[];
  readonly materialCode: string;
}

interface DecorRenderGroup {
  readonly geometry: BufferGeometry;
  readonly material: MeshBasicMaterial | MeshBasicMaterial[];
  readonly matrices: Matrix4[];
  readonly code: string;
  readonly renderMode: "decor-surface" | "decor-json-shape";
}

const CUBE_FACES = ["east", "west", "up", "down", "south", "north"] as const;

// Climate colormaps have four pixels of atlas padding around an inner 256 × 256
// rain/temperature map. Vintage Story encodes 20 °C as 170
// ((20 + 20) * 255 / 60), giving the static viewer a temperate daylight sample
// instead of the previous cool ~10 °C sample at 128.
const PREVIEW_CLIMATE_RAINFALL = (4 + 196) / 263;
const PREVIEW_CLIMATE_TEMPERATURE = (4 + 170) / 263;
// The middle of the seasonal map is its green summer band; the row selects a
// neutral foliage-variation sample.
const PREVIEW_SEASON_PROGRESS = 64 / 127;
const PREVIEW_SEASON_VARIATION = 8 / 15;

export async function createSchematicScene(
  schematic: ParsedSchematic,
  registry: AssetRegistry | null,
): Promise<SchematicScene> {
  const renderedBlocks = schematic.blocks.filter((block) =>
    block.code !== "game:air"
    && registry?.blocks[block.code]?.className !== "BlockMultiblock"
    // The lower fruit-press block entity renders the complete two-block press.
    // Its upper proxy intentionally uses block/basic/nothing in the game.
    && registry?.blocks[block.code]?.className !== "BlockFruitPressTop",
  );
  const blocksByCode = groupBlocksByCode(renderedBlocks);
  const resolvedMicroblocks = resolveMicroblocks(schematic, registry);
  const resolvedEntityShapes = resolveEntityShapes(schematic, registry);
  const resolvedFruitTrees = resolveFruitTrees(schematic, registry);
  const resolvedSupportBeams = resolveSupportBeams(schematic, registry);
  const resolvedGroundStorage = registry === null
    ? null
    : resolveGroundStorageContents(schematic, registry);
  const resolvedFirewoodPiles = resolveFirewoodPileElementLimits(schematic, registry);
  const resolvedCoalPiles = registry === null
    ? new Map<number, ResolvedCoalPile>()
    : resolveCoalPiles(schematic, registry);
  const requestedTextures = new Set<string>();
  for (const code of blocksByCode.keys()) {
    const definition = registry?.blocks[code];
    const cubeTextures = definition?.cubeTextures;
    if (cubeTextures !== null && cubeTextures !== undefined) {
      for (const face of CUBE_FACES) {
        addRequestedFaceTexture(cubeTextures[face], requestedTextures);
      }
    }
    if (definition?.shape !== null && definition?.shape !== undefined) {
      for (const faceTexture of Object.values(definition.shape.textures)) {
        if (faceTexture !== undefined) {
          addRequestedFaceTexture(faceTexture, requestedTextures);
        }
      }
    }
    addRequestedColorMap(definition?.climateColorMap, requestedTextures);
    addRequestedColorMap(definition?.seasonColorMap, requestedTextures);
    for (const reference of definition?.supportBeamShapes ?? []) {
      for (const faceTexture of Object.values(reference.textures)) {
        addRequestedFaceTexture(faceTexture, requestedTextures);
      }
    }
    if (definition?.pile !== null && definition?.pile !== undefined) {
      for (const faceTexture of Object.values(definition.pile.textures)) {
        addRequestedFaceTexture(faceTexture, requestedTextures);
      }
    }
  }
  for (const microblock of resolvedMicroblocks.values()) {
    for (const materialCode of microblock.geometryData.materialCodes) {
      const materialDefinition = registry?.blocks[materialCode];
      if (materialDefinition === undefined) {
        continue;
      }
      for (const face of CUBE_FACES) {
        const faceTexture = resolveMicroblockFaceTexture(materialDefinition, face);
        if (faceTexture !== undefined) {
          addRequestedFaceTexture(faceTexture, requestedTextures);
        }
      }
    }
  }
  for (const entityShape of resolvedEntityShapes.values()) {
    for (const faceTexture of Object.values(entityShape.reference.textures)) {
      addRequestedFaceTexture(faceTexture, requestedTextures);
    }
  }
  for (const fruitTree of resolvedFruitTrees.values()) {
    for (const part of fruitTree.parts) {
      for (const faceTexture of Object.values(part.reference.textures)) {
        addRequestedFaceTexture(faceTexture, requestedTextures);
      }
    }
  }
  for (const content of resolvedGroundStorage?.contents ?? []) {
    for (const faceTexture of Object.values(content.reference.textures)) {
      addRequestedFaceTexture(faceTexture, requestedTextures);
    }
  }
  for (const beams of resolvedSupportBeams.values()) {
    for (const beam of beams) {
      for (const reference of beam.shapes) {
        for (const faceTexture of Object.values(reference.textures)) {
          addRequestedFaceTexture(faceTexture, requestedTextures);
        }
      }
    }
  }
  for (const colorMapTexture of Object.values(registry?.colorMaps ?? {})) {
    if (colorMapTexture.url !== null) requestedTextures.add(colorMapTexture.url);
  }
  for (const decor of schematic.decors) {
    const definition = registry?.blocks[decor.code];
    const surfaceTexture = definition?.decor?.surfaceTexture;
    if (surfaceTexture !== null && surfaceTexture !== undefined) {
      addRequestedFaceTexture(surfaceTexture, requestedTextures);
    }
    const reference = definition?.shape;
    if (reference !== null && reference !== undefined) {
      for (const faceTexture of Object.values(reference.textures)) {
        addRequestedFaceTexture(faceTexture, requestedTextures);
      }
    }
  }

  const loadedTextures = new Map<string, Texture>();
  let failedTextureCount = 0;
  const textureLoader = new TextureLoader();
  await Promise.all(
    [...requestedTextures].map(async (url) => {
      try {
        const texture = await textureLoader.loadAsync(url);
        texture.colorSpace = SRGBColorSpace;
        texture.wrapS = ClampToEdgeWrapping;
        texture.wrapT = ClampToEdgeWrapping;
        texture.magFilter = NearestFilter;
        texture.minFilter = NearestMipmapNearestFilter;
        loadedTextures.set(url, texture);
      } catch {
        failedTextureCount += 1;
      }
    }),
  );

  const exactCubeGeometry = new BoxGeometry(1, 1, 1);
  const placeholderGeometry = new BoxGeometry(0.94, 0.94, 0.94);
  const liquidGeometries = new Map<number, BufferGeometry>();
  const decorSurfaceGeometry = new PlaneGeometry(1, 1);
  const object = new Group();
  object.name = "Schematic";
  const materials = new Set<MeshBasicMaterial>();
  const customGeometries = new Set<BufferGeometry>();
  const derivedTextures = new Set<Texture>();
  const faceTextureCache = new Map<string, Texture>();
  const materialCache = new Map<string, MeshBasicMaterial>();
  const metaMeshes: InstancedMesh[] = [];
  const embeddedMetaMaterials = new Set<MeshBasicMaterial>();
  const matrix = new Matrix4();
  let texturedBlockCount = 0;
  let placeholderBlockCount = 0;
  let texturedCodeCount = 0;
  let placeholderCodeCount = 0;
  let shapedBlockCount = 0;
  let shapedCodeCount = 0;
  let microblockBlockCount = 0;
  let microblockCodeCount = 0;
  let groundStorageBlockCount = 0;
  let groundStorageCodeCount = 0;
  let supportBeamBlockCount = 0;
  let supportBeamCodeCount = 0;
  let fruitTreeBlockCount = 0;
  let fruitTreeCodeCount = 0;
  let decorCount = 0;
  let decorCodeCount = 0;
  let unresolvedDecorCount = 0;
  let metaBlockCount = 0;
  let metaCodeCount = 0;
  const placeholderBreakdown = new Map<string, PlaceholderBreakdownEntry>();

  // Support beams are a block-entity behavior and may be hosted by chisels or
  // other blocks. Render those behavior meshes in addition to the host model;
  // standalone BlockSupportBeam hosts are handled in the main loop below.
  if (registry !== null) {
    const hostBlocks = new Map(renderedBlocks.map((block) => [block.packedPosition, block] as const));
    const renderGroups = new Map<string, SupportBeamRenderGroup>();
    const successfulHostPositions = new Set<number>();
    const successfulHostCodes = new Set<string>();
    for (const [packedPosition, beams] of resolvedSupportBeams) {
      const hostBlock = hostBlocks.get(packedPosition);
      if (
        hostBlock === undefined
        || registry.blocks[hostBlock.code]?.className === "BlockSupportBeam"
      ) {
        continue;
      }
      const pending: { group: SupportBeamRenderGroup; matrix: Matrix4 }[] = [];
      let valid = beams.length > 0;
      for (const beam of beams) {
        for (const segment of createSupportBeamSegments(beam, beam.shapes.length === 4)) {
          const reference = beam.shapes[segment.shapeIndex];
          if (reference === undefined || !hasEveryShapeReferenceTexture(reference, loadedTextures)) {
            valid = false;
            break;
          }
          const signature = `${beam.materialCode}:${segment.shapeIndex}`;
          let group = renderGroups.get(signature);
          if (group === undefined) {
            const compiledShape = registry.shapes[reference.key];
            const builtShape = compiledShape === undefined
              ? null
              : createJsonShapeGeometry(compiledShape, reference);
            if (builtShape === null) {
              valid = false;
              break;
            }
            customGeometries.add(builtShape.geometry);
            group = {
              geometry: builtShape.geometry,
              material: builtShape.materialAliases.map((alias, materialIndex) =>
                materialForFace(
                  reference.textures[alias] as RegistryFaceTexture,
                  isTransparentDefinition(beam.definition)
                    || builtShape.materialTransparencies[materialIndex] === true,
                  true,
                  loadedTextures,
                  faceTextureCache,
                  materialCache,
                  materials,
                  derivedTextures,
                ),
              ),
              matrices: [],
              materialCode: beam.materialCode,
            };
            renderGroups.set(signature, group);
          }
          const blockOrigin = new Matrix4().makeTranslation(
            hostBlock.position.x - schematic.size.x / 2,
            hostBlock.position.y,
            hostBlock.position.z - schematic.size.z / 2,
          );
          pending.push({ group, matrix: blockOrigin.multiply(segment.matrix) });
        }
        if (!valid) break;
      }
      if (valid && pending.length > 0) {
        pending.forEach((entry) => entry.group.matrices.push(entry.matrix));
        successfulHostPositions.add(packedPosition);
        successfulHostCodes.add(hostBlock.code);
      }
    }
    for (const group of renderGroups.values()) {
      if (group.matrices.length === 0) continue;
      const mesh = new InstancedMesh(group.geometry, group.material, group.matrices.length);
      mesh.name = `Embedded support-beam segments ${group.materialCode}`;
      mesh.userData.materialCode = group.materialCode;
      mesh.userData.renderMode = "support-beam-behavior";
      mesh.instanceMatrix.setUsage(StaticDrawUsage);
      group.matrices.forEach((instanceMatrix, index) => mesh.setMatrixAt(index, instanceMatrix));
      mesh.instanceMatrix.needsUpdate = true;
      object.add(mesh);
    }
    supportBeamBlockCount += successfulHostPositions.size;
    supportBeamCodeCount += successfulHostCodes.size;
  }

  // Decors are separate, face-attached blocks in a schematic. Surface-layer
  // decors use a lightweight plane, while dimensional decors reuse their JSON
  // shape and are oriented from the shape's native upward-facing attachment.
  if (registry !== null) {
    const renderGroups = new Map<string, DecorRenderGroup>();
    const renderedCodes = new Set<string>();
    for (const decor of schematic.decors) {
      const definition = registry.blocks[decor.code];
      const properties = definition?.decor;
      if (definition === undefined || properties === null || properties === undefined) {
        unresolvedDecorCount += 1;
        continue;
      }

      const surfaceTexture = properties.surfaceTexture;
      if (surfaceTexture !== null && hasFaceTexture(surfaceTexture, loadedTextures)) {
        const signature = `surface:${decor.code}`;
        let group = renderGroups.get(signature);
        if (group === undefined) {
          group = {
            geometry: decorSurfaceGeometry,
            material: materialForFace(
              surfaceTexture,
              true,
              true,
              loadedTextures,
              faceTextureCache,
              materialCache,
              materials,
              derivedTextures,
              null,
              properties.textureTile,
            ),
            matrices: [],
            code: decor.code,
            renderMode: "decor-surface",
          };
          renderGroups.set(signature, group);
        }
        group.matrices.push(createDecorMatrix(decor, schematic, "surface", properties));
        decorCount += 1;
        renderedCodes.add(decor.code);
        continue;
      }

      const reference = definition.shape;
      if (
        reference === null
        || !hasEveryShapeReferenceTexture(reference, loadedTextures)
      ) {
        unresolvedDecorCount += 1;
        continue;
      }
      const signature = `shape:${decor.code}`;
      let group = renderGroups.get(signature);
      if (group === undefined) {
        const compiledShape = registry.shapes[reference.key];
        const builtShape = compiledShape === undefined
          ? null
          : createJsonShapeGeometry(compiledShape, reference);
        if (builtShape === null) {
          unresolvedDecorCount += 1;
          continue;
        }
        customGeometries.add(builtShape.geometry);
        group = {
          geometry: builtShape.geometry,
          material: builtShape.materialAliases.map((alias, materialIndex) =>
            materialForFace(
              reference.textures[alias] as RegistryFaceTexture,
              true,
              true,
              loadedTextures,
              faceTextureCache,
              materialCache,
              materials,
              derivedTextures,
              resolvePreviewColorTint(
                definition,
                loadedTextures,
                registry,
                builtShape.materialColorMaps[materialIndex],
              ),
            ),
          ),
          matrices: [],
          code: decor.code,
          renderMode: "decor-json-shape",
        };
        renderGroups.set(signature, group);
      }
      group.matrices.push(createDecorMatrix(decor, schematic, "shape", properties));
      decorCount += 1;
      renderedCodes.add(decor.code);
    }

    for (const group of renderGroups.values()) {
      if (group.matrices.length === 0) continue;
      const mesh = new InstancedMesh(group.geometry, group.material, group.matrices.length);
      mesh.name = `Decor ${group.code}`;
      mesh.userData.blockCode = group.code;
      mesh.userData.renderMode = group.renderMode;
      mesh.renderOrder = 20;
      mesh.instanceMatrix.setUsage(StaticDrawUsage);
      group.matrices.forEach((instanceMatrix, index) => mesh.setMatrixAt(index, instanceMatrix));
      mesh.instanceMatrix.needsUpdate = true;
      object.add(mesh);
    }
    decorCodeCount = renderedCodes.size;
  } else {
    unresolvedDecorCount = schematic.decors.length;
  }

  for (const [code, codeBlocks] of blocksByCode) {
    const definition = registry?.blocks[code];
    const isMeta = definition?.isMeta === true || code.startsWith("game:meta-");
    if (
      definition !== undefined
      && isFruitTreeDefinition(definition.className)
      && registry !== null
    ) {
      const groups = new Map<string, {
        readonly data: ResolvedFruitTreePart;
        readonly blocks: SchematicBlock[];
      }>();
      const failedPositions = new Set<number>();
      for (const block of codeBlocks) {
        const fruitTree = resolvedFruitTrees.get(block.packedPosition);
        if (fruitTree === undefined || fruitTree.parts.length === 0) {
          failedPositions.add(block.packedPosition);
          continue;
        }
        for (const part of fruitTree.parts) {
          const existing = groups.get(part.signature);
          if (existing === undefined) {
            groups.set(part.signature, { data: part, blocks: [block] });
          } else {
            existing.blocks.push(block);
          }
        }
      }

      const builtGroups: {
        readonly data: ResolvedFruitTreePart;
        readonly blocks: readonly SchematicBlock[];
        readonly builtShape: NonNullable<ReturnType<typeof createJsonShapeGeometry>>;
      }[] = [];
      for (const group of groups.values()) {
        const compiledShape = registry.shapes[group.data.reference.key];
        const builtShape = compiledShape === undefined
          || !hasEveryShapeReferenceTexture(group.data.reference, loadedTextures)
          ? null
          : createJsonShapeGeometry(
              compiledShape,
              group.data.reference,
              null,
              null,
              group.data.selectedElementNames,
            );
        if (builtShape === null) {
          group.blocks.forEach((block) => failedPositions.add(block.packedPosition));
          continue;
        }
        customGeometries.add(builtShape.geometry);
        builtGroups.push({ data: group.data, blocks: group.blocks, builtShape });
      }

      for (const group of builtGroups) {
        const blocks = group.blocks.filter((block) => !failedPositions.has(block.packedPosition));
        if (blocks.length === 0) continue;
        const fruitTreeMaterials = group.builtShape.materialAliases.map((alias, materialIndex) =>
          materialForFace(
            group.data.reference.textures[alias] as RegistryFaceTexture,
            isTransparentDefinition(definition)
              || group.builtShape.materialTransparencies[materialIndex] === true,
            true,
            loadedTextures,
            faceTextureCache,
            materialCache,
            materials,
            derivedTextures,
            resolvePreviewColorTint(
              definition,
              loadedTextures,
              registry,
              group.data.climateColorMap === null && group.data.seasonColorMap === null
                ? group.builtShape.materialColorMaps[materialIndex]
                : {
                    climate: group.data.climateColorMap,
                    season: group.data.seasonColorMap,
                  },
            ),
          ),
        );
        const mesh = createPositionedInstancedMesh(
          group.builtShape.geometry,
          fruitTreeMaterials,
          blocks,
          schematic,
          matrix,
        );
        mesh.name = `Dynamic fruit tree ${code}`;
        mesh.userData.blockCode = code;
        mesh.userData.renderMode = group.data.renderMode;
        object.add(mesh);
      }

      const fallbackBlocks = codeBlocks.filter((block) => failedPositions.has(block.packedPosition));
      if (fallbackBlocks.length > 0) {
        const mesh = createPositionedInstancedMesh(
          placeholderGeometry,
          createPlaceholderMaterial(code, false, materials),
          fallbackBlocks,
          schematic,
          matrix,
        );
        mesh.name = `Placeholder ${code}`;
        mesh.userData.blockCode = code;
        mesh.userData.renderMode = "placeholder";
        object.add(mesh);
        placeholderBlockCount += fallbackBlocks.length;
        placeholderCodeCount += 1;
        addPlaceholderBreakdown(
          placeholderBreakdown,
          code,
          fallbackBlocks.length,
          "fruit-tree block entity, dynamic shape, or species texture unresolved",
        );
      }
      const renderedFruitTreeCount = codeBlocks.length - fallbackBlocks.length;
      if (renderedFruitTreeCount > 0) {
        texturedBlockCount += renderedFruitTreeCount;
        texturedCodeCount += 1;
        shapedBlockCount += renderedFruitTreeCount;
        shapedCodeCount += 1;
        fruitTreeBlockCount += renderedFruitTreeCount;
        fruitTreeCodeCount += 1;
      }
      continue;
    }
    if (isChiseledDefinition(definition) && registry !== null) {
      const groups = groupResolvedMicroblocks(codeBlocks, resolvedMicroblocks);
      let renderedMicroblocksForCode = 0;
      const fallbackBlocks = [...groups.unresolved];
      for (const group of groups.resolved.values()) {
        const built = createMicroblockGeometry(group.data.geometryData);
        if (built === null) {
          fallbackBlocks.push(...group.blocks);
          continue;
        }
        const materialFaces = built.materialFaces.map(({ materialCode, face }) => {
          const materialDefinition = registry.blocks[materialCode];
          const faceTexture = materialDefinition === undefined
            ? undefined
            : resolveMicroblockFaceTexture(materialDefinition, face);
          if (
            materialDefinition === undefined
            || faceTexture === undefined
            || !hasFaceTexture(faceTexture, loadedTextures)
          ) {
            return null;
          }
          return { materialDefinition, faceTexture };
        });
        if (materialFaces.some((entry) => entry === null)) {
          built.geometry.dispose();
          fallbackBlocks.push(...group.blocks);
          continue;
        }
        const microblockMaterials = materialFaces.map((entry) =>
          materialForFace(
            (entry as NonNullable<typeof entry>).faceTexture,
            isTransparentDefinition((entry as NonNullable<typeof entry>).materialDefinition),
            false,
            loadedTextures,
            faceTextureCache,
            materialCache,
            materials,
            derivedTextures,
          ),
        );
        materialFaces.forEach((entry, index) => {
          const material = microblockMaterials[index];
          if (
            material !== undefined
            && (entry as NonNullable<typeof entry>).materialDefinition.isMeta
          ) {
            setEmbeddedMetaMaterialVisible(material, false);
            embeddedMetaMaterials.add(material);
          }
        });
        customGeometries.add(built.geometry);
        const mesh = createPositionedInstancedMesh(
          built.geometry,
          microblockMaterials,
          group.blocks,
          schematic,
          matrix,
        );
        mesh.name = `Chiseled microblock ${code}`;
        mesh.userData.blockCode = code;
        mesh.userData.renderMode = "microblock";
        object.add(mesh);
        renderedMicroblocksForCode += group.blocks.length;
      }
      if (fallbackBlocks.length > 0) {
        const mesh = createPositionedInstancedMesh(
          placeholderGeometry,
          createPlaceholderMaterial(code, false, materials),
          fallbackBlocks,
          schematic,
          matrix,
        );
        mesh.name = `Placeholder ${code}`;
        mesh.userData.blockCode = code;
        mesh.userData.renderMode = "placeholder";
        object.add(mesh);
        placeholderBlockCount += fallbackBlocks.length;
        placeholderCodeCount += 1;
        addPlaceholderBreakdown(
          placeholderBreakdown,
          code,
          fallbackBlocks.length,
          "microblock data or material texture unresolved",
        );
      }
      if (renderedMicroblocksForCode > 0) {
        texturedBlockCount += renderedMicroblocksForCode;
        texturedCodeCount += 1;
        microblockBlockCount += renderedMicroblocksForCode;
        microblockCodeCount += 1;
      }
      continue;
    }
    if (definition?.className === "BlockSupportBeam" && registry !== null) {
      const renderGroups = new Map<string, SupportBeamRenderGroup>();
      const successfulPositions = new Set<number>();
      const fallbackBlocks: SchematicBlock[] = [];

      for (const block of codeBlocks) {
        const beams = resolvedSupportBeams.get(block.packedPosition);
        if (beams === undefined || beams.length === 0) {
          fallbackBlocks.push(block);
          continue;
        }
        const pending: { group: SupportBeamRenderGroup; matrix: Matrix4 }[] = [];
        let valid = true;
        for (const beam of beams) {
          const segments = createSupportBeamSegments(beam, beam.shapes.length === 4);
          if (segments.length === 0) {
            valid = false;
            break;
          }
          for (const segment of segments) {
            const reference = beam.shapes[segment.shapeIndex];
            if (reference === undefined || !hasEveryShapeReferenceTexture(reference, loadedTextures)) {
              valid = false;
              break;
            }
            const signature = `${beam.materialCode}:${segment.shapeIndex}`;
            let group = renderGroups.get(signature);
            if (group === undefined) {
              const compiledShape = registry.shapes[reference.key];
              const builtShape = compiledShape === undefined
                ? null
                : createJsonShapeGeometry(compiledShape, reference);
              if (builtShape === null) {
                valid = false;
                break;
              }
              customGeometries.add(builtShape.geometry);
              group = {
                geometry: builtShape.geometry,
                material: builtShape.materialAliases.map((alias, materialIndex) =>
                  materialForFace(
                    reference.textures[alias] as RegistryFaceTexture,
                    isTransparentDefinition(beam.definition)
                      || builtShape.materialTransparencies[materialIndex] === true,
                    true,
                    loadedTextures,
                    faceTextureCache,
                    materialCache,
                    materials,
                    derivedTextures,
                  ),
                ),
                matrices: [],
                materialCode: beam.materialCode,
              };
              renderGroups.set(signature, group);
            }
            const blockOrigin = new Matrix4().makeTranslation(
              block.position.x - schematic.size.x / 2,
              block.position.y,
              block.position.z - schematic.size.z / 2,
            );
            pending.push({ group, matrix: blockOrigin.multiply(segment.matrix) });
          }
          if (!valid) break;
        }
        if (valid) {
          for (const entry of pending) entry.group.matrices.push(entry.matrix);
          successfulPositions.add(block.packedPosition);
        } else {
          fallbackBlocks.push(block);
        }
      }

      for (const group of renderGroups.values()) {
        if (group.matrices.length === 0) continue;
        const mesh = new InstancedMesh(group.geometry, group.material, group.matrices.length);
        mesh.name = `Support-beam segments ${group.materialCode}`;
        mesh.userData.blockCode = code;
        mesh.userData.materialCode = group.materialCode;
        mesh.userData.renderMode = "support-beam";
        mesh.instanceMatrix.setUsage(StaticDrawUsage);
        group.matrices.forEach((instanceMatrix, index) => mesh.setMatrixAt(index, instanceMatrix));
        mesh.instanceMatrix.needsUpdate = true;
        object.add(mesh);
      }

      if (fallbackBlocks.length > 0) {
        const mesh = createPositionedInstancedMesh(
          placeholderGeometry,
          createPlaceholderMaterial(code, false, materials),
          fallbackBlocks,
          schematic,
          matrix,
        );
        mesh.name = `Placeholder ${code}`;
        mesh.userData.blockCode = code;
        mesh.userData.renderMode = "placeholder";
        object.add(mesh);
        placeholderBlockCount += fallbackBlocks.length;
        placeholderCodeCount += 1;
        addPlaceholderBreakdown(
          placeholderBreakdown,
          code,
          fallbackBlocks.length,
          "support-beam protobuf, material, or segment shape unresolved",
        );
      }
      if (successfulPositions.size > 0) {
        texturedBlockCount += successfulPositions.size;
        texturedCodeCount += 1;
        shapedBlockCount += successfulPositions.size;
        shapedCodeCount += 1;
        supportBeamBlockCount += successfulPositions.size;
        supportBeamCodeCount += 1;
      }
      continue;
    }
    if (definition?.pile !== null && definition?.pile !== undefined && registry !== null) {
      const groups = new Map<string, { data: ResolvedCoalPile; blocks: SchematicBlock[] }>();
      const fallbackBlocks: SchematicBlock[] = [];
      for (const block of codeBlocks) {
        const data = resolvedCoalPiles.get(block.packedPosition);
        if (data === undefined || !hasFaceTexture(data.texture, loadedTextures)) {
          fallbackBlocks.push(block);
          continue;
        }
        const group = groups.get(data.signature);
        if (group === undefined) {
          groups.set(data.signature, { data, blocks: [block] });
        } else {
          group.blocks.push(block);
        }
      }

      let renderedPileCount = 0;
      for (const group of groups.values()) {
        const material = materialForFace(
          group.data.texture,
          false,
          false,
          loadedTextures,
          faceTextureCache,
          materialCache,
          materials,
          derivedTextures,
        );
        const mesh = new InstancedMesh(exactCubeGeometry, material, group.blocks.length);
        mesh.name = `Inventory-sized pile ${code}`;
        mesh.userData.blockCode = code;
        mesh.userData.renderMode = "inventory-sized-pile";
        mesh.instanceMatrix.setUsage(StaticDrawUsage);
        for (let index = 0; index < group.blocks.length; index += 1) {
          const block = group.blocks[index];
          if (block === undefined) continue;
          matrix.makeScale(1, group.data.height, 1);
          matrix.setPosition(
            block.position.x - schematic.size.x / 2 + 0.5,
            block.position.y + group.data.height / 2,
            block.position.z - schematic.size.z / 2 + 0.5,
          );
          mesh.setMatrixAt(index, matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        object.add(mesh);
        renderedPileCount += group.blocks.length;
      }

      if (fallbackBlocks.length > 0) {
        const mesh = createPositionedInstancedMesh(
          placeholderGeometry,
          createPlaceholderMaterial(code, false, materials),
          fallbackBlocks,
          schematic,
          matrix,
        );
        mesh.name = `Placeholder ${code}`;
        mesh.userData.blockCode = code;
        mesh.userData.renderMode = "placeholder";
        object.add(mesh);
        placeholderBlockCount += fallbackBlocks.length;
        placeholderCodeCount += 1;
        addPlaceholderBreakdown(
          placeholderBreakdown,
          code,
          fallbackBlocks.length,
          "pile inventory, amount, or material texture unresolved",
        );
      }
      if (renderedPileCount > 0) {
        texturedBlockCount += renderedPileCount;
        texturedCodeCount += 1;
        shapedBlockCount += renderedPileCount;
        shapedCodeCount += 1;
      }
      continue;
    }
    if (
      definition?.className === "BlockGroundStorage"
      && registry !== null
      && resolvedGroundStorage !== null
    ) {
      const codePositions = new Set(codeBlocks.map((block) => block.packedPosition));
      const contentGroups = groupGroundStorageContents(
        resolvedGroundStorage.contents.filter((content) =>
          codePositions.has(content.block.packedPosition),
        ),
      );
      const successfullyRenderedPositions = new Set<number>();
      const failedPositions = new Set(
        [...resolvedGroundStorage.unresolvedBlockPositions].filter((position) =>
          codePositions.has(position),
        ),
      );
      for (const group of contentGroups.values()) {
        if (!hasEveryShapeReferenceTexture(group.data.reference, loadedTextures)) {
          group.contents.forEach((content) => failedPositions.add(content.block.packedPosition));
          continue;
        }
        const compiledShape = registry.shapes[group.data.reference.key];
        const builtShape = compiledShape === undefined
          ? null
          : createJsonShapeGeometry(
              compiledShape,
              group.data.reference,
              group.data.modelTransform,
              group.data.elementLimit,
            );
        if (builtShape === null) {
          group.contents.forEach((content) => failedPositions.add(content.block.packedPosition));
          continue;
        }
        customGeometries.add(builtShape.geometry);
        const contentMaterials = builtShape.materialAliases.map((alias, materialIndex) =>
          materialForFace(
            group.data.reference.textures[alias] as RegistryFaceTexture,
            builtShape.materialTransparencies[materialIndex] === true
              || (group.data.blockDefinition !== null
                && isTransparentDefinition(group.data.blockDefinition)),
            true,
            loadedTextures,
            faceTextureCache,
            materialCache,
            materials,
            derivedTextures,
          ),
        );
        const mesh = new InstancedMesh(
          builtShape.geometry,
          contentMaterials,
          group.contents.length,
        );
        mesh.name = `Ground storage contents ${group.data.code}`;
        mesh.userData.blockCode = code;
        mesh.userData.contentCode = group.data.code;
        mesh.userData.renderMode = "ground-storage-content";
        mesh.instanceMatrix.setUsage(StaticDrawUsage);
        const rotationMatrix = new Matrix4();
        const offsetMatrix = new Matrix4();
        const layoutRotationMatrix = new Matrix4();
        const layoutScaleMatrix = new Matrix4();
        for (let index = 0; index < group.contents.length; index += 1) {
          const content = group.contents[index];
          if (content === undefined) {
            continue;
          }
          matrix.makeTranslation(
            content.block.position.x - schematic.size.x / 2 + 0.5,
            content.block.position.y + 0.5,
            content.block.position.z - schematic.size.z / 2 + 0.5,
          );
          matrix.multiply(rotationMatrix.makeRotationY(content.meshAngle));
          matrix.multiply(offsetMatrix.makeTranslation(...content.layoutOffset));
          matrix.multiply(layoutRotationMatrix.makeRotationY(content.layoutRotation));
          matrix.multiply(layoutScaleMatrix.makeScale(
            content.layoutScale,
            content.layoutScale,
            content.layoutScale,
          ));
          mesh.setMatrixAt(index, matrix);
          successfullyRenderedPositions.add(content.block.packedPosition);
        }
        mesh.instanceMatrix.needsUpdate = true;
        object.add(mesh);
      }

      const renderedGroundStoragePositions = new Set(
        [...successfullyRenderedPositions].filter((position) => !failedPositions.has(position)),
      );
      const fallbackBlocks = codeBlocks.filter((block) =>
        !renderedGroundStoragePositions.has(block.packedPosition),
      );
      if (fallbackBlocks.length > 0) {
        const mesh = createPositionedInstancedMesh(
          placeholderGeometry,
          createPlaceholderMaterial(code, false, materials),
          fallbackBlocks,
          schematic,
          matrix,
        );
        mesh.name = `Placeholder ${code}`;
        mesh.userData.blockCode = code;
        mesh.userData.renderMode = "placeholder";
        object.add(mesh);
        placeholderBlockCount += fallbackBlocks.length;
        placeholderCodeCount += 1;
        addPlaceholderBreakdown(
          placeholderBreakdown,
          code,
          fallbackBlocks.length,
          "ground-storage inventory, layout, or model unresolved",
        );
      }
      if (renderedGroundStoragePositions.size > 0) {
        texturedBlockCount += renderedGroundStoragePositions.size;
        texturedCodeCount += 1;
        shapedBlockCount += renderedGroundStoragePositions.size;
        shapedCodeCount += 1;
        groundStorageBlockCount += renderedGroundStoragePositions.size;
        groundStorageCodeCount += 1;
      }
      continue;
    }
    if (
      definition?.className === "BlockFirewoodPile"
      && definition.shape !== null
      && registry !== null
    ) {
      const reference = definition.shape;
      const compiledShape = registry.shapes[reference.key];
      const fallbackBlocks: SchematicBlock[] = [];
      let renderedPileCount = 0;
      const groups = new Map<number, SchematicBlock[]>();
      for (const block of codeBlocks) {
        const elementLimit = resolvedFirewoodPiles.get(block.packedPosition);
        if (elementLimit === undefined) {
          fallbackBlocks.push(block);
          continue;
        }
        const group = groups.get(elementLimit);
        if (group === undefined) groups.set(elementLimit, [block]);
        else group.push(block);
      }
      for (const [elementLimit, blocks] of groups) {
        const builtShape = compiledShape === undefined
          || !hasEveryShapeReferenceTexture(reference, loadedTextures)
          ? null
          : createJsonShapeGeometry(compiledShape, reference, null, elementLimit);
        if (builtShape === null) {
          fallbackBlocks.push(...blocks);
          continue;
        }
        customGeometries.add(builtShape.geometry);
        const pileMaterials = builtShape.materialAliases.map((alias, materialIndex) =>
          materialForFace(
            reference.textures[alias] as RegistryFaceTexture,
            builtShape.materialTransparencies[materialIndex] === true,
            true,
            loadedTextures,
            faceTextureCache,
            materialCache,
            materials,
            derivedTextures,
          ),
        );
        const mesh = createPositionedInstancedMesh(
          builtShape.geometry,
          pileMaterials,
          blocks,
          schematic,
          matrix,
        );
        mesh.name = `Inventory-sized firewood pile ${code}`;
        mesh.userData.blockCode = code;
        mesh.userData.renderMode = "firewood-pile";
        object.add(mesh);
        renderedPileCount += blocks.length;
      }
      if (fallbackBlocks.length > 0) {
        const mesh = createPositionedInstancedMesh(
          placeholderGeometry,
          createPlaceholderMaterial(code, false, materials),
          fallbackBlocks,
          schematic,
          matrix,
        );
        mesh.name = `Placeholder ${code}`;
        mesh.userData.blockCode = code;
        mesh.userData.renderMode = "placeholder";
        object.add(mesh);
        placeholderBlockCount += fallbackBlocks.length;
        placeholderCodeCount += 1;
        addPlaceholderBreakdown(
          placeholderBreakdown,
          code,
          fallbackBlocks.length,
          "firewood-pile inventory or shape unresolved",
        );
      }
      if (renderedPileCount > 0) {
        texturedBlockCount += renderedPileCount;
        texturedCodeCount += 1;
        shapedBlockCount += renderedPileCount;
        shapedCodeCount += 1;
      }
      continue;
    }
    if (
      (
        definition?.entityShapes !== null
        && definition?.entityShapes !== undefined
      )
      || definition?.className === "BlockCheese"
    ) {
      if (registry === null) continue;
      const groups = groupResolvedEntityShapes(codeBlocks, resolvedEntityShapes);
      let renderedEntityShapesForCode = 0;
      const fallbackBlocks = [...groups.unresolved];
      for (const group of groups.resolved.values()) {
        if (!hasEveryShapeReferenceTexture(group.data.reference, loadedTextures)) {
          fallbackBlocks.push(...group.blocks);
          continue;
        }
        const compiledShape = registry.shapes[group.data.reference.key];
        const builtShape = compiledShape === undefined
          ? null
          : createJsonShapeGeometry(compiledShape, group.data.reference);
        if (builtShape === null) {
          fallbackBlocks.push(...group.blocks);
          continue;
        }
        customGeometries.add(builtShape.geometry);
        const entityMaterials = builtShape.materialAliases.map((alias, materialIndex) =>
          materialForFace(
            group.data.reference.textures[alias] as RegistryFaceTexture,
            isTransparentDefinition(definition)
              || builtShape.materialTransparencies[materialIndex] === true,
            true,
            loadedTextures,
            faceTextureCache,
            materialCache,
            materials,
            derivedTextures,
            resolvePreviewColorTint(
              definition,
              loadedTextures,
              registry,
              builtShape.materialColorMaps[materialIndex],
            ),
          ),
        );
        const mesh = createPositionedInstancedMesh(
          builtShape.geometry,
          entityMaterials,
          group.blocks,
          schematic,
          matrix,
        );
        mesh.name = `Entity-selected JSON shape ${code}`;
        mesh.userData.blockCode = code;
        mesh.userData.renderMode = "entity-json-shape";
        mesh.userData.isMeta = isMeta;
        if (isMeta) {
          mesh.visible = false;
          mesh.renderOrder = 10;
          metaMeshes.push(mesh);
        }
        object.add(mesh);
        renderedEntityShapesForCode += group.blocks.length;
      }
      if (fallbackBlocks.length > 0) {
        const mesh = createPositionedInstancedMesh(
          placeholderGeometry,
          createPlaceholderMaterial(code, isMeta, materials),
          fallbackBlocks,
          schematic,
          matrix,
        );
        mesh.name = `Placeholder ${code}`;
        mesh.userData.blockCode = code;
        mesh.userData.renderMode = "placeholder";
        mesh.userData.isMeta = isMeta;
        if (isMeta) {
          mesh.visible = false;
          mesh.renderOrder = 10;
          metaMeshes.push(mesh);
        }
        object.add(mesh);
        placeholderBlockCount += fallbackBlocks.length;
        placeholderCodeCount += 1;
        addPlaceholderBreakdown(
          placeholderBreakdown,
          code,
          fallbackBlocks.length,
          "block-entity shape variant unresolved",
        );
      }
      if (renderedEntityShapesForCode > 0) {
        texturedBlockCount += renderedEntityShapesForCode;
        texturedCodeCount += 1;
        shapedBlockCount += renderedEntityShapesForCode;
        shapedCodeCount += 1;
      }
      if (isMeta) {
        metaBlockCount += codeBlocks.length;
        metaCodeCount += 1;
      }
      continue;
    }
    const texturedCube = definition !== undefined && hasEveryCubeTexture(definition, loadedTextures);
    if (texturedCube && definition.drawType?.toLowerCase() === "liquid" && registry !== null) {
      const height = liquidPreviewHeight(definition);
      let liquidGeometry = liquidGeometries.get(height);
      if (liquidGeometry === undefined) {
        liquidGeometry = new BoxGeometry(1, height, 1);
        liquidGeometries.set(height, liquidGeometry);
        customGeometries.add(liquidGeometry);
      }
      const material = createCubeMaterials(
        definition,
        loadedTextures,
        faceTextureCache,
        materialCache,
        materials,
        derivedTextures,
        resolvePreviewColorTint(definition, loadedTextures, registry),
        true,
      );
      const mesh = new InstancedMesh(liquidGeometry, material, codeBlocks.length);
      mesh.name = `Liquid ${code}`;
      mesh.userData.blockCode = code;
      mesh.userData.renderMode = "liquid";
      mesh.renderOrder = 5;
      mesh.instanceMatrix.setUsage(StaticDrawUsage);
      for (let index = 0; index < codeBlocks.length; index += 1) {
        const block = codeBlocks[index];
        if (block === undefined) continue;
        matrix.makeTranslation(
          block.position.x - schematic.size.x / 2 + 0.5,
          block.position.y + height / 2,
          block.position.z - schematic.size.z / 2 + 0.5,
        );
        mesh.setMatrixAt(index, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      object.add(mesh);
      texturedCodeCount += 1;
      texturedBlockCount += codeBlocks.length;
      continue;
    }
    let shaped = false;
    let geometry: BufferGeometry = texturedCube ? exactCubeGeometry : placeholderGeometry;
    let material: MeshBasicMaterial | MeshBasicMaterial[];
    if (texturedCube) {
      material = createCubeMaterials(
          definition,
          loadedTextures,
          faceTextureCache,
          materialCache,
          materials,
          derivedTextures,
          registry === null ? null : resolvePreviewColorTint(definition, loadedTextures, registry),
        );
    } else if (
      definition?.shape !== null
      && definition?.shape !== undefined
      && registry !== null
      && hasEveryShapeTexture(definition, loadedTextures)
    ) {
      const compiledShape = registry.shapes[definition.shape.key];
      const builtShape = compiledShape === undefined
        ? null
        : createJsonShapeGeometry(compiledShape, definition.shape);
      if (builtShape === null) {
        material = createPlaceholderMaterial(code, isMeta, materials);
      } else {
        shaped = true;
        geometry = builtShape.geometry;
        customGeometries.add(geometry);
        material = builtShape.materialAliases.map((alias, materialIndex) =>
          materialForFace(
            definition.shape?.textures[alias] as RegistryFaceTexture,
            isTransparentDefinition(definition)
              || builtShape.materialTransparencies[materialIndex] === true,
            true,
            loadedTextures,
            faceTextureCache,
            materialCache,
            materials,
            derivedTextures,
            resolvePreviewColorTint(
              definition,
              loadedTextures,
              registry,
              builtShape.materialColorMaps[materialIndex],
            ),
          ),
        );
      }
    } else {
      material = createPlaceholderMaterial(code, isMeta, materials);
    }
    const textured = texturedCube || shaped;
    const mesh = new InstancedMesh(geometry, material, codeBlocks.length);
    mesh.name = `${texturedCube ? "Textured cube" : shaped ? "JSON shape" : "Placeholder"} ${code}`;
    mesh.userData.blockCode = code;
    mesh.userData.renderMode = texturedCube ? "textured-cube" : shaped ? "json-shape" : "placeholder";
    mesh.userData.isMeta = isMeta;
    mesh.instanceMatrix.setUsage(StaticDrawUsage);

    for (let index = 0; index < codeBlocks.length; index += 1) {
      const block = codeBlocks[index];
      if (block === undefined) {
        continue;
      }
      matrix.makeTranslation(
        block.position.x - schematic.size.x / 2 + 0.5,
        block.position.y + 0.5,
        block.position.z - schematic.size.z / 2 + 0.5,
      );
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (isMeta) {
      mesh.visible = false;
      mesh.renderOrder = 10;
      metaMeshes.push(mesh);
      metaBlockCount += codeBlocks.length;
      metaCodeCount += 1;
    }
    object.add(mesh);

    if (textured) {
      texturedCodeCount += 1;
      texturedBlockCount += codeBlocks.length;
      if (shaped) {
        shapedCodeCount += 1;
        shapedBlockCount += codeBlocks.length;
      }
    } else {
      placeholderCodeCount += 1;
      placeholderBlockCount += codeBlocks.length;
      addPlaceholderBreakdown(
        placeholderBreakdown,
        code,
        codeBlocks.length,
        placeholderReason(definition),
      );
    }
  }

  const placeholderMeshes: InstancedMesh[] = [];
  object.traverse((child) => {
    if (
      child instanceof InstancedMesh
      && child.userData.renderMode === "placeholder"
    ) {
      placeholderMeshes.push(child);
    }
  });
  const metaPlaceholderBlockCount = placeholderMeshes.reduce(
    (count, mesh) => count + (mesh.userData.isMeta === true ? mesh.count : 0),
    0,
  );
  let metaBlocksVisible = false;
  let placeholderBlocksVisible = false;
  const updateSpecialMeshVisibility = (): void => {
    for (const mesh of new Set([...metaMeshes, ...placeholderMeshes])) {
      mesh.visible = (mesh.userData.isMeta !== true || metaBlocksVisible)
        && (mesh.userData.renderMode !== "placeholder" || placeholderBlocksVisible);
    }
  };
  updateSpecialMeshVisibility();

  return {
    object,
    renderedBlocks,
    stats: {
      texturedBlockCount,
      placeholderBlockCount,
      texturedCodeCount,
      placeholderCodeCount,
      shapedBlockCount,
      shapedCodeCount,
      microblockBlockCount,
      microblockCodeCount,
      groundStorageBlockCount,
      groundStorageCodeCount,
      supportBeamBlockCount,
      supportBeamCodeCount,
      fruitTreeBlockCount,
      fruitTreeCodeCount,
      decorCount,
      decorCodeCount,
      unresolvedDecorCount,
      loadedTextureCount: loadedTextures.size,
      failedTextureCount,
      metaBlockCount,
      metaCodeCount,
      metaPlaceholderBlockCount,
      embeddedMetaMaterialCount: embeddedMetaMaterials.size,
      placeholderBreakdown: [...placeholderBreakdown.values()]
        .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code)),
    },
    setMetaBlocksVisible(visible: boolean): void {
      metaBlocksVisible = visible;
      updateSpecialMeshVisibility();
      for (const material of embeddedMetaMaterials) {
        setEmbeddedMetaMaterialVisible(material, visible);
      }
    },
    setPlaceholderBlocksVisible(visible: boolean): void {
      placeholderBlocksVisible = visible;
      updateSpecialMeshVisibility();
    },
    dispose(): void {
      exactCubeGeometry.dispose();
      placeholderGeometry.dispose();
      decorSurfaceGeometry.dispose();
      for (const geometry of customGeometries) {
        geometry.dispose();
      }
      for (const material of materials) {
        material.dispose();
      }
      for (const texture of derivedTextures) {
        texture.dispose();
      }
      for (const texture of loadedTextures.values()) {
        texture.dispose();
      }
    },
  };
}

function createDecorMatrix(
  decor: SchematicDecor,
  schematic: ParsedSchematic,
  mode: "surface" | "shape",
  properties: CompiledDecorProperties,
): Matrix4 {
  const center = new Matrix4().makeTranslation(
    decor.position.x - schematic.size.x / 2 + 0.5,
    decor.position.y + 0.5,
    decor.position.z - schematic.size.z / 2 + 0.5,
  );
  // Surface layers are authored against one exact block face. Their saved
  // decor rotation is authoritative; synthesizing a block-level random Y
  // rotation here makes damaged-stone and moss planes visibly leave the grid.
  const angle = decorRotationRadians(
    decor,
    mode === "shape" && properties.randomizeRotations,
  );

  if (mode === "surface") {
    const { x, y, z, scale } = surfaceDecorPlacement(decor);
    return center
      .multiply(new Matrix4().makeTranslation(x, y, z))
      .multiply(surfaceDecorFaceOrientation(decor.faceIndex))
      .multiply(new Matrix4().makeRotationZ(angle))
      .multiply(new Matrix4().makeScale(scale, scale, scale));
  }

  if (properties.sidedVariants) {
    return center;
  }
  return center
    .multiply(decorFaceOrientation(decor.faceIndex))
    .multiply(new Matrix4().makeRotationY(angle))
    .multiply(new Matrix4().makeTranslation(0, 1.001, 0));
}

function surfaceDecorFaceOrientation(faceIndex: number): Matrix4 {
  switch (faceIndex) {
    case 0: return new Matrix4().makeRotationY(Math.PI);
    case 1: return new Matrix4().makeRotationY(Math.PI / 2);
    case 2: return new Matrix4();
    case 3: return new Matrix4().makeRotationY(-Math.PI / 2);
    case 4: return new Matrix4().makeRotationX(-Math.PI / 2);
    case 5: return new Matrix4().makeRotationX(Math.PI / 2);
    default: return new Matrix4();
  }
}

function decorFaceOrientation(faceIndex: number): Matrix4 {
  switch (faceIndex) {
    case 0: return new Matrix4().makeRotationX(-Math.PI / 2);
    case 1: return new Matrix4().makeRotationZ(-Math.PI / 2);
    case 2: return new Matrix4().makeRotationX(Math.PI / 2);
    case 3: return new Matrix4().makeRotationZ(Math.PI / 2);
    case 4: return new Matrix4();
    case 5: return new Matrix4().makeRotationX(Math.PI);
    default: return new Matrix4();
  }
}

function surfaceDecorPlacement(
  decor: SchematicDecor,
): { x: number; y: number; z: number; scale: number } {
  if (decor.subPosition === 0) {
    switch (decor.faceIndex) {
      case 0: return { x: 0, y: 0, z: -0.501, scale: 1 };
      case 1: return { x: 0.501, y: 0, z: 0, scale: 1 };
      case 2: return { x: 0, y: 0, z: 0.501, scale: 1 };
      case 3: return { x: -0.501, y: 0, z: 0, scale: 1 };
      case 4: return { x: 0, y: 0.501, z: 0, scale: 1 };
      case 5: return { x: 0, y: -0.501, z: 0, scale: 1 };
      default: return { x: 0, y: 0, z: 0, scale: 1 };
    }
  }

  const offset = Math.max(0, Math.min(255, decor.subPosition - 1));
  const low = offset % 16;
  const high = Math.floor(offset / 16);
  const cell = (value: number): number => (value + 0.5) / 16 - 0.5;
  switch (decor.faceIndex) {
    case 0: return { x: cell(15 - low), y: cell(high), z: -0.501, scale: 1 / 16 };
    case 1: return { x: 0.501, y: cell(high), z: cell(15 - low), scale: 1 / 16 };
    case 2: return { x: cell(low), y: cell(high), z: 0.501, scale: 1 / 16 };
    case 3: return { x: -0.501, y: cell(high), z: cell(low), scale: 1 / 16 };
    case 4: return { x: cell(low), y: 0.501, z: cell(high), scale: 1 / 16 };
    case 5: return { x: cell(low), y: -0.501, z: cell(15 - high), scale: 1 / 16 };
    default: return { x: 0, y: 0, z: 0, scale: 1 / 16 };
  }
}

export function decorRotationRadians(decor: SchematicDecor, randomize: boolean): number {
  if (decor.rotation !== 0) {
    return (decor.rotation % 4) * Math.PI / 2;
  }
  if (!randomize) {
    return 0;
  }
  const randomRotations = [-22.5, 22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5];
  const hashedIndex = Math.abs((decor.packedPosition * 31 + decor.ordinal * 17) | 0) % 8;
  return ((randomRotations[hashedIndex] ?? 0) * Math.PI) / 180;
}

function setEmbeddedMetaMaterialVisible(
  material: MeshBasicMaterial,
  visible: boolean,
): void {
  material.opacity = visible ? 0.38 : 0;
  material.transparent = true;
  material.depthWrite = false;
  material.needsUpdate = true;
}

function hasEveryCubeTexture(
  definition: CompiledBlockDefinition,
  loadedTextures: ReadonlyMap<string, Texture>,
): boolean {
  if (definition.cubeTextures === null) {
    return false;
  }
  for (const face of CUBE_FACES) {
    const faceTexture = definition.cubeTextures[face];
    if (faceTexture.base.url === null || !loadedTextures.has(faceTexture.base.url)) {
      return false;
    }
    for (const overlay of faceTexture.overlays) {
      if (overlay.url === null || !loadedTextures.has(overlay.url)) {
        return false;
      }
    }
  }
  return true;
}

function hasEveryShapeTexture(
  definition: CompiledBlockDefinition,
  loadedTextures: ReadonlyMap<string, Texture>,
): boolean {
  if (definition.shape === null) {
    return false;
  }
  return Object.values(definition.shape.textures).every((faceTexture) =>
    faceTexture !== undefined && hasFaceTexture(faceTexture, loadedTextures),
  );
}

function hasEveryShapeReferenceTexture(
  reference: CompiledShapeReference,
  loadedTextures: ReadonlyMap<string, Texture>,
): boolean {
  return Object.values(reference.textures).every((faceTexture) =>
    hasFaceTexture(faceTexture, loadedTextures),
  );
}

function hasFaceTexture(
  faceTexture: RegistryFaceTexture,
  loadedTextures: ReadonlyMap<string, Texture>,
): boolean {
  return faceTexture.base.url !== null
    && loadedTextures.has(faceTexture.base.url)
    && faceTexture.overlays.every((overlay) =>
      overlay.url !== null && loadedTextures.has(overlay.url),
    );
}

function addRequestedFaceTexture(
  faceTexture: RegistryFaceTexture,
  requestedTextures: Set<string>,
): void {
  if (faceTexture.base.url !== null) {
    requestedTextures.add(faceTexture.base.url);
  }
  for (const overlay of faceTexture.overlays) {
    if (overlay.url !== null) {
      requestedTextures.add(overlay.url);
    }
  }
}

function addRequestedColorMap(
  reference: CompiledColorMapReference | null | undefined,
  requestedTextures: Set<string>,
): void {
  if (reference?.texture.url !== null && reference?.texture.url !== undefined) {
    requestedTextures.add(reference.texture.url);
  }
}

function resolvePreviewColorTint(
  definition: CompiledBlockDefinition,
  loadedTextures: ReadonlyMap<string, Texture>,
  registry: AssetRegistry,
  elementColorMaps?: ShapeMaterialColorMaps,
): Color | null {
  if (!shouldApplyPreviewColorTint(definition, elementColorMaps !== undefined)) {
    return null;
  }
  const climateReference = resolveElementColorMapReference(
    elementColorMaps?.climate,
    definition.climateColorMap,
    registry,
  );
  const seasonReference = resolveElementColorMapReference(
    elementColorMaps?.season,
    definition.seasonColorMap,
    registry,
  );
  const climate = sampleColorMap(
    climateReference,
    loadedTextures,
    PREVIEW_CLIMATE_RAINFALL,
    PREVIEW_CLIMATE_TEMPERATURE,
  );
  const season = sampleColorMap(
    seasonReference,
    loadedTextures,
    PREVIEW_SEASON_PROGRESS,
    PREVIEW_SEASON_VARIATION,
  );
  if (climate === null && season === null) {
    return null;
  }
  const climateRgb = climate ?? [1, 1, 1];
  const seasonRgb = season ?? [1, 1, 1];
  return new Color().setRGB(
    climateRgb[0] * seasonRgb[0],
    climateRgb[1] * seasonRgb[1],
    climateRgb[2] * seasonRgb[2],
  );
}

export function shouldApplyPreviewColorTint(
  definition: CompiledBlockDefinition,
  hasElementColorMaps = false,
): boolean {
  return !definition.ignoreTintInventory || hasElementColorMaps;
}

function resolveElementColorMapReference(
  code: string | null | undefined,
  fallback: CompiledColorMapReference | null,
  registry: AssetRegistry,
): CompiledColorMapReference | null {
  if (code === null || code === undefined) {
    return fallback;
  }
  const texture = registry.colorMaps[code.toLowerCase()];
  return texture === undefined ? fallback : { code, texture };
}

function sampleColorMap(
  reference: CompiledColorMapReference | null,
  loadedTextures: ReadonlyMap<string, Texture>,
  normalizedX: number,
  normalizedY: number,
): readonly [number, number, number] | null {
  const url = reference?.texture.url;
  if (url === null || url === undefined) {
    return null;
  }
  const texture = loadedTextures.get(url);
  if (texture === undefined) {
    return null;
  }
  const size = imageSize(texture.image);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) {
    return null;
  }
  context.drawImage(texture.image as CanvasImageSource, 0, 0, size.width, size.height);
  const x = Math.max(0, Math.min(size.width - 1, Math.round(normalizedX * (size.width - 1))));
  const y = Math.max(0, Math.min(size.height - 1, Math.round(normalizedY * (size.height - 1))));
  const pixel = context.getImageData(x, y, 1, 1).data;
  return [(pixel[0] ?? 255) / 255, (pixel[1] ?? 255) / 255, (pixel[2] ?? 255) / 255];
}

function createCubeMaterials(
  definition: CompiledBlockDefinition,
  loadedTextures: ReadonlyMap<string, Texture>,
  faceTextureCache: Map<string, Texture>,
  materialCache: Map<string, MeshBasicMaterial>,
  materials: Set<MeshBasicMaterial>,
  derivedTextures: Set<Texture>,
  colorTint: Color | null = null,
  depthWriteOverride: boolean | null = null,
): MeshBasicMaterial | MeshBasicMaterial[] {
  const cubeTextures = definition.cubeTextures;
  if (cubeTextures === null) {
    throw new Error(`Missing cube textures for ${definition.code}.`);
  }
  const transparent = isTransparentDefinition(definition);
  const signatures = CUBE_FACES.map((face) => faceTextureSignature(cubeTextures[face]));
  if (signatures.every((signature) => signature === signatures[0])) {
    return materialForFace(
      cubeTextures.east,
      transparent,
      false,
      loadedTextures,
      faceTextureCache,
      materialCache,
      materials,
      derivedTextures,
      colorTint,
      null,
      depthWriteOverride,
    );
  }
  return CUBE_FACES.map((face) =>
    materialForFace(
      cubeTextures[face],
      transparent,
      false,
      loadedTextures,
      faceTextureCache,
      materialCache,
      materials,
      derivedTextures,
      colorTint,
      null,
      depthWriteOverride,
    ),
  );
}

function materialForFace(
  faceTexture: RegistryFaceTexture,
  transparent: boolean,
  doubleSided: boolean,
  loadedTextures: ReadonlyMap<string, Texture>,
  faceTextureCache: Map<string, Texture>,
  materialCache: Map<string, MeshBasicMaterial>,
  materials: Set<MeshBasicMaterial>,
  derivedTextures: Set<Texture>,
  colorTint: Color | null = null,
  textureTile: readonly [number, number, number, number] | null = null,
  depthWriteOverride: boolean | null = null,
): MeshBasicMaterial {
  const tintSignature = colorTint === null ? "untinted" : colorTint.getHexString();
  const tileSignature = textureTile === null ? "full" : textureTile.join(",");
  const depthWrite = depthWriteOverride ?? !transparent;
  const signature = `${transparent ? "transparent" : "opaque"}:${doubleSided ? "double" : "front"}:${depthWrite ? "write-depth" : "skip-depth"}:${tintSignature}:${tileSignature}:${faceTextureSignature(faceTexture)}`;
  const cached = materialCache.get(signature);
  if (cached !== undefined) {
    return cached;
  }
  const map = composeFaceTexture(
    faceTexture,
    loadedTextures,
    faceTextureCache,
    derivedTextures,
    textureTile,
  );
  const material = new MeshBasicMaterial({
    map,
    color: colorTint ?? 0xffffff,
    alphaTest: transparent ? 0.01 : 0.1,
    transparent,
    depthWrite,
    side: doubleSided ? DoubleSide : FrontSide,
  });
  materialCache.set(signature, material);
  materials.add(material);
  return material;
}

function isTransparentDefinition(definition: CompiledBlockDefinition): boolean {
  const renderPass = definition.renderPass?.toLowerCase() ?? "";
  return definition.isMeta
    || renderPass.includes("transparent")
    || renderPass.includes("blend")
    || renderPass.includes("liquid");
}

export function liquidPreviewHeight(definition: CompiledBlockDefinition): number {
  if (definition.variant.flow === "d") return 1;
  const level = Number.parseInt(definition.variant.height ?? "7", 10);
  return Math.max(1, Math.min(7, Number.isFinite(level) ? level : 7)) / 8;
}

function createPlaceholderMaterial(
  code: string,
  isMeta: boolean,
  materials: Set<MeshBasicMaterial>,
): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    color: colorForCode(code, new Color()),
    opacity: isMeta ? 0.38 : 1,
    transparent: isMeta,
    depthWrite: !isMeta,
  });
  materials.add(material);
  return material;
}

function composeFaceTexture(
  faceTexture: RegistryFaceTexture,
  loadedTextures: ReadonlyMap<string, Texture>,
  faceTextureCache: Map<string, Texture>,
  derivedTextures: Set<Texture>,
  textureTile: readonly [number, number, number, number] | null = null,
): Texture {
  const signature = `${faceTextureSignature(faceTexture)}:tile=${textureTile?.join(",") ?? "full"}`;
  const cached = faceTextureCache.get(signature);
  if (cached !== undefined) {
    return cached;
  }
  const baseUrl = faceTexture.base.url;
  if (baseUrl === null) {
    throw new Error(`Missing texture URL for ${faceTexture.base.base}.`);
  }
  const baseTexture = loadedTextures.get(baseUrl);
  if (baseTexture === undefined) {
    throw new Error(`Texture was not loaded: ${baseUrl}.`);
  }
  if (
    faceTexture.overlays.length === 0
    && normalizeRotation(faceTexture.rotation) === 0
    && textureTile === null
  ) {
    faceTextureCache.set(signature, baseTexture);
    return baseTexture;
  }

  let texture: Texture;
  if (faceTexture.overlays.length === 0) {
    texture = baseTexture.clone();
    texture.needsUpdate = true;
  } else {
    const size = imageSize(baseTexture.image);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("Could not create a 2D canvas for texture overlays.");
    }
    context.imageSmoothingEnabled = false;
    context.drawImage(baseTexture.image as CanvasImageSource, 0, 0, size.width, size.height);
    for (const overlay of faceTexture.overlays) {
      if (overlay.url === null) {
        continue;
      }
      const overlayTexture = loadedTextures.get(overlay.url);
      if (overlayTexture !== undefined) {
        context.drawImage(overlayTexture.image as CanvasImageSource, 0, 0, size.width, size.height);
      }
    }
    texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestMipmapNearestFilter;
  }
  const rotation = normalizeRotation(faceTexture.rotation);
  if (rotation !== 0) {
    texture.center.set(0.5, 0.5);
    texture.rotation = -(rotation * Math.PI) / 180;
  }
  if (textureTile !== null) {
    const [column, row, columnCount, rowCount] = textureTile;
    texture.repeat.set(1 / columnCount, 1 / rowCount);
    texture.offset.set(column / columnCount, 1 - (row + 1) / rowCount);
  }
  derivedTextures.add(texture);
  faceTextureCache.set(signature, texture);
  return texture;
}

function faceTextureSignature(faceTexture: RegistryFaceTexture): string {
  return [
    faceTexture.base.url ?? "missing",
    ...faceTexture.overlays.map((overlay) => overlay.url ?? "missing"),
    `rotation=${normalizeRotation(faceTexture.rotation)}`,
  ].join("|");
}

function normalizeRotation(rotation: number): number {
  return ((rotation % 360) + 360) % 360;
}

function imageSize(image: unknown): { width: number; height: number } {
  if (typeof image !== "object" || image === null) {
    return { width: 16, height: 16 };
  }
  const candidate = image as {
    naturalHeight?: unknown;
    naturalWidth?: unknown;
    height?: unknown;
    width?: unknown;
  };
  const width = typeof candidate.naturalWidth === "number"
    ? candidate.naturalWidth
    : typeof candidate.width === "number" ? candidate.width : 16;
  const height = typeof candidate.naturalHeight === "number"
    ? candidate.naturalHeight
    : typeof candidate.height === "number" ? candidate.height : 16;
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

function addPlaceholderBreakdown(
  breakdown: Map<string, PlaceholderBreakdownEntry>,
  code: string,
  count: number,
  reason: string,
): void {
  const existing = breakdown.get(code);
  breakdown.set(code, {
    code,
    count: (existing?.count ?? 0) + count,
    reason,
  });
}

function placeholderReason(definition: CompiledBlockDefinition | undefined): string {
  if (definition === undefined) {
    return "block definition not found";
  }
  if (definition.className !== null) {
    return `custom ${definition.className} renderer pending`;
  }
  if (definition.shapeBase !== null) {
    return "shape or shape texture unresolved";
  }
  return "render definition unresolved";
}

interface ResolvedSupportBeam extends DecodedSupportBeam {
  readonly materialCode: string;
  readonly definition: CompiledBlockDefinition;
  readonly shapes: readonly CompiledShapeReference[];
}

function resolveSupportBeams(
  schematic: ParsedSchematic,
  registry: AssetRegistry | null,
): Map<number, ResolvedSupportBeam[]> {
  const resolved = new Map<number, ResolvedSupportBeam[]>();
  if (registry === null) {
    return resolved;
  }
  const entities = new Map(
    schematic.blockEntities.map((entity) => [entity.packedPosition, entity] as const),
  );
  for (const block of schematic.blocks) {
    const placedDefinition = registry.blocks[block.code];
    if (placedDefinition === undefined) {
      continue;
    }
    const beamsAttribute = entities.get(block.packedPosition)?.attributes?.beams;
    if (beamsAttribute?.type !== "bytes") {
      continue;
    }
    try {
      const decoded = decodeSupportBeamArray(beamsAttribute.value);
      const blockBeams: ResolvedSupportBeam[] = [];
      let valid = decoded.length > 0;
      for (const beam of decoded) {
        const materialCode = schematic.blockCodes.get(beam.blockId) ?? block.code;
        const materialDefinition = registry.blocks[materialCode];
        const shapes = materialDefinition?.supportBeamShapes;
        if (
          materialDefinition === undefined
          || shapes === null
          || shapes === undefined
          || (shapes.length !== 1 && shapes.length !== 4)
        ) {
          valid = false;
          break;
        }
        blockBeams.push({ ...beam, materialCode, definition: materialDefinition, shapes });
      }
      if (valid) {
        resolved.set(block.packedPosition, blockBeams);
      }
    } catch {
      // Keep the block unresolved so the caller can present a diagnostic placeholder.
    }
  }
  return resolved;
}

interface ResolvedMicroblock {
  readonly signature: string;
  readonly geometryData: MicroblockGeometryData;
}

interface ResolvedMicroblockGroup {
  readonly data: ResolvedMicroblock;
  readonly blocks: SchematicBlock[];
}

interface ResolvedEntityShape {
  readonly signature: string;
  readonly reference: CompiledShapeReference;
}

interface ResolvedEntityShapeGroup {
  readonly data: ResolvedEntityShape;
  readonly blocks: SchematicBlock[];
}

interface ResolvedGroundStorageContentGroup {
  readonly data: ResolvedGroundStorageContent;
  readonly contents: ResolvedGroundStorageContent[];
}

function groupGroundStorageContents(
  contents: readonly ResolvedGroundStorageContent[],
): Map<string, ResolvedGroundStorageContentGroup> {
  const groups = new Map<string, ResolvedGroundStorageContentGroup>();
  for (const content of contents) {
    const group = groups.get(content.signature);
    if (group === undefined) {
      groups.set(content.signature, { data: content, contents: [content] });
    } else {
      group.contents.push(content);
    }
  }
  return groups;
}

function resolveEntityShapes(
  schematic: ParsedSchematic,
  registry: AssetRegistry | null,
): Map<number, ResolvedEntityShape> {
  const resolved = new Map<number, ResolvedEntityShape>();
  if (registry === null) {
    return resolved;
  }
  const entities = new Map(
    schematic.blockEntities.map((entity) => [entity.packedPosition, entity] as const),
  );
  for (const block of schematic.blocks) {
    const blockDefinition = registry.blocks[block.code];
    const attributes = entities.get(block.packedPosition)?.attributes;
    if (blockDefinition?.className === "BlockCheese") {
      const stack = firstInventoryStack(attributes);
      const itemCode = stack === null
        ? undefined
        : (stack.itemClass === 0 ? schematic.blockCodes : schematic.itemCodes).get(stack.id);
      const reference = stack?.itemClass === 0
        ? itemCode === undefined ? undefined : registry.blocks[itemCode]?.shape
        : itemCode === undefined ? undefined : registry.items[itemCode]?.shape;
      if (reference !== null && reference !== undefined && itemCode !== undefined) {
        resolved.set(block.packedPosition, {
          reference,
          signature: JSON.stringify(["inventory-shape", itemCode, reference]),
        });
      }
      continue;
    }
    const shapeSet = blockDefinition?.entityShapes;
    if (shapeSet === null || shapeSet === undefined) {
      continue;
    }
    const variantKey = entityShapeVariantKey(shapeSet, attributes);
    const defaultKey = shapeSet.defaultValues.join("\u001f");
    const baseReference = shapeSet.variants[variantKey] ?? shapeSet.variants[defaultKey];
    if (baseReference === undefined) {
      continue;
    }
    const radiansToDegrees = 180 / Math.PI;
    const reference: CompiledShapeReference = attributes === null || attributes === undefined
      ? baseReference
      : {
          ...baseReference,
          rotateX: baseReference.rotateX
            + getNumberAttribute(attributes, "rotateX") * radiansToDegrees,
          rotateY: baseReference.rotateY
            + (
              getNumberAttribute(attributes, "meshAngle")
              + getNumberAttribute(attributes, "rotateY")
            ) * radiansToDegrees,
          rotateZ: baseReference.rotateZ
            + getNumberAttribute(attributes, "rotateZ") * radiansToDegrees,
          offsetX: baseReference.offsetX + getNumberAttribute(attributes, "offsetX"),
          offsetY: baseReference.offsetY + getNumberAttribute(attributes, "offsetY"),
          offsetZ: baseReference.offsetZ + getNumberAttribute(attributes, "offsetZ"),
        };
    resolved.set(block.packedPosition, {
      reference,
      signature: JSON.stringify([
        variantKey,
        reference.rotateX,
        reference.rotateY,
        reference.rotateZ,
        reference.offsetX,
        reference.offsetY,
        reference.offsetZ,
      ]),
    });
  }
  return resolved;
}

function resolveFirewoodPileElementLimits(
  schematic: ParsedSchematic,
  registry: AssetRegistry | null,
): Map<number, number> {
  const limits = new Map<number, number>();
  if (registry === null) return limits;
  const entities = new Map(
    schematic.blockEntities.map((entity) => [entity.packedPosition, entity] as const),
  );
  for (const block of schematic.blocks) {
    if (registry.blocks[block.code]?.className !== "BlockFirewoodPile") continue;
    const stack = firstInventoryStack(entities.get(block.packedPosition)?.attributes);
    if (stack === null || stack.stackSize <= 0) continue;
    limits.set(block.packedPosition, Math.min(16, Math.ceil(stack.stackSize / 2)));
  }
  return limits;
}

function firstInventoryStack(
  attributes: TreeAttribute | null | undefined,
): import("../schematic/treeAttribute").DecodedItemStack | null {
  const inventory = attributes?.inventory;
  const slots = inventory?.type === "tree" ? inventory.value.slots : undefined;
  if (slots?.type !== "tree") return null;
  for (const value of Object.values(slots.value)) {
    if (value.type === "itemstack" && value.value !== null) return value.value;
  }
  return null;
}

function entityShapeVariantKey(
  shapeSet: CompiledEntityShapeSet,
  attributes: TreeAttribute | null | undefined,
): string {
  return shapeSet.attributeKeys.map((key, index) => {
    const fallback = shapeSet.defaultValues[index] ?? "";
    if (attributes === null || attributes === undefined) {
      return fallback;
    }
    return getStringAttribute(attributes, key, fallback) || fallback;
  }).join("\u001f");
}

function groupResolvedEntityShapes(
  blocks: readonly SchematicBlock[],
  resolved: ReadonlyMap<number, ResolvedEntityShape>,
): {
  readonly resolved: Map<string, ResolvedEntityShapeGroup>;
  readonly unresolved: SchematicBlock[];
} {
  const groups = new Map<string, ResolvedEntityShapeGroup>();
  const unresolved: SchematicBlock[] = [];
  for (const block of blocks) {
    const data = resolved.get(block.packedPosition);
    if (data === undefined) {
      unresolved.push(block);
      continue;
    }
    const group = groups.get(data.signature);
    if (group === undefined) {
      groups.set(data.signature, { data, blocks: [block] });
    } else {
      group.blocks.push(block);
    }
  }
  return { resolved: groups, unresolved };
}

function resolveMicroblocks(
  schematic: ParsedSchematic,
  registry: AssetRegistry | null,
): Map<number, ResolvedMicroblock> {
  const resolved = new Map<number, ResolvedMicroblock>();
  if (registry === null) {
    return resolved;
  }
  const entities = new Map(
    schematic.blockEntities.map((entity) => [entity.packedPosition, entity] as const),
  );
  for (const block of schematic.blocks) {
    if (!isChiseledDefinition(registry.blocks[block.code])) {
      continue;
    }
    const attributes = entities.get(block.packedPosition)?.attributes;
    if (attributes === null || attributes === undefined) {
      continue;
    }
    const materialIds = getIntArrayAttribute(attributes, "materials");
    const cuboids = getIntArrayAttribute(attributes, "cuboids");
    if (materialIds === null || cuboids === null || materialIds.length === 0 || cuboids.length === 0) {
      continue;
    }
    const materialCodes = materialIds.map((id) => schematic.blockCodes.get(id));
    if (materialCodes.some((code) => {
      if (code === undefined) return true;
      const definition = registry.blocks[code];
      return definition === undefined
        || CUBE_FACES.some((face) => resolveMicroblockFaceTexture(definition, face) === undefined);
    })) {
      continue;
    }
    const encodedRotation = getIntAttribute(attributes, "rotation", 360 << 10);
    const decodedRotationY = ((encodedRotation >>> 10) & 0x3ff) - 360;
    const rotationY = ((decodedRotationY % 360) + 360) % 360;
    const geometryData: MicroblockGeometryData = {
      cuboids: cuboids.map((value) => value >>> 0),
      materialCodes: materialCodes as string[],
      rotationY,
    };
    resolved.set(block.packedPosition, {
      geometryData,
      signature: JSON.stringify([
        geometryData.materialCodes,
        geometryData.cuboids,
        geometryData.rotationY,
      ]),
    });
  }
  return resolved;
}

function isChiseledDefinition(
  definition: CompiledBlockDefinition | undefined,
): boolean {
  return definition?.className === "BlockMicroBlock"
    || definition?.className === "BlockChisel";
}

function groupResolvedMicroblocks(
  blocks: readonly SchematicBlock[],
  resolved: ReadonlyMap<number, ResolvedMicroblock>,
): {
  readonly resolved: Map<string, ResolvedMicroblockGroup>;
  readonly unresolved: SchematicBlock[];
} {
  const groups = new Map<string, ResolvedMicroblockGroup>();
  const unresolved: SchematicBlock[] = [];
  for (const block of blocks) {
    const data = resolved.get(block.packedPosition);
    if (data === undefined) {
      unresolved.push(block);
      continue;
    }
    const group = groups.get(data.signature);
    if (group === undefined) {
      groups.set(data.signature, { data, blocks: [block] });
    } else {
      group.blocks.push(block);
    }
  }
  return { resolved: groups, unresolved };
}

function createPositionedInstancedMesh(
  geometry: BufferGeometry,
  material: MeshBasicMaterial | MeshBasicMaterial[],
  blocks: readonly SchematicBlock[],
  schematic: ParsedSchematic,
  matrix: Matrix4,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, blocks.length);
  mesh.instanceMatrix.setUsage(StaticDrawUsage);
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block === undefined) {
      continue;
    }
    matrix.makeTranslation(
      block.position.x - schematic.size.x / 2 + 0.5,
      block.position.y + 0.5,
      block.position.z - schematic.size.z / 2 + 0.5,
    );
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function groupBlocksByCode(
  blocks: readonly SchematicBlock[],
): Map<string, SchematicBlock[]> {
  const blocksByCode = new Map<string, SchematicBlock[]>();
  for (const block of blocks) {
    const codeBlocks = blocksByCode.get(block.code);
    if (codeBlocks === undefined) {
      blocksByCode.set(block.code, [block]);
    } else {
      codeBlocks.push(block);
    }
  }
  return blocksByCode;
}

function colorForCode(code: string, target: Color): Color {
  if (code.startsWith("game:meta-")) {
    return target.setRGB(0.73, 0.31, 0.85);
  }

  let hash = 2166136261;
  for (let index = 0; index < code.length; index += 1) {
    hash ^= code.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const hue = (hash >>> 0) / 0xffffffff;
  return target.setHSL(hue, 0.46, 0.56);
}
