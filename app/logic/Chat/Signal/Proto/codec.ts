/** A tiny, readable protobuf codec, replacing the external protobufjs dependency.
 *
 * Declare a message with the field builders — each field is one line that reads
 * like a proto definition, e.g.:
 *
 *   const Person = message({
 *     name:    string(1),
 *     age:     int(2),
 *     emails:  repeated(string(3)),
 *     address: sub(4, () => Address),
 *   });
 *   type Person = TypeOf<typeof Person>;   // inferred TS interface, no duplication
 *
 * The field number lives once, next to its field. The TypeScript shape is
 * inferred, so there is no separate interface to keep in sync. Only the wire
 * types WhatsApp uses are supported: varint (int/bool/enum), length-delimited
 * (string/bytes/nested message), and repeated of those. */
import { ProtoWriter, readProto } from "./ProtobufLite";

export type WireType = "varint" | "varint64" | "bool" | "string" | "bytes" | "message" | "fixed64" | "fixed32" | "float";

export interface Field<T = unknown> {
  id: number;
  wire: WireType;
  repeated?: boolean;
  /** For nested messages; lazy so messages can reference each other. */
  ref?: () => MessageDef;
  /** Phantom type carrier (never assigned at runtime). */
  readonly value?: T;
}

export interface MessageDef<T = any> {
  fields: Record<string, Field>;
  readonly value?: T;
}

// --- field builders ---
export function int(id: number): Field<number> { return { id, wire: "varint" }; }
/** proto `uint64`/`int64` as a bigint — exact past 2^53, e.g. a random CallId. */
export function int64(id: number): Field<bigint> { return { id, wire: "varint64" }; }
export function bool(id: number): Field<boolean> { return { id, wire: "bool" }; }
export function string(id: number): Field<string> { return { id, wire: "string" }; }
export function bytes(id: number): Field<Uint8Array> { return { id, wire: "bytes" }; }
/** proto `fixed64`/`sfixed64` — a bigint (can exceed 2^53, e.g. AttachmentPointer.cdnId). */
export function fixed64(id: number): Field<bigint> { return { id, wire: "fixed64" }; }
/** proto `fixed32`/`sfixed32`. */
export function fixed32(id: number): Field<number> { return { id, wire: "fixed32" }; }
/** proto `float` — a 32-bit IEEE-754 number, sent as a fixed32. */
export function float(id: number): Field<number> { return { id, wire: "float" }; }
export function sub<T>(id: number, ref: () => MessageDef<T>): Field<T> {
  return { id, wire: "message", ref: ref as () => MessageDef };
}
export function repeated<T>(field: Field<T>): Field<T[]> {
  return { ...field, repeated: true } as unknown as Field<T[]>;
}

type Infer<F extends Record<string, Field>> = { [K in keyof F]?: F[K] extends Field<infer T> ? T : never };

export function message<F extends Record<string, Field>>(fields: F): MessageDef<Infer<F>> {
  return { fields };
}

/** The TypeScript shape of a message, e.g. `type Person = TypeOf<typeof Person>`. */
export type TypeOf<D extends MessageDef> = NonNullable<D["value"]>;

// --- encode / decode ---
export function encode<T>(def: MessageDef<T>, obj: T): Uint8Array {
  let writer = new ProtoWriter();
  for (let name of Object.keys(def.fields)) {
    let field = def.fields[name];
    let value = (obj as any)?.[name];
    if (value == null) {
      continue;
    }
    for (let item of field.repeated ? value : [value]) {
      writeField(writer, field, item);
    }
  }
  return writer.finish();
}

function writeField(writer: ProtoWriter, field: Field, value: any) {
  switch (field.wire) {
    case "varint": writer.varint(field.id, value); break;
    case "varint64": writer.varint(field.id, value); break;
    case "bool": writer.varint(field.id, value ? 1 : 0); break;
    case "string": writer.bytes(field.id, new TextEncoder().encode(value)); break;
    case "bytes": writer.bytes(field.id, value); break;
    case "message": writer.bytes(field.id, encode(field.ref!(), value)); break;
    case "fixed64": writer.fixed64(field.id, value); break;
    case "fixed32": writer.fixed32(field.id, value); break;
    case "float": writer.fixed32(field.id, floatToBits(value)); break;
  }
}

export function decode<T>(def: MessageDef<T>, data: Uint8Array): T {
  let fields = readProto(data);
  let out: any = {};
  for (let name of Object.keys(def.fields)) {
    let field = def.fields[name];
    let entries = fields.get(field.id);
    if (!entries?.length) {
      continue;
    }
    out[name] = field.repeated ? entries.map(e => readField(field, e)) : readField(field, entries[0]);
  }
  return out as T;
}

function readField(field: Field, entry: { int?: bigint, data?: Uint8Array }): any {
  switch (field.wire) {
    case "varint": return Number(entry.int ?? 0n);
    case "varint64": return entry.int ?? 0n;
    case "bool": return (entry.int ?? 0n) != 0n;
    case "string": return new TextDecoder().decode(entry.data ?? new Uint8Array());
    case "bytes": return entry.data ?? new Uint8Array();
    case "message": return decode(field.ref!(), entry.data ?? new Uint8Array());
    case "fixed64": return entry.int ?? 0n;
    case "fixed32": return Number(entry.int ?? 0n);
    case "float": return bitsToFloat(Number(entry.int ?? 0n));
  }
}

let floatBits = new DataView(new ArrayBuffer(4));

function floatToBits(value: number): number {
  floatBits.setFloat32(0, value);
  return floatBits.getUint32(0);
}

function bitsToFloat(bits: number): number {
  floatBits.setUint32(0, bits);
  return floatBits.getFloat32(0);
}
