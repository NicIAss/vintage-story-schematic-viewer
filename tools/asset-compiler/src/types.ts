export interface RegistryTexture {
  readonly base: string;
  readonly assetPath: string | null;
  readonly url: string | null;
  readonly alternativeCount: number;
}

export type CubeFace = "east" | "west" | "up" | "down" | "south" | "north";

export interface RegistryFaceTexture {
  readonly base: RegistryTexture;
  readonly overlays: readonly RegistryTexture[];
  readonly rotation: number;
}

export type RegistryCubeTextures = Readonly<Record<CubeFace, RegistryFaceTexture>>;

export interface CompiledShapeFace {
  readonly texture: string;
  readonly uv: readonly [number, number, number, number];
  readonly rotation: number;
  readonly enabled: boolean;
}

export interface CompiledShapeElement {
  readonly name: string | null;
  readonly renderPass?: number | null;
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
  readonly rotationOrigin: readonly [number, number, number];
  readonly rotationX: number;
  readonly rotationY: number;
  readonly rotationZ: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly scaleZ: number;
  readonly climateColorMap: string | null;
  readonly seasonColorMap: string | null;
  readonly faces: Readonly<Partial<Record<CubeFace, CompiledShapeFace>>>;
  readonly children: readonly CompiledShapeElement[];
}

export interface CompiledShape {
  readonly key: string;
  readonly sourceFile: string;
  readonly textureWidth: number;
  readonly textureHeight: number;
  readonly textureSizes?: Readonly<Record<string, readonly [number, number]>>;
  readonly elements: readonly CompiledShapeElement[];
}

export interface CompiledShapeReference {
  readonly key: string;
  readonly rotateX: number;
  readonly rotateY: number;
  readonly rotateZ: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly offsetZ: number;
  readonly scale: number;
  readonly textures: Readonly<Record<string, RegistryFaceTexture>>;
}

export interface CompiledColorMapReference {
  readonly code: string;
  readonly texture: RegistryTexture;
}

export interface CompiledEntityShapeSet {
  readonly attributeKeys: readonly string[];
  readonly defaultValues: readonly string[];
  readonly variants: Readonly<Record<string, CompiledShapeReference>>;
}

export interface CompiledModelTransform {
  readonly translation: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly origin: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
}

export type GroundStorageLayout =
  | "SingleCenter"
  | "Halves"
  | "WallHalves"
  | "Quadrants"
  | "Stacking"
  | "Messy12";

export interface CompiledGroundStorageProperties {
  readonly layout: GroundStorageLayout;
  readonly modelTransform: CompiledModelTransform | null;
  readonly stackingReference: CompiledShapeReference | null;
  readonly itemsPerModel: number;
  readonly cuboidsPerModel: number;
}

export interface CompiledDecorProperties {
  readonly surfaceTexture: RegistryFaceTexture | null;
  readonly randomizeRotations: boolean;
  readonly sidedVariants: boolean;
  readonly textureTile: readonly [number, number, number, number] | null;
}

export interface CompiledPileProperties {
  readonly textures: Readonly<Record<string, RegistryFaceTexture>>;
}

export interface CompiledFruitTreeType {
  readonly textures: Readonly<Record<string, RegistryFaceTexture>>;
  readonly climateColorMap: string;
  readonly seasonColorMap: string | null;
  readonly evergreen: boolean;
  readonly ripeFruitShapeName: string | null;
}

export interface CompiledFruitTreeResources {
  readonly shapes: Readonly<Record<string, CompiledShapeReference>>;
  readonly types: Readonly<Record<string, CompiledFruitTreeType>>;
  readonly deadTreeTexture: RegistryFaceTexture | null;
}

export interface CompiledBlockDefinition {
  readonly code: string;
  readonly sourceFile: string;
  readonly className: string | null;
  readonly drawType: string | null;
  readonly renderPass: string | null;
  readonly shapeBase: string | null;
  readonly isMeta: boolean;
  readonly ignoreTintInventory: boolean;
  readonly variant: Readonly<Record<string, string>>;
  readonly cubeTextures: RegistryCubeTextures | null;
  readonly shape: CompiledShapeReference | null;
  readonly supportBeamShapes: readonly CompiledShapeReference[] | null;
  readonly entityShapes: CompiledEntityShapeSet | null;
  readonly climateColorMap: CompiledColorMapReference | null;
  readonly seasonColorMap: CompiledColorMapReference | null;
  readonly groundStorage: CompiledGroundStorageProperties | null;
  readonly decor: CompiledDecorProperties | null;
  readonly pile: CompiledPileProperties | null;
  readonly warnings: readonly string[];
}

export interface CompiledItemDefinition {
  readonly code: string;
  readonly sourceFile: string;
  readonly className: string | null;
  readonly variant: Readonly<Record<string, string>>;
  readonly shape: CompiledShapeReference | null;
  readonly groundStorage: CompiledGroundStorageProperties | null;
  readonly warnings: readonly string[];
}

export interface AssetRegistryStats {
  readonly assetFileCount: number;
  readonly blockTypeFileCount: number;
  readonly itemTypeFileCount: number;
  readonly worldPropertyFileCount: number;
  readonly patchFileCount: number;
  readonly textureFileCount: number;
  readonly shapeFileCount: number;
  readonly compiledShapeCount: number;
  readonly resolvedBlockCodeCount: number;
  readonly resolvedItemCodeCount: number;
  readonly legacyBlockAliasCount: number;
  readonly legacyItemAliasCount: number;
  readonly texturedCubeCodeCount: number;
  readonly unresolvedTextureCodeCount: number;
  readonly parseErrorCount: number;
}

export interface AssetRegistry {
  readonly formatVersion: 2;
  readonly generatedAt: string;
  readonly compatibility: {
    readonly gameVersion: "1.22.5";
    readonly essentialsCommit: "0cd7da3";
    readonly variantRules: "RegistryObjectTypeLoader + RegistryObjectType.solveByType";
  };
  readonly assetRoot: string;
  readonly loadOrder: readonly ["game", "survival", "creative"];
  readonly stats: AssetRegistryStats;
  readonly diagnostics: readonly string[];
  readonly blocks: Readonly<Record<string, CompiledBlockDefinition>>;
  readonly items: Readonly<Record<string, CompiledItemDefinition>>;
  readonly colorMaps: Readonly<Record<string, RegistryTexture>>;
  readonly shapes: Readonly<Record<string, CompiledShape>>;
  readonly fruitTrees?: CompiledFruitTreeResources | null;
}
