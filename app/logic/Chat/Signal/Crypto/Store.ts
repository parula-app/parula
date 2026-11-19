/** In-memory Signal protocol store: our keys plus per-peer sessions and
 * per-group sender keys. A SQL-backed implementation can replace this later
 * by implementing the same shape; persistence is not wired yet. */
import { KeyPair } from "./KeyPair";
import { SignedPreKey, PreKey } from "./Identity";
import { SessionState } from "./SessionCipher";
import { SenderKeyState } from "./GroupCipher";
import { generateRegistrationID, generateSignedPreKey, generatePreKeys } from "./Identity";
import { base64Encode, base64Decode, bytesEqual } from "./primitives";

export class SignalStore {
  identityKeyPair: KeyPair;
  registrationID: number;
  signedPreKeys = new Map<number, SignedPreKey>();
  preKeys = new Map<number, PreKey>();
  /** Next one-time prekey id to mint. Monotonic across top-ups and restarts so a
   * consumed prekey's id is never reused (the server keys uploads by id). */
  nextPreKeyID = 1;
  /** Keyed by peer address string, e.g. "49151234567.3" */
  sessions = new Map<string, SessionState>();
  /** Keyed by `${groupJID}|${senderAddress}` */
  senderKeys = new Map<string, SenderKeyState>();
  /** Trusted remote identity keys (32-byte), keyed by peer address, or by
   * account with `identityPerAccount` */
  identities = new Map<string, Uint8Array>();
  /** Signal: all devices of an account share one identity key, so we trust it per
   * account ("<serviceId>"). WhatsApp and OMEMO devices each have their own key. */
  identityPerAccount = false;
  /** Called when a peer has a different identity key than the one we knew: they
   * reinstalled, or someone, e.g. the server, put in their own keys to read along.
   * Gets the `identities` key of the peer. */
  onIdentityChange: ((name: string) => void) | null = null;

  static createNew(): SignalStore {
    let store = new SignalStore();
    store.identityKeyPair = KeyPair.generate();
    store.registrationID = generateRegistrationID();
    let signed = generateSignedPreKey(store.identityKeyPair, 1);
    store.signedPreKeys.set(1, signed);
    store.generateMorePreKeys(kPreKeyTarget);
    return store;
  }

  /** Mints `count` fresh one-time prekeys with new, never-reused ids and adds
   * them to the store. @returns just the new keys (to upload only those). */
  generateMorePreKeys(count: number): PreKey[] {
    let keys = generatePreKeys(this.nextPreKeyID, count);
    for (let key of keys) {
      this.preKeys.set(key.keyID, key);
    }
    this.nextPreKeyID += count;
    return keys;
  }

  /** Tops the store back up to the target one-time-prekey count (after the server
   * consumed some), returning only the newly minted keys, or an empty array if
   * we already have enough. */
  replenishPreKeys(target = kPreKeyTarget): PreKey[] {
    let need = target - this.preKeys.size;
    return need > 0 ? this.generateMorePreKeys(need) : [];
  }

  /** Remembers the identity key of the peer at `address`, once a session with it
   * is set up (libsignal `saveIdentity`). A key other than the known one replaces
   * it, as Signal does for unverified contacts, and is reported to `onIdentityChange`. */
  saveIdentity(address: string, identityKey: Uint8Array): void {
    let name = this.identityPerAccount ? address.substring(0, address.lastIndexOf(".")) : address;
    // Signal stores from before `identityPerAccount` have the key per device: take it over
    let known = this.identities.get(name) ?? this.identities.get(address);
    this.identities.delete(address);
    this.identities.set(name, identityKey);
    if (known && !bytesEqual(known, identityKey)) {
      this.onIdentityChange?.(name);
    }
  }

  /** Serializes the whole store to plain JSON for the account config: the static
   * key material (identity, registration id, signed and one-time prekeys, trusted
   * identities) AND the live ratchet state (pairwise sessions, group sender keys),
   * so we can resume decrypting after a restart instead of the peer re-establishing. */
  toJSON(): any {
    return {
      identityKey: base64Encode(this.identityKeyPair.privateKey),
      registrationID: this.registrationID,
      nextPreKeyID: this.nextPreKeyID,
      signedPreKeys: [...this.signedPreKeys.values()].map(key => ({
        id: key.keyID,
        key: base64Encode(key.keyPair.privateKey),
        signature: base64Encode(key.signature),
      })),
      preKeys: [...this.preKeys.values()].map(key => ({
        id: key.keyID,
        key: base64Encode(key.keyPair.privateKey),
      })),
      identities: [...this.identities.entries()].map(([address, key]) => ({
        address,
        key: base64Encode(key),
      })),
      sessions: [...this.sessions.entries()].map(([address, state]) => ({ address, state: state.toJSON() })),
      senderKeys: [...this.senderKeys.entries()].map(([key, state]) => ({ key, state: state.toJSON() })),
    };
  }

  static fromJSON(json: any): SignalStore {
    let store = new SignalStore();
    store.identityKeyPair = KeyPair.fromPrivate(base64Decode(json.identityKey));
    store.registrationID = json.registrationID;
    for (let entry of json.signedPreKeys ?? []) {
      store.signedPreKeys.set(entry.id,
        new SignedPreKey(entry.id, KeyPair.fromPrivate(base64Decode(entry.key)), base64Decode(entry.signature)));
    }
    for (let entry of json.preKeys ?? []) {
      store.preKeys.set(entry.id, new PreKey(entry.id, KeyPair.fromPrivate(base64Decode(entry.key))));
    }
    // Older configs predate nextPreKeyID; resume past the highest id we still hold.
    let maxPreKeyID = [...store.preKeys.keys()].reduce((max, id) => Math.max(max, id), 0);
    store.nextPreKeyID = json.nextPreKeyID ?? maxPreKeyID + 1;
    for (let entry of json.identities ?? []) {
      store.identities.set(entry.address, base64Decode(entry.key));
    }
    for (let entry of json.sessions ?? []) {
      store.sessions.set(entry.address, SessionState.fromJSON(entry.state));
    }
    for (let entry of json.senderKeys ?? []) {
      store.senderKeys.set(entry.key, SenderKeyState.fromJSON(entry.state));
    }
    return store;
  }
}

/** How many one-time prekeys we aim to keep published on the server, refilled as
 * peers consume them (the count WhatsApp/Signal use). */
const kPreKeyTarget = 100;
