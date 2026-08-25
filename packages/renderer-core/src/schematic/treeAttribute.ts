export type TreeAttributeType =
  | "int"
  | "long"
  | "double"
  | "float"
  | "string"
  | "tree"
  | "itemstack"
  | "bytes"
  | "bool"
  | "strings"
  | "ints"
  | "floats"
  | "doubles"
  | "trees"
  | "longs"
  | "bools";

export interface DecodedItemStack {
  readonly itemClass: number;
  readonly id: number;
  readonly stackSize: number;
  readonly attributes: TreeAttribute;
}

export type TreeAttributeValue =
  | { readonly type: "int"; readonly value: number }
  | { readonly type: "long"; readonly value: bigint }
  | { readonly type: "double"; readonly value: number }
  | { readonly type: "float"; readonly value: number }
  | { readonly type: "string"; readonly value: string }
  | { readonly type: "tree"; readonly value: TreeAttribute }
  | { readonly type: "itemstack"; readonly value: DecodedItemStack | null }
  | { readonly type: "bytes"; readonly value: Uint8Array }
  | { readonly type: "bool"; readonly value: boolean }
  | { readonly type: "strings"; readonly value: readonly string[] }
  | { readonly type: "ints"; readonly value: readonly number[] }
  | { readonly type: "floats"; readonly value: readonly number[] }
  | { readonly type: "doubles"; readonly value: readonly number[] }
  | { readonly type: "trees"; readonly value: readonly TreeAttribute[] }
  | { readonly type: "longs"; readonly value: readonly bigint[] }
  | { readonly type: "bools"; readonly value: readonly boolean[] };

export type TreeAttribute = Readonly<Record<string, TreeAttributeValue>>;

const MAX_TREE_DEPTH = 30;
const MAX_ARRAY_LENGTH = 10_000_000;

export function decodeTreeAttributeString(encoded: string): TreeAttribute {
  return decodeTreeAttribute(decodeAscii85(encoded));
}

export function decodeTreeAttribute(bytes: Uint8Array): TreeAttribute {
  const reader = new DotNetBinaryReader(bytes);
  const tree = readTree(reader, 0);
  if (reader.remaining !== 0) {
    throw new Error(`TreeAttribute has ${reader.remaining} trailing byte(s).`);
  }
  return tree;
}

export function decodeAscii85(encoded: string): Uint8Array {
  const output: number[] = [];
  let count = 0;
  let value = 0;
  const powers = [52_200_625, 614_125, 7_225, 85, 1] as const;
  for (const character of encoded) {
    if (character === "z" && count === 0) {
      output.push(0, 0, 0, 0);
      continue;
    }
    const code = character.charCodeAt(0);
    if (code < 33 || code > 117) {
      throw new Error(`Invalid character ${JSON.stringify(character)} in Ascii85 block.`);
    }
    value += (code - 33) * (powers[count] ?? 0);
    if (value > 0xffffffff) {
      throw new Error("Ascii85 group decodes beyond UInt32.MaxValue.");
    }
    count += 1;
    if (count === 5) {
      writeDecodedValue(output, value, 0);
      count = 0;
      value = 0;
    }
  }
  if (count === 1) {
    throw new Error("The final Ascii85 block must contain more than one character.");
  }
  if (count > 1) {
    for (let padding = count; padding < 5; padding += 1) {
      value += 84 * (powers[padding] ?? 0);
      if (value > 0xffffffff) {
        throw new Error("Ascii85 group decodes beyond UInt32.MaxValue.");
      }
    }
    writeDecodedValue(output, value, 5 - count);
  }
  return Uint8Array.from(output);
}

export function getIntArrayAttribute(
  tree: TreeAttribute,
  key: string,
): readonly number[] | null {
  const attribute = tree[key];
  if (attribute?.type === "ints") {
    return attribute.value;
  }
  if (attribute?.type === "longs") {
    return attribute.value.map((value) => Number(BigInt.asUintN(32, value)));
  }
  return null;
}

export function getIntAttribute(
  tree: TreeAttribute,
  key: string,
  fallback = 0,
): number {
  const attribute = tree[key];
  return attribute?.type === "int" ? attribute.value : fallback;
}

export function getStringAttribute(
  tree: TreeAttribute,
  key: string,
  fallback = "",
): string {
  const attribute = tree[key];
  return attribute?.type === "string" ? attribute.value : fallback;
}

export function getNumberAttribute(
  tree: TreeAttribute,
  key: string,
  fallback = 0,
): number {
  const attribute = tree[key];
  if (
    attribute?.type === "int"
    || attribute?.type === "float"
    || attribute?.type === "double"
  ) {
    return attribute.value;
  }
  return fallback;
}

function writeDecodedValue(output: number[], value: number, paddingBytes: number): void {
  output.push(Math.floor(value / 0x1000000) & 0xff);
  if (paddingBytes === 3) return;
  output.push(Math.floor(value / 0x10000) & 0xff);
  if (paddingBytes === 2) return;
  output.push(Math.floor(value / 0x100) & 0xff);
  if (paddingBytes === 1) return;
  output.push(value & 0xff);
}

function readTree(reader: DotNetBinaryReader, depth: number): TreeAttribute {
  if (depth > MAX_TREE_DEPTH) {
    throw new Error(`TreeAttribute exceeds the ${MAX_TREE_DEPTH}-level depth limit.`);
  }
  const attributes: Record<string, TreeAttributeValue> = {};
  while (true) {
    const attributeId = reader.readByte();
    if (attributeId === 0) {
      return attributes;
    }
    const key = reader.readString();
    attributes[key] = readAttribute(reader, attributeId, depth);
  }
}

function readAttribute(
  reader: DotNetBinaryReader,
  attributeId: number,
  depth: number,
): TreeAttributeValue {
  switch (attributeId) {
    case 1: return { type: "int", value: reader.readInt32() };
    case 2: return { type: "long", value: reader.readInt64() };
    case 3: return { type: "double", value: reader.readFloat64() };
    case 4: return { type: "float", value: reader.readFloat32() };
    case 5: return { type: "string", value: reader.readString() };
    case 6: return { type: "tree", value: readTree(reader, depth + 1) };
    case 7: return { type: "itemstack", value: readItemStack(reader, depth + 1) };
    case 8: return { type: "bytes", value: reader.readBytes(reader.readInt16()) };
    case 9: return { type: "bool", value: reader.readBoolean() };
    case 10: return { type: "strings", value: readArray(reader, () => reader.readString()) };
    case 11: return { type: "ints", value: readArray(reader, () => reader.readInt32()) };
    case 12: return { type: "floats", value: readArray(reader, () => reader.readFloat32()) };
    case 13: return { type: "doubles", value: readArray(reader, () => reader.readFloat64()) };
    case 14: return { type: "trees", value: readArray(reader, () => readTree(reader, depth + 1)) };
    case 15: return { type: "longs", value: readArray(reader, () => reader.readInt64()) };
    case 16: return { type: "bools", value: readArray(reader, () => reader.readBoolean()) };
    default: throw new Error(`Unknown TreeAttribute type id ${attributeId}.`);
  }
}

function readItemStack(reader: DotNetBinaryReader, depth: number): DecodedItemStack | null {
  if (reader.readBoolean()) {
    return null;
  }
  return {
    itemClass: reader.readInt32(),
    id: reader.readInt32(),
    stackSize: reader.readInt32(),
    attributes: readTree(reader, depth),
  };
}

function readArray<T>(reader: DotNetBinaryReader, readValue: () => T): T[] {
  const length = reader.readInt32();
  if (length < 0 || length > MAX_ARRAY_LENGTH) {
    throw new Error(`Invalid TreeAttribute array length ${length}.`);
  }
  return Array.from({ length }, readValue);
}

class DotNetBinaryReader {
  private readonly view: DataView;
  private offset = 0;
  private readonly textDecoder = new TextDecoder("utf-8", { fatal: true });

  public constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  public get remaining(): number {
    return this.bytes.byteLength - this.offset;
  }

  public readByte(): number {
    this.require(1);
    return this.bytes[this.offset++] ?? 0;
  }

  public readBoolean(): boolean {
    return this.readByte() !== 0;
  }

  public readInt16(): number {
    this.require(2);
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    if (value < 0) {
      throw new Error(`Invalid negative Int16 length ${value}.`);
    }
    return value;
  }

  public readInt32(): number {
    this.require(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  public readInt64(): bigint {
    this.require(8);
    const value = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return value;
  }

  public readFloat32(): number {
    this.require(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  public readFloat64(): number {
    this.require(8);
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  public readString(): string {
    const length = this.read7BitEncodedInt();
    return this.textDecoder.decode(this.readBytes(length));
  }

  public readBytes(length: number): Uint8Array {
    if (length < 0) {
      throw new Error(`Invalid negative byte length ${length}.`);
    }
    this.require(length);
    const value = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  private read7BitEncodedInt(): number {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const current = this.readByte();
      value |= (current & 0x7f) << shift;
      if ((current & 0x80) === 0) {
        if (value < 0) {
          throw new Error("Invalid negative .NET string length.");
        }
        return value;
      }
    }
    throw new Error("Invalid .NET 7-bit encoded integer.");
  }

  private require(length: number): void {
    if (this.offset + length > this.bytes.byteLength) {
      throw new Error(
        `Unexpected end of TreeAttribute at byte ${this.offset}; needed ${length} more byte(s).`,
      );
    }
  }
}
