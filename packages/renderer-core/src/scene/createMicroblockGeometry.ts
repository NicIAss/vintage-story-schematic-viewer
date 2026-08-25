import {
  BufferGeometry,
  Float32BufferAttribute,
  Vector3,
} from "three";
import type { CubeFace } from "../assets/types";

export interface DecodedMicroblockCuboid {
  readonly x1: number;
  readonly y1: number;
  readonly z1: number;
  readonly x2: number;
  readonly y2: number;
  readonly z2: number;
  readonly materialIndex: number;
}

export interface MicroblockGeometryData {
  readonly cuboids: readonly number[];
  readonly materialCodes: readonly string[];
  readonly rotationY: number;
}

export interface MicroblockMaterialFace {
  readonly materialCode: string;
  readonly face: CubeFace;
}

export interface MicroblockGeometry {
  readonly geometry: BufferGeometry;
  readonly materialFaces: readonly MicroblockMaterialFace[];
}

interface FaceBucket {
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly indices: number[];
}

const FACES = ["east", "west", "up", "down", "south", "north"] as const;
const FACE_NORMALS: Readonly<Record<CubeFace, readonly [number, number, number]>> = {
  east: [1, 0, 0],
  west: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
  south: [0, 0, 1],
  north: [0, 0, -1],
};

export function decodeMicroblockCuboid(value: number): DecodedMicroblockCuboid {
  const packed = value >>> 0;
  return {
    x1: packed & 0xf,
    y1: (packed >>> 4) & 0xf,
    z1: (packed >>> 8) & 0xf,
    x2: ((packed >>> 12) & 0xf) + 1,
    y2: ((packed >>> 16) & 0xf) + 1,
    z2: ((packed >>> 20) & 0xf) + 1,
    materialIndex: (packed >>> 24) & 0xff,
  };
}

export function createMicroblockGeometry(
  data: MicroblockGeometryData,
): MicroblockGeometry | null {
  const cuboids = data.cuboids.map(decodeMicroblockCuboid);
  const buckets = new Map<string, FaceBucket>();

  for (const cuboid of cuboids) {
    if (
      cuboid.x2 <= cuboid.x1
      || cuboid.y2 <= cuboid.y1
      || cuboid.z2 <= cuboid.z1
      || data.materialCodes[cuboid.materialIndex] === undefined
    ) {
      continue;
    }
    for (const face of FACES) {
      const key = `${cuboid.materialIndex}:${face}`;
      const bucket = getBucket(buckets, key);
      const vertexOffset = bucket.positions.length / 3;
      const vertices = cuboidFaceVertices(cuboid, face);
      const normal = new Vector3(...FACE_NORMALS[face]);
      for (const vertex of vertices) {
        // Schematic transforms already rotate these packed cuboid coordinates.
        // The separate rotation value is retained for directional materials and
        // decors; applying it to geometry here would rotate the model twice.
        vertex.subScalar(0.5);
        bucket.positions.push(vertex.x, vertex.y, vertex.z);
        bucket.normals.push(normal.x, normal.y, normal.z);
      }
      bucket.uvs.push(...cuboidFaceUvs(cuboid, face));
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
  if (buckets.size === 0) {
    return null;
  }

  const geometry = new BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const materialFaces: MicroblockMaterialFace[] = [];
  for (const [key, bucket] of buckets) {
    const [rawMaterialIndex, face] = key.split(":") as [string, CubeFace];
    const materialCode = data.materialCodes[Number(rawMaterialIndex)];
    if (materialCode === undefined) {
      continue;
    }
    const materialIndex = materialFaces.length;
    materialFaces.push({ materialCode, face });
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
  return { geometry, materialFaces };
}

function cuboidFaceVertices(
  cuboid: DecodedMicroblockCuboid,
  face: CubeFace,
): readonly Vector3[] {
  const x1 = cuboid.x1 / 16;
  const y1 = cuboid.y1 / 16;
  const z1 = cuboid.z1 / 16;
  const x2 = cuboid.x2 / 16;
  const y2 = cuboid.y2 / 16;
  const z2 = cuboid.z2 / 16;
  switch (face) {
    case "east": return [new Vector3(x2, y1, z1), new Vector3(x2, y2, z1), new Vector3(x2, y2, z2), new Vector3(x2, y1, z2)];
    case "west": return [new Vector3(x1, y1, z2), new Vector3(x1, y2, z2), new Vector3(x1, y2, z1), new Vector3(x1, y1, z1)];
    case "up": return [new Vector3(x1, y2, z1), new Vector3(x1, y2, z2), new Vector3(x2, y2, z2), new Vector3(x2, y2, z1)];
    case "down": return [new Vector3(x1, y1, z2), new Vector3(x1, y1, z1), new Vector3(x2, y1, z1), new Vector3(x2, y1, z2)];
    case "south": return [new Vector3(x2, y1, z2), new Vector3(x2, y2, z2), new Vector3(x1, y2, z2), new Vector3(x1, y1, z2)];
    case "north": return [new Vector3(x1, y1, z1), new Vector3(x1, y2, z1), new Vector3(x2, y2, z1), new Vector3(x2, y1, z1)];
  }
}

function cuboidFaceUvs(cuboid: DecodedMicroblockCuboid, face: CubeFace): number[] {
  const x1 = cuboid.x1 / 16;
  const y1 = cuboid.y1 / 16;
  const z1 = cuboid.z1 / 16;
  const x2 = cuboid.x2 / 16;
  const y2 = cuboid.y2 / 16;
  const z2 = cuboid.z2 / 16;
  let u1: number;
  let v1: number;
  let u2: number;
  let v2: number;
  if (face === "east" || face === "west") {
    u1 = z1; u2 = z2; v1 = y1; v2 = y2;
  } else if (face === "up" || face === "down") {
    u1 = x1; u2 = x2; v1 = z1; v2 = z2;
  } else {
    u1 = x1; u2 = x2; v1 = y1; v2 = y2;
  }
  return [u1, v1, u1, v2, u2, v2, u2, v1];
}

function getBucket(buckets: Map<string, FaceBucket>, key: string): FaceBucket {
  const existing = buckets.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const bucket: FaceBucket = { positions: [], normals: [], uvs: [], indices: [] };
  buckets.set(key, bucket);
  return bucket;
}
