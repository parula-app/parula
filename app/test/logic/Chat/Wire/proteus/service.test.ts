/** `ProteusService` against a fake `WireAPI`: the fan-out, the mismatch dance,
 * and the recovery from a session we cannot read.
 *
 * The peers here are real `ProteusStore`s, so the ciphertext the service puts
 * into each `ClientEntry` is decrypted by the device it was addressed to. That
 * is what makes the fan-out test meaningful rather than a shape check. What it
 * cannot check is the backend's own opinion of the protobuf we send. */
import { ProteusService, ProteusDevice } from "../../../../../logic/Chat/Wire/Proteus/ProteusService";
import { ProteusStore } from "../../../../../logic/Chat/Wire/Proteus/ProteusStore";
import { ProteusSession, ProteusErrorCode } from "../../../../../logic/Chat/Wire/Proteus/ProteusSession";
import { ProteusIdentity } from "../../../../../logic/Chat/Wire/Proteus/ProteusIdentity";
import { ProteusPreKey } from "../../../../../logic/Chat/Wire/Proteus/PreKeyBundle";
import { QualifiedNewOtrMessage, userIDToBytes } from "../../../../../logic/Chat/Wire/Proteus/otr";
import { decode } from "../../../../../logic/Chat/Signal/Proto/codec";
import { base64Encode } from "../../../../../logic/Chat/Signal/Crypto/primitives";
import type { WireAPI } from "../../../../../logic/Chat/Wire/WireAPI";
import type { TWireQualifiedID, TWireQualifiedUserClients, TWireMessageSendingStatus, TWirePrekey, TWireClaimedPrekeys, TWireUserClients } from "../../../../../logic/Chat/Wire/TWire";
import { expect, test } from "vitest";

test("one message is encrypted once per device, grouped by backend and user", async () => {
  let net = new FakeWire();
  let bob = net.addPeer(kOther, kBob, "b0b0");
  let bobTablet = net.addPeer(kOther, kBob, "b0b1");
  let carol = net.addPeer(kHome, kCarol, "ca401");
  let myOtherDevice = net.addPeer(kHome, kMe, "de71ce02");
  net.addPeer(kHome, kMe, kMyClientID); // us; must not get a copy

  let me = net.service();
  let result = await me.send(kConversation, [user(kHome, kMe), user(kOther, kBob), user(kHome, kCarol)], text("dinner?"));
  expect(result.canceled).toBe(false);
  expect(net.sent.length).toBe(1);

  let message = decode(QualifiedNewOtrMessage, net.sent[0]);
  expect(message.sender.client).toBe(BigInt("0x" + kMyClientID));
  expect(message.nativePush).toBe(true);
  // We supplied the full device list, so the backend is asked to report anyone
  // we got wrong rather than to send anyway.
  expect(message.reportAll).toEqual({});
  expect(message.ignoreAll).toBe(undefined);

  expect(message.recipients.map(each => each.domain).sort()).toEqual([kHome, kOther]);
  let home = message.recipients.find(each => each.domain == kHome);
  expect(home.entries.length).toBe(2); // Carol and our other device
  expect(home.entries.map(each => [...each.user.uuid])).toContainEqual([...userIDToBytes(kCarol)]);
  let other = message.recipients.find(each => each.domain == kOther);
  expect(other.entries.length).toBe(1);
  expect(other.entries[0].clients.length).toBe(2); // both of Bob's devices

  // Four devices, four sessions, and every one of them actually decrypts.
  expect(me.store.sessions.size).toBe(4);
  for (let peer of [bob, bobTablet, carol, myOtherDevice]) {
    expect(peer.read(net.sent[0], me)).toBe("dinner?");
  }
});

test("a 412 claims the missing prekeys, drops the deleted devices, and resends once", async () => {
  let net = new FakeWire();
  net.addPeer(kOther, kBob, "b0b0");
  let appeared = net.addPeer(kOther, kBob, "b0b2"); // the backend knows it, we do not
  let vanished = net.addPeer(kHome, kCarol, "ca401");
  let me = net.service();

  // Our first attempt is built from a device list that has Carol's old device
  // and not Bob's new one.
  net.clients = { [kOther]: { [kBob]: ["b0b0"] }, [kHome]: { [kCarol]: ["ca401"] } };
  net.statuses.push(mismatch({
    missing: { [kOther]: { [kBob]: ["b0b2"] } },
    deleted: { [kHome]: { [kCarol]: ["ca401"] } },
    redundant: { [kHome]: { [kCarol]: ["ca401"] } },
  }));

  let result = await me.send(kConversation, [user(kOther, kBob), user(kHome, kCarol)], text("hello"));
  expect(result.canceled).toBe(false);
  expect(result.status.sent).toBe(true);
  expect(net.sent.length).toBe(2);

  // The second claim asks for exactly the missing device, and nothing else.
  expect(net.claims.length).toBe(2);
  expect(net.claims[1]).toEqual({ [kOther]: { [kBob]: ["b0b2"] } });

  let resent = decode(QualifiedNewOtrMessage, net.sent[1]);
  expect(deviceIDsIn(resent).sort()).toEqual(["b0b0", "b0b2"]);
  expect(me.store.session(vanished.device.sessionID)).toBe(undefined);
  expect(appeared.read(net.sent[1], me)).toBe("hello");
});

test("a second 412 is not retried again", async () => {
  let net = new FakeWire();
  net.addPeer(kOther, kBob, "b0b0");
  let me = net.service();
  net.statuses.push(mismatch({ missing: { [kOther]: { [kBob]: ["b0b0"] } } }));
  net.statuses.push(mismatch({ missing: { [kOther]: { [kBob]: ["b0b0"] } } }));

  let result = await me.send(kConversation, [user(kOther, kBob)], text("hello"));
  expect(net.sent.length).toBe(2); // not 3, and not a loop
  expect(result.canceled).toBe(false);
  expect(result.status.sent).toBe(false); // the caller sees the failure
});

test("the app can refuse to send to a device that just appeared", async () => {
  let net = new FakeWire();
  net.addPeer(kOther, kBob, "b0b0");
  net.addPeer(kOther, kBob, "b0b2");
  let me = net.service();
  net.clients = { [kOther]: { [kBob]: ["b0b0"] } };
  net.statuses.push(mismatch({ missing: { [kOther]: { [kBob]: ["b0b2"] } } }));

  let asked: TWireMessageSendingStatus[] = [];
  me.onClientMismatch = async status => {
    asked.push(status);
    return false;
  };
  let result = await me.send(kConversation, [user(kOther, kBob)], text("secret"));
  expect(result.canceled).toBe(true);
  expect(net.sent.length).toBe(1);
  expect(net.claims.length).toBe(1); // the unknown device's prekey was never claimed
  expect(asked[0].missing).toEqual({ [kOther]: { [kBob]: ["b0b2"] } });
});

test("a 201 with failed_to_send is not a mismatch and is not resent", async () => {
  let net = new FakeWire();
  net.addPeer(kOther, kBob, "b0b0");
  let me = net.service();
  net.statuses.push({ ...okStatus(), failed_to_send: { "unreachable.example": { [kCarol]: ["ca401"] } } });

  let result = await me.send(kConversation, [user(kOther, kBob)], text("hello"));
  expect(net.sent.length).toBe(1);
  expect(result.canceled).toBe(false);
  expect(result.status.failed_to_send["unreachable.example"]).toEqual({ [kCarol]: ["ca401"] });
});

test("a device the backend no longer knows drops out of the payload", async () => {
  let net = new FakeWire();
  net.addPeer(kOther, kBob, "b0b0");
  let me = net.service();
  // The backend lists a device but hands out no prekey for it: it is gone.
  net.clients = { [kOther]: { [kBob]: ["b0b0", "ghost"] } };

  await me.send(kConversation, [user(kOther, kBob)], text("hello"));
  expect(deviceIDsIn(decode(QualifiedNewOtrMessage, net.sent[0]))).toEqual(["b0b0"]);
  expect(me.store.sessions.size).toBe(1);
});

test("an inbound otr-message-add decrypts and the store is written back", async () => {
  let net = new FakeWire();
  let bob = net.addPeer(kOther, kBob, "b0b0");
  let me = net.service();
  let saves = 0;
  me.onStoreChanged = async () => {
    saves++;
  };

  let plaintext = await me.decryptEvent(bob.eventTo(me, "good morning"));
  expect(text2(plaintext)).toBe("good morning");
  expect(saves).toBe(1);
  expect(me.store.session(bob.device.sessionID)).toBeTruthy();
  // The prekey the peer consumed is gone from our pool.
  expect(me.store.oneTimePreKeys.length).toBe(5);

  expect(text2(await me.decryptEvent(bob.eventTo(me, "and again")))).toBe("and again");
  expect(saves).toBe(2);
});

test("a message we cannot read resets the session exactly once", async () => {
  let net = new FakeWire();
  let bob = net.addPeer(kOther, kBob, "b0b0");
  let me = net.service();
  let resets: ProteusDevice[] = [];
  me.onSendSessionReset = async device => {
    resets.push(device);
  };
  await me.decryptEvent(bob.eventTo(me, "hello"));
  let claimsBefore = net.claims.length;

  // Three messages in a row that our session cannot make sense of, e.g. because
  // the peer restored a backup and its ratchet is behind ours.
  for (let i = 0; i < 3; i++) {
    await expect(me.decryptEvent(bob.eventFromNowhere(me))).rejects.toThrow();
  }
  expect(resets.length).toBe(1);
  expect(resets[0].sessionID).toBe(bob.device.sessionID);
  expect(net.claims.length).toBe(claimsBefore + 1); // one repair, not three
  expect(me.store.session(bob.device.sessionID)).toBeTruthy(); // rebuilt, not lost

  // Once the peer is readable again, a later breakage may be repaired again.
  let repaired = ProteusSession.fromPreKeyMessage(kMySessionID, bob.store.identity,
    me.store.session(bob.device.sessionID).encrypt(text("ping")), bob.store.preKeys);
  expect(text2(await me.decryptEvent(bob.eventTo(me, "readable", repaired.session)))).toBe("readable");
  await expect(me.decryptEvent(bob.eventFromNowhere(me))).rejects.toThrow();
  expect(resets.length).toBe(2);
});

test("a duplicate message is reported as such and never triggers a reset", async () => {
  let net = new FakeWire();
  let bob = net.addPeer(kOther, kBob, "b0b0");
  let me = net.service();
  let resets = 0;
  me.onSendSessionReset = async () => {
    resets++;
  };
  let event = bob.eventTo(me, "only once");
  expect(text2(await me.decryptEvent(event))).toBe("only once");

  // The notification stream replays; that is normal, not corruption.
  await expect(me.decryptEvent(event)).rejects.toMatchObject({ code: ProteusErrorCode.DuplicateMessage });
  expect(resets).toBe(0);
  expect(net.claims.length).toBe(0);
});

test("prekeys are topped back up once the server is down to half", async () => {
  let net = new FakeWire();
  let me = net.service();
  net.remainingPrekeyIDs = [...countUp(60), kLastResort];
  await me.replenishPreKeys(100);
  expect(net.uploaded.length).toBe(0); // 60 left of 100 is not low enough

  net.remainingPrekeyIDs = [...countUp(20), kLastResort];
  await me.replenishPreKeys(100);
  expect(net.uploaded.length).toBe(1);
  expect(net.uploaded[0].length).toBe(80);
  expect(net.uploaded[0][0].id).toBe(6); // continues past the ones we already minted
  expect(me.store.preKeys.get(6).bundleFor(me.store.identity).toBase64()).toBe(net.uploaded[0][0].key);
});

test("a session ID round-trips through its string form", () => {
  let device = new ProteusDevice(kOther, kBob, "b0b0");
  expect(device.sessionID).toBe(`${kOther}@${kBob}@b0b0`);
  let parsed = ProteusDevice.parse(device.sessionID);
  expect([parsed.domain, parsed.userID, parsed.clientID]).toEqual([kOther, kBob, "b0b0"]);
  // The pre-federation form has no domain.
  let legacy = ProteusDevice.parse(`${kBob}@b0b0`);
  expect([legacy.domain, legacy.userID, legacy.clientID]).toEqual(["", kBob, "b0b0"]);
});

/** A Wire backend with a device directory, a prekey server and a message queue,
 * all in memory. */
class FakeWire {
  peers: TestPeer[] = [];
  /** What `listUserClients` answers. Defaults to every peer that was added. */
  clients: TWireQualifiedUserClients | null = null;
  claims: TWireQualifiedUserClients[] = [];
  sent: Uint8Array[] = [];
  /** Queued answers for the next sends; anything past them succeeds. */
  statuses: TWireMessageSendingStatus[] = [];
  uploaded: TWirePrekey[][] = [];
  remainingPrekeyIDs: number[] = [];

  addPeer(domain: string, userID: string, clientID: string): TestPeer {
    let peer = new TestPeer(domain, userID, clientID);
    this.peers.push(peer);
    return peer;
  }

  service(): ProteusService {
    return new ProteusService(this as unknown as WireAPI, newStore(), kMe, kHome, kMyClientID);
  }

  peer(domain: string, userID: string, clientID: string): TestPeer | undefined {
    return this.peers.find(each =>
      each.domain == domain && each.userID == userID && each.clientID == clientID);
  }

  async listUserClients(userIDs: TWireQualifiedID[]): Promise<TWireUserClients> {
    let wanted = this.clients ?? this.defaultClients();
    let result: TWireUserClients = {};
    for (let domain of Object.keys(wanted)) {
      for (let userID of Object.keys(wanted[domain])) {
        if (!userIDs.some(each => each.domain == domain && each.id == userID)) {
          continue;
        }
        result[domain] ??= {};
        result[domain][userID] = wanted[domain][userID].map(id => ({ id, class: "desktop" as const }));
      }
    }
    return result;
  }

  async claimPrekeys(userClients: TWireQualifiedUserClients): Promise<TWireClaimedPrekeys> {
    this.claims.push(structuredClone(userClients));
    let prekeys = {};
    for (let domain of Object.keys(userClients)) {
      for (let userID of Object.keys(userClients[domain])) {
        for (let clientID of userClients[domain][userID]) {
          prekeys[domain] ??= {};
          prekeys[domain][userID] ??= {};
          // No peer means the device does not exist any more, which the backend
          // reports as a null prekey rather than as an error.
          prekeys[domain][userID][clientID] = this.peer(domain, userID, clientID)?.claimPreKey() ?? null;
        }
      }
    }
    return { qualified_user_client_prekeys: prekeys, failed_to_list: [] };
  }

  async sendProteusMessage(conversationID: TWireQualifiedID, message: Uint8Array): Promise<TWireMessageSendingStatus> {
    expect(conversationID).toEqual(kConversation);
    this.sent.push(message);
    return this.statuses.shift() ?? okStatus();
  }

  async getRemainingPrekeyIDs(): Promise<number[]> {
    return this.remainingPrekeyIDs;
  }

  async uploadPrekeys(clientID: string, prekeys: TWirePrekey[]) {
    expect(clientID).toBe(kMyClientID);
    this.uploaded.push(prekeys);
  }

  private defaultClients(): TWireQualifiedUserClients {
    let map: TWireQualifiedUserClients = {};
    for (let peer of this.peers) {
      map[peer.domain] ??= {};
      map[peer.domain][peer.userID] ??= [];
      map[peer.domain][peer.userID].push(peer.clientID);
    }
    return map;
  }
}

/** One other device out there, with its own identity and prekeys. */
class TestPeer {
  readonly domain: string;
  readonly userID: string;
  readonly clientID: string;
  readonly store = newStore();
  /** Its session with us, once one exists */
  session: ProteusSession | null = null;
  private nextPreKeyID = 0;

  constructor(domain: string, userID: string, clientID: string) {
    this.domain = domain;
    this.userID = userID;
    this.clientID = clientID;
  }

  get device(): ProteusDevice {
    return new ProteusDevice(this.domain, this.userID, this.clientID);
  }

  /** What the prekey server hands out for this device, a fresh one each time. */
  claimPreKey(): TWirePrekey {
    let preKey = this.store.preKeys.get(this.nextPreKeyID++);
    return preKey.toJSONForServer(this.store.identity);
  }

  /** Decrypts the copy of `message` that was addressed to this device. */
  read(message: Uint8Array, me: ProteusService): string {
    let sent = decode(QualifiedNewOtrMessage, message);
    let entry = sent.recipients
      .filter(each => each.domain == this.domain)
      .flatMap(each => each.entries)
      .filter(each => byteEquals(each.user.uuid, userIDToBytes(this.userID)))
      .flatMap(each => each.clients)
      .find(each => each.client.client == BigInt("0x" + this.clientID));
    expect(entry).toBeTruthy();
    if (this.session) {
      return text2(this.session.decrypt(entry.text, this.store.preKeys));
    }
    let created = ProteusSession.fromPreKeyMessage(sessionIDOf(me), this.store.identity, entry.text, this.store.preKeys);
    this.session = created.session;
    return text2(created.plaintext);
  }

  /** An inbound `conversation.otr-message-add` event from this device.
   * @param session use this one instead of the one from earlier events */
  eventTo(me: ProteusService, body: string, session?: ProteusSession): any {
    this.session = session ?? this.session ?? this.sessionTo(me);
    return this.event(base64Encode(this.session.encrypt(text(body))));
  }

  /** A well-formed message that our session with this device cannot place, as
   * happens when the peer restores a backup and its ratchet falls behind. */
  eventFromNowhere(me: ProteusService): any {
    let other = this.sessionTo(me);
    other.encrypt(text("thrown away"));
    // Without the prekey framing it reads as a message on a session we are
    // supposed to have already, not as an invitation to build a new one.
    other.pendingPreKey = null;
    return this.event(base64Encode(other.encrypt(text("unreadable"))));
  }

  /** Claims one of our prekeys the way the server hands them out: the lowest
   * one still there, and the last-resort key once they run out. */
  private sessionTo(me: ProteusService): ProteusSession {
    let available = me.store.oneTimePreKeys.sort((a, b) => a.keyID - b.keyID)[0] ?? me.store.lastResortPreKey;
    return ProteusSession.initiate(sessionIDOf(me), this.store.identity, available.bundleFor(me.store.identity));
  }

  private event(base64: string): any {
    return {
      type: "conversation.otr-message-add",
      qualified_conversation: kConversation,
      qualified_from: { id: this.userID, domain: this.domain },
      from: this.userID,
      data: { sender: this.clientID, recipient: kMyClientID, text: base64 },
    };
  }
}

/** A store with a handful of prekeys. The real `createNew()` mints 100, which is
 * right for a device and needlessly slow here. */
function newStore(): ProteusStore {
  let store = new ProteusStore();
  store.identity = ProteusIdentity.createNew();
  let lastResort = ProteusPreKey.lastResort();
  store.preKeys.set(lastResort.keyID, lastResort);
  store.generateMorePreKeys(6);
  return store;
}

function sessionIDOf(me: ProteusService): string {
  return `${me.domain}@${me.userID}@${me.clientID}`;
}

function okStatus(): TWireMessageSendingStatus {
  return {
    sent: true, time: "2026-08-20T12:00:00.000Z",
    missing: {}, redundant: {}, deleted: {}, failed_to_send: {}, failed_to_confirm_clients: {},
  };
}

/** A `412`: the backend refused the whole message. */
function mismatch(buckets: Partial<TWireMessageSendingStatus>): TWireMessageSendingStatus {
  return { ...okStatus(), sent: false, ...buckets };
}

function deviceIDsIn(message: any): string[] {
  return message.recipients
    .flatMap(each => each.entries)
    .flatMap(each => each.clients)
    .map(each => each.client.client.toString(16));
}

function byteEquals(a: Uint8Array, b: Uint8Array): boolean {
  return a.length == b.length && a.every((each, i) => each == b[i]);
}

function user(domain: string, id: string): TWireQualifiedID {
  return { id, domain };
}

function countUp(count: number): number[] {
  return [...Array(count).keys()];
}

const text = (value: string) => new TextEncoder().encode(value);
const text2 = (value: Uint8Array) => new TextDecoder().decode(value);
const kHome = "example.com";
const kOther = "other.example";
const kMe = "11111111-1111-1111-1111-111111111111";
const kBob = "22222222-2222-2222-2222-222222222222";
const kCarol = "33333333-3333-3333-3333-333333333333";
const kMyClientID = "de71ce01";
const kMySessionID = `${kHome}@${kMe}@${kMyClientID}`;
const kConversation: TWireQualifiedID = { id: "44444444-4444-4444-4444-444444444444", domain: kHome };
const kLastResort = 0xFFFF;
