/** `WireMLSService` against a fake `WireAPI`.
 *
 * The MLS side is real: our own `MLSClient` and the peers' are actual clients
 * in one process, and every byte that the service hands the fake backend is
 * parsed back with `MLSMessage.read()` before anybody looks at it. So a commit
 * bundle that only happens to be right as an object does not pass, and a peer
 * that we added really can read what we send afterwards.
 *
 * What the fake cannot check is the backend's own opinion of those bytes; the
 * rules of `Protocol/07-MLS-in-Wire.md` Appendix B, which all fail silently on
 * a real backend, are therefore checked here one by one. */
import { WireMLSService, WireMLSIdentity, wireMLSRecovery, type WireMLSRoom } from "../../../../logic/Chat/Wire/WireMLSService";
import type { TWireClaimedKeyPackage, TWireMLSOneToOne, TWireQualifiedID } from "../../../../logic/Chat/Wire/TWire";
import { MLSClient } from "../../../../logic/Chat/MLS/MLSClient";
import { MLSGroup } from "../../../../logic/Chat/MLS/MLSGroup";
import { BasicCredential, CredentialType } from "../../../../logic/Chat/MLS/Messages/Credential";
import { Extension, ExtensionType, ExternalSender, RequiredCapabilities } from "../../../../logic/Chat/MLS/Messages/Extension";
import { KeyPackage } from "../../../../logic/Chat/MLS/Messages/KeyPackage";
import { MLSMessage } from "../../../../logic/Chat/MLS/Messages/MLSMessage";
import { AddProposal } from "../../../../logic/Chat/MLS/Messages/Proposal";
import { SenderType, WireFormat } from "../../../../logic/Chat/MLS/Messages/Framing";
import { CipherSuite } from "../../../../logic/Chat/MLS/Crypto/CipherSuite";
import { TLSReader } from "../../../../logic/Chat/MLS/Codec/TLSReader";
import { base64Decode, base64Encode, randomBytes } from "../../../../logic/Chat/Signal/Crypto/primitives";
import { expect, test } from "vitest";

let suite = CipherSuite.forID(0x0001);

test("the group we create carries the backend's removal key as external sender 0", async () => {
  let net = new FakeWire();
  let service = await net.service();
  let room = await net.createGroup(service);

  let extension = Extension.find(service.groupFor(room).groupContext.extensions, ExtensionType.ExternalSenders);
  expect(extension).toBeTruthy();
  let senders = ExternalSender.listFromExtension(extension);
  // §5.2: the backend signs its Remove proposals as `external(0)`. Anything
  // else at index 0 and every server-side removal silently does nothing.
  expect(senders.length).toBe(1);
  expect(hex(senders[0].signatureKey)).toBe(hex(base64Decode(net.removalKey)));
  expect((senders[0].credential as BasicCredential).identityString).toBe("wire-server");

  // §6.2: `required_capabilities` names both credential types
  let required = RequiredCapabilities.fromExtension(
    Extension.find(service.groupFor(room).groupContext.extensions, ExtensionType.RequiredCapabilities));
  expect(required.credentialTypes).toEqual([CredentialType.Basic, CredentialType.X509]);
  expect(required.extensionTypes).toEqual([]);
  // §2.6: an empty `capabilities.credentials` makes the backend reject every
  // key package of ours
  expect(service.client.capabilities.credentials).toContain(CredentialType.Basic);
});

test("the commit bundle is the concatenation the backend parses, with a public commit", async () => {
  let net = new FakeWire();
  let service = await net.service();
  let bob = net.peer(kBob, "b0b0");
  let room = await net.createGroup(service, [kBob]);

  let bundle = parseBundle(net.bundles[0]);
  expect(bundle.length).toBe(3);
  // §7.2: `commit || group_info || welcome`, whole MLSMessages, nothing between
  expect(bundle.map(message => message.wireFormat))
    .toEqual([WireFormat.PublicMessage, WireFormat.GroupInfo, WireFormat.Welcome]);
  // Appendix B rule 2: a private commit is filed as the bundle's application
  // message, and the bundle is then refused for a missing commit
  expect(bundle[0].publicMessage.content.commit).toBeTruthy();
  expect(bundle[0].publicMessage.content.sender.type).toBe(SenderType.Member);
  // Appendix B rule 4: no ratchet tree, no external commits, no recovery
  expect(Extension.find(bundle[1].groupInfo.extensions, ExtensionType.RatchetTree)).toBeTruthy();
  expect(Extension.find(bundle[1].groupInfo.extensions, ExtensionType.ExternalPub)).toBeTruthy();
  expect(bundle[1].groupInfo.groupContext.epoch).toBe(1n);
  expect(hex(bundle[1].groupInfo.groupContext.groupID)).toBe(hex(base64Decode(room.groupID)));
  // The Welcome is Bob's, for the key package the backend handed us
  expect(MLSGroup.fromWelcome(bob, bundle[2].welcome).epoch).toBe(1n);
});

test("our commit is not applied when the delivery service refuses it, and is when it does not", async () => {
  let net = new FakeWire();
  let service = await net.service();
  let room = await net.createGroup(service);
  expect(service.groupFor(room).epoch).toBe(1n);

  net.peer(kBob, "b0b0");
  net.bundleErrors.push(wireError(400, "mls-protocol-error"));
  await expect(service.addMembers(room, [kBob])).rejects.toThrow();
  // Appendix B rule 10: merging before the 201 forks us out of the group as
  // soon as somebody else's commit won the race
  expect(service.groupFor(room).epoch).toBe(1n);
  expect(service.groupFor(room).members.length).toBe(1);

  await service.addMembers(room, [kBob]);
  expect(service.groupFor(room).epoch).toBe(2n);
  expect(service.groupFor(room).members.length).toBe(2);
});

test("a client added with a claimed key package can decrypt our next message", async () => {
  let net = new FakeWire();
  let service = await net.service();
  let bob = net.peer(kBob, "b0b0");
  let room = await net.createGroup(service, [kBob]);

  let bobGroup = MLSGroup.fromWelcome(bob, parseBundle(net.bundles[0])[2].welcome);
  expect(bobGroup.members.length).toBe(2);
  expect(hex(bobGroup.epochAuthenticator)).toBe(hex(service.groupFor(room).epochAuthenticator));

  await service.sendMessage(room, utf8("hello bob"));
  let message = MLSMessage.fromBytes(net.messages[0]);
  // §8: application data goes out encrypted, unlike our handshakes
  expect(message.wireFormat).toBe(WireFormat.PrivateMessage);
  expect(text(bobGroup.process(message).plaintext)).toBe("hello bob");

  // And the identity Bob sees for us is the one §2.2 prescribes
  let us = bobGroup.tree.leaf(0);
  expect(WireMLSIdentity.of(us).toString()).toBe(service.identity.toString());
});

test("a Welcome for a conversation we do not know yet", async () => {
  let net = new FakeWire();
  let service = await net.service();
  let bob = net.peer(kBob, "b0b0");

  // Bob's client establishes the group and adds us to it
  let groupID = base64Decode(kGroupID);
  let bobGroup = MLSGroup.create(bob, groupID, suite, net.groupExtensions());
  let ourKeyPackage = service.client.createKeyPackage();
  let result = bobGroup.commit([new AddProposal(ourKeyPackage.keyPackage)]);
  bobGroup.applyOwnCommit(result);

  expect(net.roomsAsked).toEqual([]);
  let room = await service.processWelcome(kConversation, result.welcome.toBytes()) as FakeRoom;
  expect(net.roomsAsked).toEqual([kConversation]);
  expect(room.groupID).toBe(kGroupID);
  expect(service.groupFor(room).epoch).toBe(1n);
  expect(hex(service.groupFor(room).epochAuthenticator)).toBe(hex(bobGroup.epochAuthenticator));
  expect(room.saves).toBeGreaterThan(0);
  // §9.2 step 1: the Welcome consumed one of our key packages
  expect(net.counted).toBeGreaterThan(1);

  // The notification stream replays, and the second copy must not throw
  expect(await service.processWelcome(kConversation, result.welcome.toBytes())).toBe(room);
});

test("a stale epoch rejoins by external commit instead of retrying the commit", async () => {
  let net = new FakeWire();
  let service = await net.service();
  let bob = net.peer(kBob, "b0b0");

  // Bob won the race for this group ID and is an epoch ahead of us
  let bobGroup = MLSGroup.create(bob, base64Decode(kGroupID), suite, net.groupExtensions());
  let established = bobGroup.commit();
  bobGroup.applyOwnCommit(established);
  net.groupInfo = new MLSMessage(bobGroup.groupInfo()).toBytes();
  net.bundleErrors.push(wireError(409, "mls-stale-message"));

  let room = await net.createGroup(service);

  // Two bundles: the commit that lost, and the external commit that rejoined
  expect(net.bundles.length).toBe(2);
  let rejoin = parseBundle(net.bundles[1]);
  expect(rejoin.map(message => message.wireFormat))
    .toEqual([WireFormat.PublicMessage, WireFormat.GroupInfo]);
  // §10.2: an external commit has no membership tag, because its sender was
  // not a member of the epoch it was sent in
  expect(rejoin[0].publicMessage.content.sender.type).toBe(SenderType.NewMemberCommit);
  expect(rejoin[0].publicMessage.membershipTag).toBe(null);

  // An external commit brings its own leaf in through the UpdatePath, so
  // there is no Add proposal to report
  bobGroup.process(rejoin[0]);
  expect(bobGroup.members.length).toBe(2);
  expect(service.groupFor(room).epoch).toBe(2n);
  expect(hex(service.groupFor(room).epochAuthenticator)).toBe(hex(bobGroup.epochAuthenticator));
});

test("key packages are replenished at the threshold and not above it", async () => {
  let net = new FakeWire();
  let service = await net.service();
  expect(net.uploaded.length).toBe(0); // 100 on the server already

  net.keyPackageCount = 51;
  await service.replenishKeyPackages();
  expect(net.uploaded.length).toBe(0);

  net.keyPackageCount = 50;
  await service.replenishKeyPackages();
  expect(net.uploaded.length).toBe(1);
  expect(net.uploaded[0].length).toBe(100);
  let keyPackage = KeyPackage.fromBytes(base64Decode(net.uploaded[0][0]));
  expect(keyPackage.suite.id).toBe(suite.id);
  expect(keyPackage.verify()).toBe(true);
  // §4.1 rule 9: the backend refuses a key package whose signature key it did
  // not see in `mls_public_keys` first
  expect(base64Encode(keyPackage.leafNode.signatureKey))
    .toBe(net.session.registered.ed25519);
});

test("the BasicCredential identity is byte-exact", async () => {
  // §2.2's worked example. Plain ASCII: no length prefix, no trailing NUL.
  // (The document says 62 bytes for it, but the string it shows is 71.)
  let identity = new WireMLSIdentity("fb880fac-b549-4d8b-9398-4246324c7b85",
    "67f41928e2844b6c", "staging.zinfra.io");
  expect(identity.toString()).toBe("fb880fac-b549-4d8b-9398-4246324c7b85:67f41928e2844b6c@staging.zinfra.io");
  expect(utf8(identity.toString()).length).toBe(36 + 1 + 16 + 1 + "staging.zinfra.io".length);

  // Lower-case hex, no `0x`, and leading zeros stripped, not padded
  expect(new WireMLSIdentity("FB880FAC-B549-4D8B-9398-4246324C7B85", "0067F41928E2844B", "wire.com").toString())
    .toBe("fb880fac-b549-4d8b-9398-4246324c7b85:67f41928e2844b@wire.com");

  let net = new FakeWire();
  let service = await net.service();
  let credential = service.client.credential as BasicCredential;
  expect(credential.type).toBe(CredentialType.Basic);
  expect(credential.identityString).toBe(`${kUserID}:${kClientID}@${kDomain}`);
  expect(hex(credential.identity)).toBe(hex(utf8(`${kUserID}:${kClientID}@${kDomain}`)));

  // What the backend actually reads is the one in the key package we upload
  net.keyPackageCount = 0;
  await service.replenishKeyPackages();
  let uploaded = KeyPackage.fromBytes(base64Decode(net.uploaded[0][0]));
  expect((uploaded.leafNode.credential as BasicCredential).identityString)
    .toBe(`${kUserID}:${kClientID}@${kDomain}`);
  // §2.4: a leaf identity we cannot parse is somebody else's business
  expect(WireMLSIdentity.of(uploaded.leafNode).qualifiedID).toEqual({ id: kUserID, domain: kDomain });
});

test("the MLS 1:1 group, and the race both sides may lose", async () => {
  let net = new FakeWire();
  let service = await net.service();
  net.peer(kBob, "b0b0");
  net.oneToOne = {
    conversation: { ...kEmptyConversation, qualified_id: kConversation, group_id: kGroupID, epoch: 0 },
    public_keys: { removal: { ed25519: net.removalKey } },
  };

  let room = await service.oneToOneGroup(kBob);
  expect(service.groupFor(room).epoch).toBe(1n);
  expect(service.groupFor(room).members.length).toBe(2);
  // §11.3: our own other devices go in too, so the backend was asked for both
  expect(net.claimed).toEqual([`${kBob.id}@${kBob.domain}`, `${kUserID}@${kDomain}`]);
});

test("every MLS error label maps to what §9.3 says to do about it", () => {
  expect(wireMLSRecovery("mls-stale-message")).toBe("rejoin");
  expect(wireMLSRecovery("mls-invalid-leaf-node-index")).toBe("rejoin");
  expect(wireMLSRecovery("mls-commit-missing-references")).toBe("rebuild");
  expect(wireMLSRecovery("mls-proposal-not-found")).toBe("rebuild");
  expect(wireMLSRecovery("mls-group-out-of-sync")).toBe("rebuild");
  expect(wireMLSRecovery("mls-client-mismatch")).toBe("rebuild");
  expect(wireMLSRecovery("mls-invalid-leaf-node-signature")).toBe("reset");
  expect(wireMLSRecovery("mls-identity-mismatch")).toBe("fatal");
  expect(wireMLSRecovery("non-empty-member-list")).toBe("fatal");
  expect(wireMLSRecovery("something-we-never-heard-of")).toBe("fatal");
});

/** The backend, as far as `WireMLSService` can tell: it records what we send,
 * hands out the key packages the peers made, and can be told to refuse the
 * next commit bundle with any of the labels of §9.3. */
class FakeWire {
  readonly removalKey = base64Encode(suite.generateSignatureKeyPair().publicKey);
  readonly session = new FakeSession();
  readonly bundles: Uint8Array[] = [];
  readonly messages: Uint8Array[] = [];
  readonly uploaded: string[][] = [];
  /** `<user>@<domain>` → that user's devices, each with key packages to spare */
  readonly devices = new Map<string, FakeDevice[]>();
  /** Which users we were asked for key packages of, in order */
  readonly claimed: string[] = [];
  readonly roomsAsked: TWireQualifiedID[] = [];
  readonly rooms = new Map<string, FakeRoom>();
  /** Thrown by the next `sendCommitBundle()` calls, in order */
  readonly bundleErrors: any[] = [];
  keyPackageCount = 100;
  counted = 0;
  groupInfo: Uint8Array | null = null;
  oneToOne: TWireMLSOneToOne | null = null;

  async service(): Promise<WireMLSService> {
    let service = new WireMLSService(this as any, this.session as any);
    service.onRoomForConversation = async conversationID => {
      this.roomsAsked.push(conversationID);
      return this.room(conversationID);
    };
    await service.setup();
    return service;
  }

  room(conversationID: TWireQualifiedID): FakeRoom {
    let key = `${conversationID.id}@${conversationID.domain}`;
    let room = this.rooms.get(key) ?? new FakeRoom(conversationID);
    this.rooms.set(key, room);
    return room;
  }

  /** A group of our own, established the way `Protocol/07` §6.1 does it */
  async createGroup(service: WireMLSService, invite: TWireQualifiedID[] = []): Promise<FakeRoom> {
    let room = this.room(kConversation);
    room.groupID = kGroupID;
    await service.createGroup(room, invite);
    return room;
  }

  /** Another Wire device, with key packages waiting to be claimed */
  peer(user: TWireQualifiedID, clientID: string): MLSClient {
    let client = MLSClient.create(suite,
      BasicCredential.fromString(new WireMLSIdentity(user.id, clientID, user.domain).toString()));
    let key = `${user.id}@${user.domain}`;
    this.devices.set(key, [...this.devices.get(key) ?? [], { user, clientID, client }]);
    return client;
  }

  /** What §6.2 puts into the GroupContext, for the peers that build a group
   * without going through `WireMLSService` */
  groupExtensions(): Extension[] {
    return [
      ExternalSender.listToExtension([new ExternalSender(base64Decode(this.removalKey),
        BasicCredential.fromString("wire-server"))]),
      new RequiredCapabilities([], [], [CredentialType.Basic, CredentialType.X509]).toExtension(),
    ];
  }

  async getMLSPublicKeys() {
    return { removal: { ed25519: this.removalKey } };
  }

  async getFeatureConfigs() {
    return {
      mls: {
        status: "enabled", lockStatus: "unlocked", ttl: null,
        config: { defaultCipherSuite: suite.id, allowedCipherSuites: [suite.id] },
      },
    };
  }

  async countKeyPackages(_clientID: string, _cipherSuite: number): Promise<number> {
    this.counted++;
    return this.keyPackageCount;
  }

  async uploadKeyPackages(_clientID: string, keyPackages: string[]): Promise<void> {
    this.uploaded.push(keyPackages);
  }

  /** §4.4: one key package per device, and each is consumed by the claim, so
   * a second claim of the same device hands out a different one. */
  async claimKeyPackages(user: TWireQualifiedID, _cipherSuite: number): Promise<TWireClaimedKeyPackage[]> {
    this.claimed.push(`${user.id}@${user.domain}`);
    return (this.devices.get(`${user.id}@${user.domain}`) ?? []).map(device => {
      let created = device.client.createKeyPackage();
      return {
        user: device.user.id,
        domain: device.user.domain,
        client: device.clientID,
        key_package: base64Encode(created.keyPackage.toBytes()),
        key_package_ref: base64Encode(created.ref),
      };
    });
  }

  async sendCommitBundle(bundle: Uint8Array) {
    this.bundles.push(bundle);
    let ex = this.bundleErrors.shift();
    if (ex) {
      throw ex;
    }
    return { events: [], time: kTime, failed_to_send: [], failed: [] };
  }

  async sendMLSMessage(message: Uint8Array) {
    this.messages.push(message);
    return { events: [], time: kTime, failed_to_send: [], failed: [] };
  }

  async getGroupInfo(_conversationID: TWireQualifiedID): Promise<Uint8Array> {
    if (!this.groupInfo) {
      throw wireError(404, "mls-missing-group-info");
    }
    return this.groupInfo;
  }

  async getMLSOneToOne(_user: TWireQualifiedID): Promise<TWireMLSOneToOne> {
    return this.oneToOne;
  }
}

/** `WireSession`, as far as `WireMLSService` uses it */
class FakeSession {
  userID = kUserID;
  domain = kDomain;
  clientID = kClientID;
  /** The `mls_public_keys` that `POST /clients` registered */
  registered: Record<string, string> | null = null;

  async ensureClient(mlsPublicKeys: Record<string, string>): Promise<void> {
    this.registered = mlsPublicKeys;
  }
}

/** One device of one user, as the backend holds it */
interface FakeDevice {
  user: TWireQualifiedID;
  clientID: string;
  client: MLSClient;
}

/** What `WireChatRoom` has to be, for `WireMLSService` */
class FakeRoom implements WireMLSRoom {
  readonly qualifiedID: TWireQualifiedID;
  groupID: string | null = null;
  mlsGroupJSON: any = null;
  saves = 0;

  constructor(qualifiedID: TWireQualifiedID) {
    this.qualifiedID = qualifiedID;
  }

  async save(): Promise<void> {
    this.saves++;
  }
}

/** §7.2: the bundle is a stream of `MLSMessage`s, read until the bytes run out */
function parseBundle(bundle: Uint8Array): MLSMessage[] {
  let reader = new TLSReader(bundle);
  let messages: MLSMessage[] = [];
  while (!reader.atEnd) {
    messages.push(MLSMessage.read(reader));
  }
  return messages;
}

/** What `WireTransport` throws for a `{code, label, message}` error body.
 * Duck-typed, as the error class does not survive JPC. */
function wireError(httpCode: number, label: string, data: any = null): any {
  return Object.assign(new Error(`Wire: HTTP ${httpCode}: ${label}`), { httpCode, label, data });
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function text(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

function hex(data: Uint8Array): string {
  return [...data].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

const kUserID = "d5a39ffb-6ce3-4cc8-9048-0e15d031b4c5";
const kClientID = "67f41928e2844b6c";
const kDomain = "wire.com";
const kBob: TWireQualifiedID = { id: "7025598b-ffac-4993-8a81-af3f35b7147f", domain: "other.example" };
const kConversation: TWireQualifiedID = { id: "537992e5-3782-4b6c-8718-a5db2cb786ee", domain: kDomain };
/** §3.2: arbitrary bytes, base64 in JSON. Never text. */
const kGroupID = base64Encode(randomBytes(32));
const kTime = "2026-01-02T03:04:05.678Z";
const kEmptyConversation: any = {
  type: 2, creator: null, name: null, team: null, access: [], access_role: [],
  message_timer: null, receipt_mode: null, members: { self: null, others: [] },
  protocol: "mls", epoch_timestamp: null, cipher_suite: null,
  group_conv_type: null, add_permission: null, cells_state: null,
};
