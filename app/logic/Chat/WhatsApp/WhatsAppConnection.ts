/** Orchestrates the WhatsApp client connection: the Noise handshake, the
 * encrypted frame transport, and reading/writing binary XMPP stanzas.
 *
 * This ties together the tested lower layers (Noise, WABinary, protobuf). The
 * live network path runs only when the desktop backend's TCP socket factory is
 * available (see isWhatsAppLiveAvailable()); unit tests and web builds have no
 * such socket, so they inject a transport instead. The cryptographic and
 * encoding pieces it depends on are unit-tested, but the full end-to-end
 * handshake against the real server still needs live iteration (current
 * app-version string, edge-routing, prekey upload, success/failure handling). */
import { NoiseHandshake, NoiseTransport } from "./Crypto/Noise";
import { KeyPair } from "../Signal/Crypto/KeyPair";
import { xeddsaVerify } from "../Signal/Crypto/curve";
import { bytesEqual } from "../Signal/Crypto/primitives";
import { WANode } from "./Binary/WANode";
import { encodeNode } from "./Binary/encoder";
import { decodeNode } from "./Binary/decoder";
import {
  encodeHandshakeMessage, decodeHandshakeMessage, encodeClientPayload, decodeCertChain,
  kWaCertPublicKey, type ClientPayload,
} from "./Proto/handshakeSchema";
import { readProto, getBytes, getInt } from "../Signal/Proto/ProtobufLite";
import { waLog, nodePreview } from "./util";
import { appGlobal } from "../../app";
import { assert } from "../../util/util";

export class WhatsAppConnection {
  protected transport: WhatsAppTransport;
  protected noise = new NoiseHandshake();
  protected cipher: NoiseTransport | null = null;
  protected keys: ConnectionKeys;
  /** Bytes received but not yet split into complete frames. */
  protected inbound = new Uint8Array(0);
  protected sentHeader = false;
  protected iqCounter = 0;
  protected pendingIQs = new Map<string, (node: WANode) => void>();

  /** Called for every incoming stanza that is not an IQ response. */
  onStanza: (node: WANode) => void = () => undefined;

  /** WhatsApp's pinned Noise root certificate key. A field (not the bare const)
   * only so tests can drive the handshake with their own root; production never
   * changes it. */
  rootCertKey: Uint8Array = kWaCertPublicKey;

  constructor(keys: ConnectionKeys) {
    this.keys = keys;
  }

  /** Performs the Noise handshake and sends the ClientPayload. `buildPayload`
   * returns the ClientPayload protobuf object (login or registration form).
   * `transport` is injectable for tests; production passes none and the live
   * socket factory must be available (see createWhatsAppTransport()). */
  async connect(buildPayload: () => ClientPayload, transport?: WhatsAppTransport): Promise<void> {
    this.transport = transport ?? await createWhatsAppTransport();
    this.transport.onData(data => this.onTransportData(data));
    this.transport.onClose(() => this.onStanza(new WANode("stream:error")));
    await this.transport.connect();

    let clientEphemeral = KeyPair.generate();
    this.noise.start(kConnectionHeader);
    this.noise.mixHash(clientEphemeral.publicKey);

    let clientHello = encodeHandshakeMessage({ clientHello: { ephemeral: clientEphemeral.publicKey } });
    await this.sendFrame(clientHello, true);

    let serverHelloFrame = await this.readHandshakeFrame();
    let serverHello = decodeHandshakeMessage(serverHelloFrame).serverHello!;

    this.noise.mixHash(serverHello.ephemeral);
    await this.noise.mixKeyDH(clientEphemeral.privateKey, serverHello.ephemeral);
    let serverStatic = await this.noise.decryptAndHash(serverHello.static!);
    await this.noise.mixKeyDH(clientEphemeral.privateKey, serverStatic);
    let certPayload = await this.noise.decryptAndHash(serverHello.payload!);
    this.verifyServerCertificate(certPayload, serverStatic);

    let encStatic = await this.noise.encryptAndHash(this.keys.noiseKey.publicKey);
    await this.noise.mixKeyDH(this.keys.noiseKey.privateKey, serverHello.ephemeral!);
    let payloadBytes = encodeClientPayload(buildPayload());
    let encPayload = await this.noise.encryptAndHash(payloadBytes);

    let clientFinish = encodeHandshakeMessage({ clientFinish: { static: encStatic, payload: encPayload } });
    await this.sendFrame(clientFinish, false);

    let split = this.noise.split();
    this.cipher = new NoiseTransport(split.write, split.read);
    // The first encrypted frame is the <success> or <failure> stanza, handled
    // by the read loop via onStanza.
  }

  /** Verifies the server's static key against WhatsApp's pinned root certificate.
   * Walks the full chain the same way the real client does: the pinned root
   * signs the intermediate, the intermediate signs the leaf, the serials chain,
   * and the leaf's pinned key (Details field 3) is the server's static key.
   * (Details fields: serial=1, issuerSerial=2, key=3.) */
  protected verifyServerCertificate(certPayload: Uint8Array, serverStatic: Uint8Array) {
    let chain = decodeCertChain(certPayload);
    let intermediate = chain.intermediate!;
    let leaf = chain.leaf!;
    if (!xeddsaVerify(this.rootCertKey, intermediate.details!, intermediate.signature!)) {
      throw new Error("WhatsApp intermediate certificate signature invalid");
    }
    let intermediateFields = readProto(intermediate.details!);
    if ((getInt(intermediateFields, 2) ?? 0) != 0) {
      throw new Error("WhatsApp intermediate certificate is not root-issued");
    }
    let intermediateKey = getBytes(intermediateFields, 3);
    if (!intermediateKey || !xeddsaVerify(intermediateKey, leaf.details!, leaf.signature!)) {
      throw new Error("WhatsApp leaf certificate signature invalid");
    }
    let leafFields = readProto(leaf.details!);
    if ((getInt(leafFields, 2) ?? 0) != (getInt(intermediateFields, 1) ?? 0)) {
      throw new Error("WhatsApp leaf certificate does not chain to the intermediate");
    }
    let leafKey = getBytes(leafFields, 3);
    if (!leafKey || !bytesEqual(leafKey, serverStatic)) {
      throw new Error("WhatsApp server key does not match its certificate");
    }
  }

  /** Sends a binary XMPP stanza over the encrypted transport. */
  async sendNode(node: WANode): Promise<void> {
    if (!this.cipher) {
      throw new Error("Not connected");
    }
    waLog(">> send", nodePreview(node));
    let body = new Uint8Array(1 + encodeNode(node).length);
    body[0] = 0; // flag byte: not compressed
    body.set(encodeNode(node), 1);
    await this.sendFrame(await this.cipher.encrypt(body), false);
  }

  /** Sends an IQ and resolves with the matching response stanza, or rejects if
   * the server never answers (a malformed query the server silently drops must
   * not hang the caller forever). */
  async sendIQ(node: WANode, timeoutMs = 30000): Promise<WANode> {
    let id = node.attrs.id ?? this.nextIQID();
    node.attrs.id = id;
    let response = new Promise<WANode>((resolve, reject) => {
      let timer = setTimeout(() => {
        this.pendingIQs.delete(id);
        reject(new Error(`WhatsApp: IQ ${id} (${node.attrs.xmlns ?? node.tag}) timed out`));
      }, timeoutMs);
      (timer as any)?.unref?.();
      this.pendingIQs.set(id, reply => {
        clearTimeout(timer);
        resolve(reply);
      });
    });
    await this.sendNode(node);
    return await response;
  }

  nextIQID(): string {
    return `${Date.now()}-${this.iqCounter++}`;
  }

  protected async sendFrame(payload: Uint8Array, withHeader: boolean) {
    let headerLength = withHeader && !this.sentHeader ? kConnectionHeader.length : 0;
    let frame = new Uint8Array(headerLength + 3 + payload.length);
    let offset = 0;
    if (headerLength) {
      frame.set(kConnectionHeader, 0);
      offset = kConnectionHeader.length;
      this.sentHeader = true;
    }
    frame[offset] = (payload.length >> 16) & 0xFF;
    frame[offset + 1] = (payload.length >> 8) & 0xFF;
    frame[offset + 2] = payload.length & 0xFF;
    frame.set(payload, offset + 3);
    await this.transport.send(frame);
  }

  protected handshakeResolver: ((frame: Uint8Array) => void) | null = null;

  /** Waits for the next complete (still unencrypted) handshake frame. */
  protected readHandshakeFrame(): Promise<Uint8Array> {
    return new Promise(resolve => this.handshakeResolver = resolve);
  }

  protected onTransportData(data: Uint8Array) {
    let combined = new Uint8Array(this.inbound.length + data.length);
    combined.set(this.inbound);
    combined.set(data, this.inbound.length);
    this.inbound = combined;
    void this.drainFrames();
  }

  protected async drainFrames() {
    while (this.inbound.length >= 3) {
      let length = (this.inbound[0] << 16) | (this.inbound[1] << 8) | this.inbound[2];
      if (length > kMaxStanzaSize) {
        // A frame larger than the cap can only be hostile or corrupt; we cannot
        // trust the rest of the stream, so drop it and report a disconnect.
        console.error(`WhatsApp: frame of ${length} bytes exceeds the ${kMaxStanzaSize}-byte limit; closing the connection`);
        this.inbound = new Uint8Array(0);
        this.onStanza(new WANode("stream:error"));
        return;
      }
      if (this.inbound.length < 3 + length) {
        break;
      }
      let payload = this.inbound.subarray(3, 3 + length);
      this.inbound = this.inbound.subarray(3 + length).slice();
      try {
        if (this.handshakeResolver) {
          let resolve = this.handshakeResolver;
          this.handshakeResolver = null;
          resolve(payload.slice());
        } else if (this.cipher) {
          await this.handleEncryptedFrame(payload.slice());
        }
      } catch (ex) {
        // One malformed frame (bad decrypt, oversized/corrupt stanza) must not
        // kill the read loop or surface as an unhandled rejection. Frames are
        // length-prefixed and independent, so the next one still decodes.
        console.error("WhatsApp: failed to process incoming frame:", ex);
      }
    }
  }

  protected async handleEncryptedFrame(payload: Uint8Array) {
    let body = await this.cipher!.decrypt(payload);
    let flag = body[0];
    let nodeBytes = body.subarray(1);
    if (flag & 0x02) {
      nodeBytes = await inflate(nodeBytes);
    }
    let node = decodeNode(nodeBytes);
    let id = node.attrs.id;
    if (id && this.pendingIQs.has(id)) {
      waLog("<< recv (IQ response)", nodePreview(node));
      let resolve = this.pendingIQs.get(id)!;
      this.pendingIQs.delete(id);
      resolve(node);
    } else {
      waLog("<< recv", nodePreview(node));
      this.onStanza(node);
    }
  }

  async disconnect() {
    await this.transport?.close();
    this.cipher = null;
  }
}

// Android connection header: "WA" + magic byte 6 + WABinary dictionary version 3.
// The dictionary version must match the token tables in Binary/tokens.ts.
export const kConnectionHeader = new Uint8Array([0x57, 0x41, 6, 3]);

/** Global ceiling on a single stanza, enforced both on the on-wire frame length
 * and on the inflated size of a compressed frame. Stanzas carry only control
 * data and message text — media and history blobs travel over HTTP — so even
 * large ones stay well below this. The cap stops a hostile server from forcing
 * a huge allocation or a decompression bomb. */
const kMaxStanzaSize = 8 * 1024 * 1024; // 8 MiB

export interface ConnectionKeys {
  /** Persistent Noise static key (Curve25519). */
  noiseKey: KeyPair;
}

/** A raw byte transport to the WhatsApp server. On Android the real client uses
 * a plain TCP socket to g.whatsapp.net:443 (the Noise layer provides security,
 * so there is no TLS). */
export interface WhatsAppTransport {
  connect(): Promise<void>;
  send(data: Uint8Array): Promise<void>;
  /** Called with each chunk of received bytes. */
  onData(callback: (data: Uint8Array) => void): void;
  onClose(callback: () => void): void;
  close(): Promise<void>;
}

const kWhatsAppServerHost = "g.whatsapp.net";
const kWhatsAppServerPort = 443;

/** Opens the raw socket to the WhatsApp server. The desktop backend exposes only
 * a bare `net.Socket` (`newTCPSocket()`); all the adapting to our transport
 * interface happens here, on the renderer side, over JPC.
 * The endpoint is fixed: nothing the server sends can choose where we connect. */
async function createWhatsAppTransport(): Promise<WhatsAppTransport> {
  assert(isWhatsAppLiveAvailable(), "WhatsApp live connection is not available in this build");
  let socket = await appGlobal.remoteApp.newTCPSocket();
  return new RemoteSocketTransport(socket, kWhatsAppServerHost, kWhatsAppServerPort);
}

/** Whether the live server connection can run: it needs the desktop backend's
 * raw TCP socket factory, which the renderer reaches over JPC. Unit tests and
 * web builds have no such factory, so the live path is unavailable there. */
export function isWhatsAppLiveAvailable(): boolean {
  return !!(appGlobal.remoteApp as any)?.newTCPSocket;
}

/** Adapts a backend `net.Socket` (reached over JPC) to our transport interface.
 * `socket` is the JPC proxy; every method call and every `on(...)` callback
 * crosses the JPC boundary. We attach the listeners before calling `connect()`
 * so no event is missed (EventEmitters drop events fired before a listener
 * exists, and the JPC round-trips are not instant). */
export class RemoteSocketTransport implements WhatsAppTransport {
  /** True once we close it ourselves, so the resulting `close` is not reported
   * to the app as an unexpected disconnect. */
  protected closedByUs = false;

  constructor(protected socket: any, protected host: string, protected port: number) {
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      this.socket.on("connect", () => {
        settled = true;
        resolve();
      });
      this.socket.on("error", (ex: any) => {
        if (!settled) { // a post-connect error is followed by `close`, which notifies the app
          settled = true;
          reject(new Error(ex?.message ?? `Cannot connect to ${this.host}:${this.port}`));
        } else {
          console.error("WhatsApp: socket error:", ex?.message ?? ex);
        }
      });
      this.socket.connect(this.port, this.host);
    });
  }

  async send(data: Uint8Array): Promise<void> {
    await this.socket.write(data);
  }

  onData(callback: (data: Uint8Array) => void): void {
    this.socket.on("data", callback);
  }

  onClose(callback: () => void): void {
    this.socket.on("close", () => {
      if (!this.closedByUs) {
        callback();
      }
    });
  }

  async close(): Promise<void> {
    this.closedByUs = true;
    await this.socket.destroy();
  }
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  let stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
  /*
  // Read incrementally and abort once past the cap, so a small compressed frame
  // can't expand into a multi-gigabyte allocation (a decompression bomb).
  let reader = stream.getReader();
  let chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.length;
    if (total > kMaxStanzaSize) {
      await reader.cancel();
      throw new Error(`WhatsApp: decompressed stanza exceeds the ${kMaxStanzaSize}-byte limit`);
    }
    chunks.push(value);
  }
  let out = new Uint8Array(total);
  let offset = 0;
  for (let chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
  */
}
