import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  StaticDrawUsage,
} from "three";
import type { ParsedSchematic, SchematicBlock } from "../schematic/types";

export interface PlaceholderScene {
  readonly object: Group;
  readonly renderedBlocks: readonly SchematicBlock[];
  dispose(): void;
}

export function createPlaceholderScene(
  schematic: ParsedSchematic,
): PlaceholderScene {
  const renderedBlocks = schematic.blocks.filter(
    (block) => block.code !== "game:air",
  );
  const geometry = new BoxGeometry(0.94, 0.94, 0.94);
  const blocksByCode = new Map<string, SchematicBlock[]>();
  for (const block of renderedBlocks) {
    const codeBlocks = blocksByCode.get(block.code);
    if (codeBlocks === undefined) {
      blocksByCode.set(block.code, [block]);
    } else {
      codeBlocks.push(block);
    }
  }

  const object = new Group();
  object.name = "Schematic";
  const materials: MeshBasicMaterial[] = [];
  const matrix = new Matrix4();
  for (const [code, codeBlocks] of blocksByCode) {
    const material = new MeshBasicMaterial({
      color: colorForCode(code, new Color()),
    });
    materials.push(material);
    const mesh = new InstancedMesh(geometry, material, codeBlocks.length);
    mesh.name = "Placeholder " + code;
    mesh.userData.blockCode = code;
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
    object.add(mesh);
  }

  return {
    object,
    renderedBlocks,
    dispose(): void {
      geometry.dispose();
      for (const material of materials) {
        material.dispose();
      }
    },
  };
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
