/** `otr.proto`, the transport envelope of a Proteus message: the per-device
 * ciphertexts of one `GenericMessage`, grouped by backend domain and user.
 *
 * `POST /conversations/{domain}/{conversationID}/proteus/messages` with
 * `Content-Type: application/x-protobuf`.
 *
 * Two encodings are easy to get wrong and are handled by `ClientID`/`UserID`
 * below: a client ID is a hex string carried as a `uint64`, and a user ID is a
 * UUID carried as its raw 16 bytes, not as text. */
import { message, sub, bytes, string, int, int64, bool, repeated, type TypeOf } from "../../Signal/Proto/codec";

export const QualifiedNewOtrMessage = message({
  sender: sub(1, () => ClientID),
  recipients: repeated(sub(2, () => QualifiedUserEntry)),
  nativePush: bool(3),
  /** The `External` ciphertext, when the message is too big to fan out */
  blob: bytes(4),
  nativePriority: int(5),
  /** Deliver now, but do not keep in the notification stream */
  transient: bool(6),
  // The backend requires exactly one of these four. ReportAll and IgnoreAll are
  // empty messages, so on the wire they are a tag with a zero-length body.
  reportAll: sub(7, () => ReportAll),
  ignoreAll: sub(8, () => IgnoreAll),
  reportOnly: sub(9, () => ReportOnly),
  ignoreOnly: sub(10, () => IgnoreOnly),
});
export type QualifiedNewOtrMessage = TypeOf<typeof QualifiedNewOtrMessage>;

export const QualifiedUserEntry = message({
  domain: string(1),
  entries: repeated(sub(2, () => UserEntry)),
});
export type QualifiedUserEntry = TypeOf<typeof QualifiedUserEntry>;

export const UserEntry = message({
  user: sub(1, () => UserID),
  clients: repeated(sub(2, () => ClientEntry)),
});
export type UserEntry = TypeOf<typeof UserEntry>;

export const ClientEntry = message({
  client: sub(1, () => ClientID),
  /** The CBOR `Envelope` for this one device, raw */
  text: bytes(2),
});
export type ClientEntry = TypeOf<typeof ClientEntry>;

/** The backend's client ID is a lowercase hex string, sent as the `uint64` it
 * parses to. */
export const ClientID = message({
  client: int64(1),
});
export type ClientID = TypeOf<typeof ClientID>;

/** The raw 16 bytes of the user's UUID, not its dashed string form. */
export const UserID = message({
  uuid: bytes(1),
});
export type UserID = TypeOf<typeof UserID>;

export const QualifiedUserID = message({
  id: string(1),
  domain: string(2),
});
export type QualifiedUserID = TypeOf<typeof QualifiedUserID>;

/** If any client of the conversation is missing, do not send; report it (412). */
export const ReportAll = message({});

/** Do not check for missing clients at all; send to exactly what we supplied. */
export const IgnoreAll = message({});

/** Report only if a client of one of these users is missing. */
export const ReportOnly = message({
  userIDs: repeated(sub(1, () => QualifiedUserID)),
});

/** Report only if a client of a user *not* listed here is missing. */
export const IgnoreOnly = message({
  userIDs: repeated(sub(1, () => QualifiedUserID)),
});

export enum OtrPriority {
  Low = 1,
  High = 2,
}

/** `"a1b2c3"` -> `0xa1b2c3n`, for `ClientID.client`. */
export function clientIDToNumber(clientID: string): bigint {
  if (!/^[0-9a-fA-F]{1,16}$/.test(clientID)) {
    throw new Error(`Not a Wire client ID: ${clientID}`);
  }
  return BigInt("0x" + clientID);
}

/** `"5b0c1a2e-....-...."` -> its 16 raw bytes, for `UserID.uuid`. */
export function userIDToBytes(userID: string): Uint8Array {
  let hex = userID.replace(/-/g, "");
  if (hex.length != 32 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`Not a Wire user ID: ${userID}`);
  }
  let uuid = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    uuid[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return uuid;
}
