export { normalizeAssetLocation } from "./schematic/assetLocation";
export {
  parseSchematic,
  parseSchematicJson,
  SchematicValidationError,
  unpackSchematicPosition,
} from "./schematic/parser";
export type {
  AssetRegistry,
  AssetRegistryStats,
  CompiledBlockDefinition,
  CompiledEntityShapeSet,
  CompiledShape,
  CompiledShapeElement,
  CompiledShapeFace,
  CompiledShapeReference,
  CubeFace,
  RegistryCubeTextures,
  RegistryFaceTexture,
  RegistryTexture,
} from "./assets/types";
export type {
  ParsedSchematic,
  SchematicBlock,
  SchematicBlockEntity,
  SchematicDecor,
  SchematicDiagnostics,
  SchematicPosition,
  SchematicSize,
} from "./schematic/types";
export {
  decodeAscii85,
  decodeTreeAttribute,
  decodeTreeAttributeString,
  getIntArrayAttribute,
  getIntAttribute,
  getNumberAttribute,
  getStringAttribute,
} from "./schematic/treeAttribute";
export type {
  DecodedItemStack,
  TreeAttribute,
  TreeAttributeType,
  TreeAttributeValue,
} from "./schematic/treeAttribute";
export {
  createPlaceholderScene,
  type PlaceholderScene,
} from "./scene/createPlaceholderScene";
export {
  createSchematicScene,
  type PlaceholderBreakdownEntry,
  type SchematicScene,
  type SchematicSceneStats,
} from "./scene/createSchematicScene";
