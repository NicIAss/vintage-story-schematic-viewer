export interface SchematicSize {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SchematicPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SchematicBlock {
  readonly ordinal: number;
  readonly packedPosition: number;
  readonly position: SchematicPosition;
  readonly schematicBlockId: number;
  readonly code: string;
}

export interface SchematicBlockEntity {
  readonly packedPosition: number;
  readonly position: SchematicPosition;
  readonly encodedData: string;
  readonly attributes: TreeAttribute | null;
  readonly decodeError: string | null;
}

export interface SchematicDecor {
  readonly ordinal: number;
  readonly packedPosition: number;
  readonly position: SchematicPosition;
  readonly packedDecorId: number;
  readonly schematicBlockId: number;
  readonly code: string;
  readonly faceIndex: number;
  readonly subPosition: number;
  readonly rotation: number;
}

export interface SchematicDiagnostics {
  readonly blockCount: number;
  readonly visibleBlockCount: number;
  readonly mappedBlockCodeCount: number;
  readonly referencedBlockCodeCount: number;
  readonly mappedItemCodeCount: number;
  readonly decorCount: number;
  readonly blockEntityCount: number;
  readonly entityCount: number;
  readonly repeatedPositionCount: number;
}

export interface ParsedSchematic {
  readonly gameVersion: string | null;
  readonly size: SchematicSize;
  readonly blockCodes: ReadonlyMap<number, string>;
  readonly itemCodes: ReadonlyMap<number, string>;
  readonly blocks: readonly SchematicBlock[];
  readonly blockEntities: readonly SchematicBlockEntity[];
  readonly decors: readonly SchematicDecor[];
  readonly entities: readonly string[];
  readonly diagnostics: SchematicDiagnostics;
  readonly warnings: readonly string[];
}
import type { TreeAttribute } from "./treeAttribute";
