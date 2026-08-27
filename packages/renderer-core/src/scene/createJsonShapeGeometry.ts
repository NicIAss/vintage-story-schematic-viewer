import {
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  Matrix3,
  Matrix4,
  Vector3,
} from "three";
import type {
  CompiledShape,
  CompiledShapeElement,
  CompiledModelTransform,
  CompiledShapeReference,
  CubeFace,
} from "../assets/types";

export interface JsonShapeGeometry {
  readonly geometry: BufferGeometry;
  readonly materialAliases: readonly string[];
  readonly materialColorMaps: readonly ShapeMaterialColorMaps[];
  readonly materialTransparencies: readonly boolean[];
}

export interface ShapeMaterialColorMaps {
  readonly climate: string | null;
  readonly season: string | null;
}

interface FaceBucket {
  readonly textureAlias: string;
  readonly colorMaps: ShapeMaterialColorMaps;
  readonly transparent: boolean;
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly indices: number[];
}

const FACE_NORMALS: Readonly<Record<CubeFace, readonly [number, number, number]>> = {
  east: [1, 0, 0],
  west: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
  south: [0, 0, 1],
  north: [0, 0, -1],
};

export function createJsonShapeGeometry(
  shape: CompiledShape,
  reference: CompiledShapeReference,
  modelTransform: CompiledModelTransform | null = null,
  elementLimit: number | null = null,
  selectedElementNames: readonly string[] | null = null,
): JsonShapeGeometry | null {
  const buckets = new Map<string, FaceBucket>();
  const compositeMatrix = createCompositeMatrix(reference, modelTransform);
  const elements = elementLimit === null
    ? shape.elements
    : shape.elements.slice(0, Math.max(0, Math.floor(elementLimit)));
  const selectedNames = selectedElementNames === null
    ? null
    : new Set(selectedElementNames.map((name) => name.toLowerCase()));
  for (const element of elements) {
    appendElement(
      element,
      new Matrix4(),
      compositeMatrix,
      shape,
      buckets,
      null,
      null,
      null,
      selectedNames,
      false,
    );
  }
  if (buckets.size === 0) {
    return null;
  }

  const geometry = new BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const materialBuckets = [...buckets.values()];
  const materialAliases = materialBuckets.map((bucket) => bucket.textureAlias);
  const materialColorMaps = materialBuckets.map((bucket) => bucket.colorMaps);
  const materialTransparencies = materialBuckets.map((bucket) => bucket.transparent);
  for (let materialIndex = 0; materialIndex < materialBuckets.length; materialIndex += 1) {
    const bucket = materialBuckets[materialIndex];
    if (bucket === undefined) {
      continue;
    }
    const vertexOffset = positions.length / 3;
    const groupStart = indices.length;
    positions.push(...bucket.positions);
    normals.push(...bucket.normals);
    uvs.push(...bucket.uvs);
    indices.push(...bucket.indices.map((index) => index + vertexOffset));
    geometry.addGroup(groupStart, bucket.indices.length, materialIndex);
  }
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, materialAliases, materialColorMaps, materialTransparencies };
}

function appendElement(
  element: CompiledShapeElement,
  parentMatrix: Matrix4,
  compositeMatrix: Matrix4,
  shape: CompiledShape,
  buckets: Map<string, FaceBucket>,
  inheritedClimateColorMap: string | null,
  inheritedSeasonColorMap: string | null,
  inheritedRenderPass: number | null,
  selectedNames: ReadonlySet<string> | null,
  selectedAncestor: boolean,
): void {
  const elementMatrix = parentMatrix.clone().multiply(createElementMatrix(element));
  const finalMatrix = compositeMatrix.clone().multiply(elementMatrix);
  const normalMatrix = new Matrix3().getNormalMatrix(finalMatrix);
  const size = new Vector3(
    (element.to[0] - element.from[0]) / 16,
    (element.to[1] - element.from[1]) / 16,
    (element.to[2] - element.from[2]) / 16,
  );
  const climateColorMap = element.climateColorMap ?? inheritedClimateColorMap;
  const seasonColorMap = element.seasonColorMap ?? inheritedSeasonColorMap;
  const renderPass = element.renderPass ?? inheritedRenderPass;
  const transparent = renderPass === 2 || renderPass === 3 || renderPass === 4;
  const selected = selectedNames === null
    || selectedAncestor
    || (element.name !== null && selectedNames.has(element.name.toLowerCase()));
  if (selected) {
    for (const [faceName, face] of Object.entries(element.faces)) {
      const cubeFace = faceName as CubeFace;
      if (face === undefined || !face.enabled) {
        continue;
      }
      const bucket = getBucket(
        buckets,
        face.texture,
        climateColorMap,
        seasonColorMap,
        transparent,
      );
      const vertexOffset = bucket.positions.length / 3;
      const vertices = faceVertices(cubeFace, size);
      const normal = new Vector3(...FACE_NORMALS[cubeFace]).applyNormalMatrix(normalMatrix).normalize();
      for (const vertex of vertices) {
        vertex.applyMatrix4(finalMatrix);
        bucket.positions.push(vertex.x, vertex.y, vertex.z);
        bucket.normals.push(normal.x, normal.y, normal.z);
      }
      const textureSize = shape.textureSizes?.[face.texture.toLowerCase()]
        ?? [shape.textureWidth, shape.textureHeight];
      bucket.uvs.push(...faceUvs(face.uv, face.rotation, textureSize[0], textureSize[1]));
      bucket.indices.push(
        vertexOffset,
        vertexOffset + 1,
        vertexOffset + 2,
        vertexOffset,
        vertexOffset + 2,
        vertexOffset + 3,
      );
    }
  }
  for (const child of element.children) {
    appendElement(
      child,
      elementMatrix,
      compositeMatrix,
      shape,
      buckets,
      climateColorMap,
      seasonColorMap,
      renderPass,
      selectedNames,
      selected,
    );
  }
}

function createElementMatrix(element: CompiledShapeElement): Matrix4 {
  const origin = new Vector3(
    element.rotationOrigin[0] / 16,
    element.rotationOrigin[1] / 16,
    element.rotationOrigin[2] / 16,
  );
  const from = new Vector3(element.from[0] / 16, element.from[1] / 16, element.from[2] / 16);
  return new Matrix4()
    .makeTranslation(origin.x, origin.y, origin.z)
    .multiply(rotationMatrix(element.rotationX, element.rotationY, element.rotationZ))
    .multiply(new Matrix4().makeScale(element.scaleX, element.scaleY, element.scaleZ))
    .multiply(new Matrix4().makeTranslation(from.x - origin.x, from.y - origin.y, from.z - origin.z));
}

function createCompositeMatrix(
  reference: CompiledShapeReference,
  modelTransform: CompiledModelTransform | null,
): Matrix4 {
  const shapeMatrix = new Matrix4()
    .makeTranslation(reference.offsetX, reference.offsetY, reference.offsetZ)
    .multiply(rotationMatrix(reference.rotateX, reference.rotateY, reference.rotateZ))
    .multiply(new Matrix4().makeScale(reference.scale, reference.scale, reference.scale))
    .multiply(new Matrix4().makeTranslation(-0.5, -0.5, -0.5));
  if (modelTransform === null) {
    return shapeMatrix;
  }
  const [translationX, translationY, translationZ] = modelTransform.translation;
  const [originX, originY, originZ] = modelTransform.origin;
  const [scaleX, scaleY, scaleZ] = modelTransform.scale;
  const [rotationX, rotationY, rotationZ] = modelTransform.rotation;
  const centeredModelMatrix = new Matrix4()
    .makeTranslation(-0.5, -0.5, -0.5)
    .multiply(new Matrix4().makeTranslation(
      translationX + originX,
      translationY + originY,
      translationZ + originZ,
    ))
    .multiply(rotationMatrix(rotationX, rotationY, rotationZ))
    .multiply(new Matrix4().makeScale(scaleX, scaleY, scaleZ))
    .multiply(new Matrix4().makeTranslation(-originX, -originY, -originZ))
    .multiply(new Matrix4().makeTranslation(0.5, 0.5, 0.5));
  return centeredModelMatrix.multiply(shapeMatrix);
}

function rotationMatrix(x: number, y: number, z: number): Matrix4 {
  return new Matrix4().makeRotationFromEuler(
    new Euler(degrees(x), degrees(y), degrees(z), "XYZ"),
  );
}

function degrees(value: number): number {
  return (value * Math.PI) / 180;
}

function faceVertices(face: CubeFace, size: Vector3): readonly Vector3[] {
  const { x, y, z } = size;
  switch (face) {
    case "east": return [new Vector3(x, 0, z), new Vector3(x, y, z), new Vector3(x, y, 0), new Vector3(x, 0, 0)];
    case "west": return [new Vector3(0, 0, 0), new Vector3(0, y, 0), new Vector3(0, y, z), new Vector3(0, 0, z)];
    case "up": return [new Vector3(0, y, 0), new Vector3(0, y, z), new Vector3(x, y, z), new Vector3(x, y, 0)];
    case "down": return [new Vector3(0, 0, z), new Vector3(0, 0, 0), new Vector3(x, 0, 0), new Vector3(x, 0, z)];
    case "south": return [new Vector3(x, 0, z), new Vector3(x, y, z), new Vector3(0, y, z), new Vector3(0, 0, z)];
    case "north": return [new Vector3(0, 0, 0), new Vector3(0, y, 0), new Vector3(x, y, 0), new Vector3(x, 0, 0)];
  }
}

function faceUvs(
  uv: readonly [number, number, number, number],
  rotation: number,
  textureWidth: number,
  textureHeight: number,
): number[] {
  const [u1, v1, u2, v2] = uv;
  const corners = [
    [u1 / textureWidth, 1 - v2 / textureHeight],
    [u1 / textureWidth, 1 - v1 / textureHeight],
    [u2 / textureWidth, 1 - v1 / textureHeight],
    [u2 / textureWidth, 1 - v2 / textureHeight],
  ] as const;
  const steps = Math.round((((rotation % 360) + 360) % 360) / 90) % 4;
  const result: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const corner = corners[(index + steps) % 4];
    if (corner !== undefined) {
      result.push(corner[0], corner[1]);
    }
  }
  return result;
}

function getBucket(
  buckets: Map<string, FaceBucket>,
  alias: string,
  climateColorMap: string | null,
  seasonColorMap: string | null,
  transparent: boolean,
): FaceBucket {
  const key = `${alias}\u001f${climateColorMap ?? ""}\u001f${seasonColorMap ?? ""}\u001f${transparent ? "transparent" : "opaque"}`;
  const existing = buckets.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const bucket: FaceBucket = {
    textureAlias: alias,
    colorMaps: { climate: climateColorMap, season: seasonColorMap },
    transparent,
    positions: [],
    normals: [],
    uvs: [],
    indices: [],
  };
  buckets.set(key, bucket);
  return bucket;
}
