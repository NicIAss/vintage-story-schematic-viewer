import type {
  CompiledBlockDefinition,
  CubeFace,
  RegistryFaceTexture,
} from "../assets/types";

const FACE_TEXTURE_KEYS: Readonly<Record<CubeFace, readonly string[]>> = {
  east: ["east", "horizontals", "sides", "all"],
  west: ["west", "horizontals", "sides", "all"],
  up: ["up", "verticals", "all"],
  down: ["down", "verticals", "all"],
  south: ["south", "horizontals", "sides", "all"],
  north: ["north", "horizontals", "sides", "all"],
};

export function resolveMicroblockFaceTexture(
  definition: CompiledBlockDefinition,
  face: CubeFace,
): RegistryFaceTexture | undefined {
  const cubeTexture = definition.cubeTextures?.[face];
  if (cubeTexture !== undefined) {
    return cubeTexture;
  }

  const shapeTextures = definition.shape?.textures;
  if (shapeTextures !== null && shapeTextures !== undefined) {
    for (const key of FACE_TEXTURE_KEYS[face]) {
      const texture = shapeTextures[key];
      if (texture !== undefined) {
        return texture;
      }
    }

    // VoxelMaterial.FromBlock uses the block's first texture when a facing alias
    // is absent. Shape references are the closest compiled equivalent.
    const firstShapeTexture = Object.values(shapeTextures)[0];
    if (firstShapeTexture !== undefined) {
      return firstShapeTexture;
    }
  }

  // Dynamic piles still expose their block texture table to the game's voxel
  // material source, even though their placed geometry is inventory-selected.
  return Object.values(definition.pile?.textures ?? {})[0];
}
