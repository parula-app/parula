/** Everything Proteus must remember across restarts: our identity, our unused
 * prekeys, and the live ratchet state of every session.
 *
 * The ratchet advances on every single decrypt, so this has to be written back
 * after each one. Losing it does not just lose history: the peer's next message
 * is undecryptable until one side resets the session.
 *
 * Serialized into the Wire account config as JSON, like `SignalStore` is. */
import { ProteusIdentity } from "./ProteusIdentity";
import { ProteusPreKey, kLastResortPreKeyID, kPreKeyTarget } from "./PreKeyBundle";
import { ProteusSession } from "./ProteusSession";

export class ProteusStore {
  identity: ProteusIdentity;
  /** Key ID -> prekey, including the last-resort one at `kLastResortPreKeyID` */
  preKeys = new Map<number, ProteusPreKey>();
  /** Next one-time prekey ID to mint. Monotonic across top-ups and restarts, so
   * a consumed ID is never handed out twice. */
  nextPreKeyID = 0;
  /** `<domain>@<userID>@<clientID>` -> session */
  sessions = new Map<string, ProteusSession>();

  /** A brand-new device: identity, the last-resort prekey, and the first batch
   * of one-time prekeys that `POST /clients` uploads. */
  static createNew(): ProteusStore {
    let store = new ProteusStore();
    store.identity = ProteusIdentity.createNew();
    let lastResort = ProteusPreKey.lastResort();
    store.preKeys.set(lastResort.keyID, lastResort);
    store.generateMorePreKeys(kPreKeyTarget);
    return store;
  }

  get lastResortPreKey(): ProteusPreKey {
    return this.preKeys.get(kLastResortPreKeyID);
  }

  /** The one-time prekeys, i.e. everything but the last-resort one. */
  get oneTimePreKeys(): ProteusPreKey[] {
    return [...this.preKeys.values()].filter(preKey => !preKey.isLastResort);
  }

  /** Mints `count` prekeys with fresh IDs and adds them.
   * @returns just the new ones, to upload only those. */
  generateMorePreKeys(count: number): ProteusPreKey[] {
    let preKeys = ProteusPreKey.generate(this.nextPreKeyID, count);
    for (let preKey of preKeys) {
      this.preKeys.set(preKey.keyID, preKey);
    }
    this.nextPreKeyID = (this.nextPreKeyID + count) % kLastResortPreKeyID;
    return preKeys;
  }

  /** Tops the *server* back up to `target` one-time prekeys once it is down to
   * half of them. Only the server's count matters: our own map keeps a prekey
   * until a peer actually uses it, which can be long after the server ran out.
   * @param remainingOnServer from `GET /clients/:clientID/prekeys`
   * @returns only the new keys, so we upload only those */
  replenishPreKeys(remainingOnServer: number, target = kPreKeyTarget): ProteusPreKey[] {
    return remainingOnServer > target / 2 ? [] : this.generateMorePreKeys(target - remainingOnServer);
  }

  session(sessionID: string): ProteusSession | undefined {
    return this.sessions.get(sessionID);
  }

  deleteSession(sessionID: string) {
    this.sessions.delete(sessionID);
  }

  toJSON(): any {
    return {
      identity: this.identity.toJSON(),
      nextPreKeyID: this.nextPreKeyID,
      preKeys: [...this.preKeys.values()].map(preKey => preKey.toJSON()),
      sessions: [...this.sessions.values()].map(session => session.toJSON()),
    };
  }

  static fromJSON(json: any): ProteusStore {
    let store = new ProteusStore();
    store.identity = ProteusIdentity.fromJSON(json.identity);
    for (let entry of json.preKeys ?? []) {
      let preKey = ProteusPreKey.fromJSON(entry);
      store.preKeys.set(preKey.keyID, preKey);
    }
    store.nextPreKeyID = json.nextPreKeyID ?? 0;
    for (let entry of json.sessions ?? []) {
      store.sessions.set(entry.sessionID, ProteusSession.fromJSON(entry, store.identity));
    }
    return store;
  }
}
