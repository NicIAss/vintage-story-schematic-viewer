import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
} from "three";

export const SCHEMATIC_CHUNK_SIZE = 32;

interface GeometryBatch {
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly indices: number[];
}

export interface ChunkPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ChunkedGeometryFlushOptions {
  readonly name: string;
  readonly renderMode: string;
  readonly renderOrder?: number;
  readonly onGeometry: (geometry: BufferGeometry) => void;
}

/**
 * Collects geometry into one mesh per material and spatial chunk. This keeps
 * draw calls low while giving Three.js useful bounds for frustum culling.
 */
export class ChunkedGeometryBatcher {
  readonly #chunks = new Map<string, Map<MeshBasicMaterial, GeometryBatch>>();

  appendGeometryGroup(
    geometry: BufferGeometry,
    groupIndex: number,
    material: MeshBasicMaterial,
    chunkPosition: ChunkPosition,
    translation: ChunkPosition,
  ): void {
    const group = geometry.groups[groupIndex];
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const uv = geometry.getAttribute("uv");
    const sourceIndex = geometry.getIndex();
    if (group === undefined || position === undefined || normal === undefined || uv === undefined) {
      return;
    }

    const chunkKey = chunkKeyForPosition(chunkPosition);
    let materialBatches = this.#chunks.get(chunkKey);
    if (materialBatches === undefined) {
      materialBatches = new Map();
      this.#chunks.set(chunkKey, materialBatches);
    }
    let batch = materialBatches.get(material);
    if (batch === undefined) {
      batch = { positions: [], normals: [], uvs: [], indices: [] };
      materialBatches.set(material, batch);
    }

    const remappedVertices = new Map<number, number>();
    const end = group.start + group.count;
    for (let offset = group.start; offset < end; offset += 1) {
      const sourceVertex = sourceIndex === null
        ? offset
        : sourceIndex.getX(offset);
      let targetVertex = remappedVertices.get(sourceVertex);
      if (targetVertex === undefined) {
        targetVertex = batch.positions.length / 3;
        remappedVertices.set(sourceVertex, targetVertex);
        batch.positions.push(
          position.getX(sourceVertex) + translation.x,
          position.getY(sourceVertex) + translation.y,
          position.getZ(sourceVertex) + translation.z,
        );
        batch.normals.push(
          normal.getX(sourceVertex),
          normal.getY(sourceVertex),
          normal.getZ(sourceVertex),
        );
        batch.uvs.push(uv.getX(sourceVertex), uv.getY(sourceVertex));
      }
      batch.indices.push(targetVertex);
    }
  }

  flush(parent: Group, options: ChunkedGeometryFlushOptions): number {
    let meshCount = 0;
    for (const [chunkKey, materialBatches] of this.#chunks) {
      for (const [material, batch] of materialBatches) {
        if (batch.indices.length === 0) continue;
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new Float32BufferAttribute(batch.positions, 3));
        geometry.setAttribute("normal", new Float32BufferAttribute(batch.normals, 3));
        geometry.setAttribute("uv", new Float32BufferAttribute(batch.uvs, 2));
        geometry.setIndex(batch.indices);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        options.onGeometry(geometry);

        const mesh = new Mesh(geometry, material);
        mesh.name = `${options.name} ${chunkKey}`;
        mesh.userData.renderMode = options.renderMode;
        mesh.userData.chunkKey = chunkKey;
        mesh.renderOrder = options.renderOrder ?? 0;
        parent.add(mesh);
        meshCount += 1;
      }
    }
    this.#chunks.clear();
    return meshCount;
  }
}

export function chunkKeyForPosition(
  position: ChunkPosition,
  chunkSize = SCHEMATIC_CHUNK_SIZE,
): string {
  return `${Math.floor(position.x / chunkSize)},${Math.floor(position.y / chunkSize)},${Math.floor(position.z / chunkSize)}`;
}
