// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Person } from "../../../../logic/Abstract/Person";
import { WhatsAppPairing } from "../../../../logic/Chat/WhatsApp/WhatsAppPairing";
import { WhatsAppAccount } from "../../../../logic/Chat/WhatsApp/WhatsAppAccount";
import { WhatsAppConnection, kConnectionHeader, type WhatsAppTransport } from "../../../../logic/Chat/WhatsApp/WhatsAppConnection";
import { NoiseHandshake, NoiseTransport } from "../../../../logic/Chat/WhatsApp/Crypto/Noise";
import { KeyPair } from "../../../../logic/Chat/Signal/Crypto/KeyPair";
import { xeddsaSign, xeddsaVerify } from "../../../../logic/Chat/Signal/Crypto/curve";
import { hmacSHA256, concatBytes, base64Decode } from "../../../../logic/Chat/Signal/Crypto/primitives";
import { encode, decode } from "../../../../logic/Chat/Signal/Proto/codec";
import {
  encodeHandshakeMessage, decodeHandshakeMessage,
  CertChain, ClientPayload, type DevicePairingRegistrationData,
  ADVSignedDeviceIdentityHMAC, ADVSignedDeviceIdentity, ADVDeviceIdentity,
} from "../../../../logic/Chat/WhatsApp/Proto/handshakeSchema";
import { ProtoWriter } from "../../../../logic/Chat/Signal/Proto/ProtobufLite";
import { SignalStore } from "../../../../logic/Chat/Signal/Crypto/Store";
import { WANode } from "../../../../logic/Chat/WhatsApp/Binary/WANode";
import { encodeNode } from "../../../../logic/Chat/WhatsApp/Binary/encoder";
import { decodeNode } from "../../../../logic/Chat/WhatsApp/Binary/decoder";
import { JID } from "../../../../logic/Chat/WhatsApp/Binary/JID";
import { getLoginPayload } from "../../../../logic/Chat/WhatsApp/clientInfo";
import { expect, test } from "vitest";

appGlobal.me = new Person(); // as `startup.ts` does

const kAccountSignaturePrefix = new Uint8Array([6, 0]);
const kDeviceSignaturePrefix = new Uint8Array([6, 1]);
const kPairedJID = "15551234567:3@s.whatsapp.net";

/** One end of an in-memory byte pipe. Whatever one end sends, the other receives. */
class MockChannel implements WhatsAppTransport {
  other!: MockChannel;
  protected dataCB: ((data: Uint8Array) => void) | null = null;
  protected closeCB: (() => void) | null = null;

  async connect(): Promise<void> {
  }
  async send(data: Uint8Array): Promise<void> {
    let copy = data.slice();
    queueMicrotask(() => this.other.dataCB?.(copy));
  }
  onData(cb: (data: Uint8Array) => void): void {
    this.dataCB = cb;
  }
  onClose(cb: () => void): void {
    this.closeCB = cb;
  }
  async close(): Promise<void> {
    this.closeCB?.();
  }
}

function linkedChannels(): [MockChannel, MockChannel] {
  let a = new MockChannel();
  let b = new MockChannel();
  a.other = b;
  b.other = a;
  return [a, b];
}

function encodeDetails(serial: number, issuerSerial: number, key: Uint8Array): Uint8Array {
  let writer = new ProtoWriter().varint(1, serial);
  if (issuerSerial) {
    writer.varint(2, issuerSerial);
  }
  return writer.bytes(3, key).finish();
}

/** root signs intermediate, intermediate signs leaf, leaf pins the server static key. */
function buildCertChain(root: KeyPair, serverStatic: KeyPair): Uint8Array {
  let intermediate = KeyPair.generate();
  let intermediateDetails = encodeDetails(100, 0, intermediate.publicKey);
  let leafDetails = encodeDetails(200, 100, serverStatic.publicKey);
  return encode(CertChain, {
    leaf: { details: leafDetails, signature: xeddsaSign(intermediate.privateKey, leafDetails) },
    intermediate: { details: intermediateDetails, signature: xeddsaSign(root.privateKey, intermediateDetails) },
  });
}

/** The WhatsApp server side of the Noise handshake, then whatever the subclass
 * does once the encrypted channel is up. */
abstract class MockServer {
  readonly serverStatic = KeyPair.generate();
  protected serverEphemeral = KeyPair.generate();
  protected noise = new NoiseHandshake();
  protected cipher: NoiseTransport | null = null;
  protected channel: MockChannel | null = null;
  protected gotHeader = false;
  protected sawClientHello = false;
  protected queue: Promise<void> = Promise.resolve();
  protected certChain: Uint8Array;
  receivedClientPayload: Uint8Array | null = null;

  constructor(root: KeyPair) {
    this.certChain = buildCertChain(root, this.serverStatic);
  }

  attach(channel: MockChannel) {
    this.channel = channel;
    channel.onData(data => this.onData(data));
  }

  protected onData(data: Uint8Array) {
    let buf = data;
    if (!this.gotHeader) {
      buf = buf.subarray(kConnectionHeader.length);
      this.gotHeader = true;
    }
    let length = (buf[0] << 16) | (buf[1] << 8) | buf[2];
    let payload = buf.subarray(3, 3 + length).slice();
    this.queue = this.queue.then(() => this.handleFrame(payload));
  }

  protected async handleFrame(payload: Uint8Array) {
    if (this.cipher) {
      return await this.handleStanza(payload);
    }
    if (!this.sawClientHello) {
      this.sawClientHello = true;
      return await this.handleClientHello(payload);
    }
    return await this.handleClientFinish(payload);
  }

  protected async handleClientHello(payload: Uint8Array) {
    let clientEphemeral = decodeHandshakeMessage(payload).clientHello!.ephemeral!;
    this.noise.start(kConnectionHeader);
    this.noise.mixHash(clientEphemeral);
    this.noise.mixHash(this.serverEphemeral.publicKey);
    await this.noise.mixKeyDH(this.serverEphemeral.privateKey, clientEphemeral);
    let encStatic = await this.noise.encryptAndHash(this.serverStatic.publicKey);
    await this.noise.mixKeyDH(this.serverStatic.privateKey, clientEphemeral);
    let encCert = await this.noise.encryptAndHash(this.certChain);
    await this.sendFrame(encodeHandshakeMessage({
      serverHello: { ephemeral: this.serverEphemeral.publicKey, static: encStatic, payload: encCert },
    }));
  }

  protected async handleClientFinish(payload: Uint8Array) {
    let finish = decodeHandshakeMessage(payload).clientFinish!;
    let clientStatic = await this.noise.decryptAndHash(finish.static!);
    await this.noise.mixKeyDH(this.serverEphemeral.privateKey, clientStatic);
    this.receivedClientPayload = await this.noise.decryptAndHash(finish.payload!);
    let split = this.noise.split();
    this.cipher = new NoiseTransport(split.read, split.write); // server swaps write/read
    await this.afterHandshake();
  }

  protected abstract afterHandshake(): Promise<void>;
  protected async handleStanza(_payload: Uint8Array): Promise<void> {
  }

  protected async sendStanza(node: WANode) {
    let nodeBytes = encodeNode(node);
    let body = new Uint8Array(1 + nodeBytes.length); // body[0] = 0: not compressed
    body.set(nodeBytes, 1);
    await this.sendFrame(await this.cipher!.encrypt(body));
  }

  protected async decodeStanza(payload: Uint8Array): Promise<WANode> {
    return decodeNode((await this.cipher!.decrypt(payload)).subarray(1));
  }

  protected async sendFrame(payload: Uint8Array) {
    let frame = new Uint8Array(3 + payload.length);
    frame[0] = (payload.length >> 16) & 0xFF;
    frame[1] = (payload.length >> 8) & 0xFF;
    frame[2] = payload.length & 0xFF;
    frame.set(payload, 3);
    await this.channel!.send(frame);
  }
}

/** Plays the server *and* the user's phone for companion pairing. */
class MockPairingServer extends MockServer {
  readonly accountKey = KeyPair.generate(); // stands in for the user's phone identity
  readonly refs = ["REF-CODE-ONE", "REF-CODE-TWO"];
  /** The advSecret the phone "read" from the QR; set by the test before pairing. */
  advSecret!: Uint8Array;
  signReply: WANode | null = null;
  protected signResolve!: () => void;
  readonly gotSignReply = new Promise<void>(resolve => this.signResolve = resolve);
  protected companionIdentity!: Uint8Array;

  protected async afterHandshake() {
    let regData = decode(ClientPayload, this.receivedClientPayload!).devicePairingData as DevicePairingRegistrationData;
    this.companionIdentity = regData.eIdent!;
    await this.sendStanza(new WANode("iq", { from: "s.whatsapp.net", type: "set", id: "pd-1" }, [
      new WANode("pair-device", {}, this.refs.map(ref => new WANode("ref", {}, ref))),
    ]));
  }

  protected async handleStanza(payload: Uint8Array) {
    let node = await this.decodeStanza(payload);
    if (node.tag != "iq") {
      return;
    }
    if (node.child("pair-device-sign")) {
      this.signReply = node;
      this.signResolve();
      await this.sendStanza(new WANode("stream:error", { code: "515" })); // restart the stream, as the real server does
    } else if (node.attrs.type == "result") {
      await this.sendStanza(this.buildPairSuccess()); // ack to <pair-device>; confirm as the phone
    }
  }

  /** Builds the signed device identity the way the user's phone would. */
  buildPairSuccess(): WANode {
    let details = encode(ADVDeviceIdentity, { rawID: 11, timestamp: 1718200000, keyIndex: 0, accountType: 0, deviceType: 0 });
    let accountSignature = xeddsaSign(this.accountKey.privateKey,
      concatBytes(kAccountSignaturePrefix, details, this.companionIdentity));
    let signed = encode(ADVSignedDeviceIdentity, {
      details,
      accountSignatureKey: this.accountKey.publicKey,
      accountSignature,
    });
    let hmac = hmacSHA256(this.advSecret, signed);
    let envelope = encode(ADVSignedDeviceIdentityHMAC, { details: signed, hmac });
    return new WANode("iq", { from: "s.whatsapp.net", type: "set", id: "ps-1" }, [
      new WANode("pair-success", {}, [
        new WANode("device-identity", {}, envelope),
        new WANode("device", { jid: kPairedJID }),
        new WANode("platform", { name: "android" }),
      ]),
    ]);
  }
}

/** A server that just completes the handshake and returns `<success>`. */
class MockLoginServer extends MockServer {
  protected async afterHandshake() {
    await this.sendStanza(new WANode("success", {}));
  }
}

/** A WhatsAppAccount whose live connection trusts a test root certificate. */
class TestWhatsAppAccount extends WhatsAppAccount {
  rootCertKey!: Uint8Array;
  protected createConnection(): WhatsAppConnection {
    let connection = new WhatsAppConnection({ noiseKey: this.noiseKey! });
    connection.rootCertKey = this.rootCertKey;
    return connection;
  }
}

test("registers as a companion device end to end (QR → pair-success → device signature)", async () => {
  let root = KeyPair.generate();
  let server = new MockPairingServer(root);
  let [clientChannel, serverChannel] = linkedChannels();
  server.attach(serverChannel);

  let creds = WhatsAppPairing.newCredentials();
  server.advSecret = creds.advSecret; // the phone "scanned" this from the QR
  let pairing = new WhatsAppPairing(creds);
  pairing.connection.rootCertKey = root.publicKey; // trust the test root

  let qrCodes: string[] = [];
  pairing.onQR = qr => qrCodes.push(qr);
  let pairingStarted = 0;
  pairing.onPairing = () => pairingStarted++;

  let jid = await pairing.register(clientChannel);

  expect(jid.toString()).toBe(kPairedJID);
  expect(pairingStarted).toBe(1); // fired once, when <pair-success> arrived

  // The QR string is exactly ref,noisePub,identityPub,advSecret.
  expect(qrCodes.length).toBe(1);
  let [ref, noiseB64, identityB64, advB64] = qrCodes[0].split(",");
  expect(ref).toBe(server.refs[0]);
  expect(base64Decode(noiseB64)).toEqual(creds.noiseKey.publicKey);
  expect(base64Decode(identityB64)).toEqual(creds.signalStore.identityKeyPair.publicKey);
  expect(base64Decode(advB64)).toEqual(creds.advSecret);

  // The registration payload offered our real Signal key bundle.
  let regData = decode(ClientPayload, server.receivedClientPayload!).devicePairingData as DevicePairingRegistrationData;
  expect(regData.eKeytype).toEqual(new Uint8Array([5]));
  expect(regData.eIdent).toEqual(creds.signalStore.identityKeyPair.publicKey);
  expect(regData.eRegid!.length).toBe(4);
  expect((regData.eRegid![2] << 8) | regData.eRegid![3]).toBe(creds.signalStore.registrationID);

  // The client replied with a correctly counter-signed device identity.
  await server.gotSignReply;
  let signNode = server.signReply!.child("pair-device-sign")!.child("device-identity")!;
  expect(signNode.attrs["key-index"]).toBe("0");
  let reply = decode(ADVSignedDeviceIdentity, signNode.contentBytes!);
  expect(reply.accountSignatureKey).toBeUndefined(); // stripped from the reply
  let deviceMsg = concatBytes(kDeviceSignaturePrefix, reply.details!,
    creds.signalStore.identityKeyPair.publicKey, server.accountKey.publicKey);
  expect(xeddsaVerify(creds.signalStore.identityKeyPair.publicKey, deviceMsg, reply.deviceSignature!)).toBe(true);
});

test("rejects a pair-success whose HMAC does not match the advSecret", async () => {
  let root = KeyPair.generate();
  let server = new MockPairingServer(root);
  let [clientChannel, serverChannel] = linkedChannels();
  server.attach(serverChannel);

  let creds = WhatsAppPairing.newCredentials();
  server.advSecret = new Uint8Array(32).fill(9); // wrong secret → HMAC mismatch
  let pairing = new WhatsAppPairing(creds);
  pairing.connection.rootCertKey = root.publicKey;

  await expect(pairing.register(clientChannel)).rejects.toThrow(/HMAC mismatch/);
});

test("the login payload carries the paired phone number and device id", () => {
  let jid = JID.parse(kPairedJID);
  let payload = decode(ClientPayload, encode(ClientPayload, getLoginPayload(Number(jid.user), jid.device)));
  expect(payload.username).toBe(15551234567);
  expect(payload.device).toBe(3);
  expect(payload.passive).toBe(true);
});

test("logs in after pairing using the device JID, reaching <success>", async () => {
  let root = KeyPair.generate();
  let server = new MockLoginServer(root);
  let [clientChannel, serverChannel] = linkedChannels();
  server.attach(serverChannel);

  let account = new TestWhatsAppAccount();
  account.rootCertKey = root.publicKey;
  account.noiseKey = KeyPair.generate();
  account.signalStore = SignalStore.createNew();
  account.advSecret = new Uint8Array(32);
  account.deviceJID = JID.parse(kPairedJID);

  await account.connect(clientChannel);

  expect(account.isOnline).toBe(true);
  let payload = decode(ClientPayload, server.receivedClientPayload!);
  expect(payload.username).toBe(15551234567);
  expect(payload.device).toBe(3);
});

test("config JSON round-trips the pairing credentials", () => {
  let account = new WhatsAppAccount();
  (account.id as any) = "wa-test-1";
  account.noiseKey = KeyPair.generate();
  account.signalStore = SignalStore.createNew();
  account.advSecret = new Uint8Array(32).fill(7);
  account.deviceJID = JID.parse(kPairedJID);

  let restored = new WhatsAppAccount();
  restored.fromConfigJSON(account.toConfigJSON());

  expect(restored.deviceJID!.toString()).toBe(kPairedJID);
  expect(restored.noiseKey!.privateKey).toEqual(account.noiseKey.privateKey);
  expect(restored.advSecret).toEqual(account.advSecret);
  expect(restored.signalStore!.registrationID).toBe(account.signalStore.registrationID);
  expect(restored.signalStore!.identityKeyPair.privateKey).toEqual(account.signalStore.identityKeyPair.privateKey);
  expect(restored.signalStore!.signedPreKeys.get(1)!.signature)
    .toEqual(account.signalStore.signedPreKeys.get(1)!.signature);
  expect(restored.signalStore!.preKeys.size).toBe(account.signalStore.preKeys.size);
});
