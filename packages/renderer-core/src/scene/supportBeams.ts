import { Matrix4, Vector3 } from "three";

export interface DecodedSupportBeam {
  readonly start: readonly [number, number, number];
  readonly end: readonly [number, number, number];
  readonly blockId: number;
  readonly facingIndex: number;
}

export interface SupportBeamSegment {
  readonly shapeIndex: number;
  readonly matrix: Matrix4;
}

export function decodeSupportBeamArray(bytes: Uint8Array): DecodedSupportBeam[] {
  const reader = new ProtoReader(bytes);
  const beams: DecodedSupportBeam[] = [];
  while (reader.remaining > 0) {
    const { field, wire } = reader.readKey();
    if (field === 1 && wire === 2) {
      beams.push(decodeSupportBeam(reader.readLengthDelimited()));
    } else {
      reader.skip(wire);
    }
  }
  return beams;
}

export function createSupportBeamSegments(
  beam: Pick<DecodedSupportBeam, "start" | "end">,
  partialEnds = true,
): SupportBeamSegment[] {
  const start = new Vector3(...beam.start);
  const delta = new Vector3(...beam.end).sub(start);
  const originalLength = delta.length();
  if (!Number.isFinite(originalLength) || originalLength < 0.01) {
    return [];
  }
  const horizontalLength = Math.hypot(delta.x, delta.z);
  const direction = delta.clone().multiplyScalar(1 / Math.max(1, originalLength));
  const yaw = Math.atan2(-delta.x, -delta.z) + Math.PI / 2;
  const pitch = Math.atan2(horizontalLength, -delta.y) + Math.PI / 2;
  const extend = Math.max(
    Math.abs(Math.sin(yaw) * Math.cos(yaw)),
    Math.abs(Math.sin(pitch) * Math.cos(pitch)),
  ) * 4 / 16;
  const length = originalLength + extend;
  const shapeCount = partialEnds ? 4 : 1;
  const segments: SupportBeamSegment[] = [];

  for (let distance = -extend; distance < length; distance += 1) {
    let sectionLength = Math.min(1, length - distance);
    if (sectionLength < 0.01) {
      continue;
    }
    if (shapeCount > 1 && length < 18 / 16) {
      sectionLength = length;
      distance += 1;
    }
    const shapeIndex = Math.max(
      0,
      Math.min(shapeCount - 1, Math.round((sectionLength - 4 / 16) * shapeCount)),
    );
    const modelLength = (shapeIndex + 1) / 4;
    const xScale = shapeCount === 1 ? sectionLength : sectionLength / modelLength;
    const sectionStart = start.clone().addScaledVector(direction, distance);

    // Vintage Story shapes are centered by createJsonShapeGeometry. The final
    // +0.5 translation restores source-model coordinates before applying the
    // game's support-beam matrix verbatim.
    const matrix = new Matrix4()
      .makeTranslation(sectionStart.x, sectionStart.y, sectionStart.z)
      .multiply(new Matrix4().makeRotationY(yaw))
      .multiply(new Matrix4().makeRotationZ(pitch))
      .multiply(new Matrix4().makeScale(xScale, 1, 1))
      .multiply(new Matrix4().makeTranslation(-1, -0.125, -0.5))
      .multiply(new Matrix4().makeTranslation(0.5, 0.5, 0.5));
    segments.push({ shapeIndex: partialEnds ? shapeIndex : 0, matrix });
  }
  return segments;
}

function decodeSupportBeam(bytes: Uint8Array): DecodedSupportBeam {
  const reader = new ProtoReader(bytes);
  let start: readonly [number, number, number] = [0, 0, 0];
  let end: readonly [number, number, number] = [0, 0, 0];
  let blockId = 0;
  let facingIndex = 0;
  while (reader.remaining > 0) {
    const { field, wire } = reader.readKey();
    if ((field === 1 || field === 2) && wire === 2) {
      const vector = decodeVec3f(reader.readLengthDelimited());
      if (field === 1) start = vector;
      else end = vector;
    } else if (field === 3 && wire === 0) {
      blockId = reader.readVarint();
    } else if (field === 4 && wire === 0) {
      facingIndex = reader.readVarint();
    } else {
      reader.skip(wire);
    }
  }
  return { start, end, blockId, facingIndex };
}

function decodeVec3f(bytes: Uint8Array): readonly [number, number, number] {
  const reader = new ProtoReader(bytes);
  const values = [0, 0, 0];
  while (reader.remaining > 0) {
    const { field, wire } = reader.readKey();
    if (field >= 1 && field <= 3 && wire === 5) {
      values[field - 1] = reader.readFloat32();
    } else {
      reader.skip(wire);
    }
  }
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
}

class ProtoReader {
  private readonly view: DataView;
  private offset = 0;

  public constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  public get remaining(): number {
    return this.bytes.byteLength - this.offset;
  }

  public readKey(): { field: number; wire: number } {
    const key = this.readVarint();
    return { field: key >>> 3, wire: key & 7 };
  }

  public readVarint(): number {
    let value = 0;
    let multiplier = 1;
    for (let index = 0; index < 5; index += 1) {
      const byte = this.readByte();
      value += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) {
        return value >>> 0;
      }
      multiplier *= 128;
    }
    throw new Error("Support-beam protobuf varint exceeds 32 bits.");
  }

  public readFloat32(): number {
    this.require(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  public readLengthDelimited(): Uint8Array {
    const length = this.readVarint();
    this.require(length);
    const result = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }

  public skip(wire: number): void {
    switch (wire) {
      case 0: this.readVarint(); return;
      case 1: this.advance(8); return;
      case 2: this.readLengthDelimited(); return;
      case 5: this.advance(4); return;
      default: throw new Error(`Unsupported support-beam protobuf wire type ${wire}.`);
    }
  }

  private readByte(): number {
    this.require(1);
    return this.bytes[this.offset++] ?? 0;
  }

  private advance(length: number): void {
    this.require(length);
    this.offset += length;
  }

  private require(length: number): void {
    if (length < 0 || this.offset + length > this.bytes.byteLength) {
      throw new Error(`Unexpected end of support-beam protobuf at byte ${this.offset}.`);
    }
  }
}
