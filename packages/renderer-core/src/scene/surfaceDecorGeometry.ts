import {
  BufferGeometry,
  Float32BufferAttribute,
  Vector2,
  Vector3,
} from "three";

const FACE_NORMALS: readonly (readonly [number, number, number])[] = [
  [0, 0, -1],
  [1, 0, 0],
  [0, 0, 1],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
];

const MIN_FACE_ALIGNMENT = 0.35;
const DECAL_SURFACE_OFFSET = 0.0015;

/**
 * Builds the surface portion of a Vintage Story decal from the host block's
 * actual model. The game retessellates the host model with the decor texture;
 * filtering that mesh by the saved attachment face gives partial blocks and
 * block-entity models the same outline instead of a floating one-block plane.
 */
export function createSurfaceDecorGeometry(
  source: BufferGeometry,
  faceIndex: number,
  textureRotationRadians = 0,
): BufferGeometry | null {
  const position = source.getAttribute("position");
  if (position === undefined || position.itemSize < 3) return null;

  const sourceUv = source.getAttribute("uv");
  const index = source.getIndex();
  const targetTuple = FACE_NORMALS[faceIndex];
  if (targetTuple === undefined) return null;
  const targetNormal = new Vector3(...targetTuple);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const edgeA = new Vector3();
  const edgeB = new Vector3();
  const triangleNormal = new Vector3();
  const uv = new Vector2();
  const triangleCount = Math.floor((index?.count ?? position.count) / 3);

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const sourceIndices = [0, 1, 2].map((corner) => {
      const offset = triangle * 3 + corner;
      return index === null ? offset : index.getX(offset);
    });
    a.fromBufferAttribute(position, sourceIndices[0] ?? 0);
    b.fromBufferAttribute(position, sourceIndices[1] ?? 0);
    c.fromBufferAttribute(position, sourceIndices[2] ?? 0);
    edgeA.subVectors(b, a);
    edgeB.subVectors(c, a);
    triangleNormal.crossVectors(edgeA, edgeB);
    if (triangleNormal.lengthSq() < 1e-12) continue;
    triangleNormal.normalize();
    if (triangleNormal.dot(targetNormal) < MIN_FACE_ALIGNMENT) continue;

    for (let corner = 0; corner < 3; corner += 1) {
      const sourceIndex = sourceIndices[corner] ?? 0;
      const vertex = corner === 0 ? a : corner === 1 ? b : c;
      positions.push(
        vertex.x + triangleNormal.x * DECAL_SURFACE_OFFSET,
        vertex.y + triangleNormal.y * DECAL_SURFACE_OFFSET,
        vertex.z + triangleNormal.z * DECAL_SURFACE_OFFSET,
      );
      normals.push(triangleNormal.x, triangleNormal.y, triangleNormal.z);
      if (sourceUv !== undefined && sourceUv.itemSize >= 2) {
        uv.set(sourceUv.getX(sourceIndex), sourceUv.getY(sourceIndex));
      } else {
        projectedUv(vertex, faceIndex, uv);
      }
      rotateUv(uv, textureRotationRadians);
      uvs.push(uv.x, uv.y);
    }
  }

  if (positions.length === 0) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function rotateUv(uv: Vector2, radians: number): void {
  if (radians === 0) return;
  const x = uv.x - 0.5;
  const y = uv.y - 0.5;
  const cosine = Math.cos(-radians);
  const sine = Math.sin(-radians);
  uv.set(
    0.5 + x * cosine - y * sine,
    0.5 + x * sine + y * cosine,
  );
}

function projectedUv(vertex: Vector3, faceIndex: number, target: Vector2): void {
  switch (faceIndex) {
    case 0: target.set(vertex.x + 0.5, vertex.y + 0.5); break;
    case 1: target.set(0.5 - vertex.z, vertex.y + 0.5); break;
    case 2: target.set(0.5 - vertex.x, vertex.y + 0.5); break;
    case 3: target.set(vertex.z + 0.5, vertex.y + 0.5); break;
    case 4: target.set(vertex.x + 0.5, 0.5 - vertex.z); break;
    case 5: target.set(vertex.x + 0.5, vertex.z + 0.5); break;
    default: target.set(0.5, 0.5);
  }
}
