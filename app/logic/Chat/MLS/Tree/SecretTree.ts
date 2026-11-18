/** The message keys of one epoch, RFC 9420 § 9.
 *
 * The secret tree has the same shape as the group's ratchet tree, but holds
 * only symmetric secrets: the `encryption_secret` sits at the root, each parent
 * hands a secret down to its two children, and every leaf starts two hash
 * ratchets, one for handshake messages and one for application messages. Each
 * member encrypts with the ratchets of their own leaf, and decrypts with the
 * ratchets of the sender's leaf.
 *
 * Everything is derived lazily and cached: a group of 1000 members would
 * otherwise cost 2000 key derivations per epoch, for senders we never hear from.
 *
 * Keys are single use (§ 9.1). Once a generation has been handed out, this tree
 * will not hand it out again. Generations that a sender skips past are kept for
 * a while, because a message that arrives late still needs its key (§ 9.2). */
import type { CipherSuite } from "../Crypto/CipherSuite";
import { MLSError, utf8 } from "../util";

export class SecretTree {
  readonly suite: CipherSuite;
  /** Leaf slots, i.e. members including blanks. Always a power of two. */
  readonly leafCount: number;
  protected readonly depth: number;
  protected readonly senderDataSecret: Uint8Array;
  /** Node index (Appendix C) → secret, for the part of the tree we walked.
   * A node is dropped as soon as its children have their secrets, § 9.2. */
  protected readonly nodeSecrets = new Map<number, Uint8Array>();
  protected readonly leafRatchets = new Map<number, LeafRatchets>();

  /** @param leafCount the ratchet tree's leaf count, blank leaves included
   * @param senderDataSecret for `senderDataKey()`, which is not part of the
   *   tree, but is the other half of protecting a PrivateMessage */
  constructor(suite: CipherSuite, leafCount: number, encryptionSecret: Uint8Array, senderDataSecret: Uint8Array) {
    this.suite = suite;
    this.depth = depthFor(leafCount);
    this.leafCount = 1 << this.depth;
    this.senderDataSecret = senderDataSecret;
    this.nodeSecrets.set(this.leafCount - 1, encryptionSecret); // the root, Appendix C
  }

  /** Consumes the ratchet up to `generation`; keys are single use. */
  handshakeKey(leafIndex: number, generation: number): MessageKey {
    return this.ratchets(leafIndex).handshake.key(generation);
  }

  applicationKey(leafIndex: number, generation: number): MessageKey {
    return this.ratchets(leafIndex).application.key(generation);
  }

  /** The next generation we will send with, and it advances. */
  nextHandshakeKey(leafIndex: number): MessageKey & { generation: number } {
    return this.ratchets(leafIndex).handshake.next();
  }

  nextApplicationKey(leafIndex: number): MessageKey & { generation: number } {
    return this.ratchets(leafIndex).application.next();
  }

  /** RFC 9420 § 6.3.2: the key and nonce for the SenderData of a PrivateMessage,
   * derived from a sample of the message's own content ciphertext. That sample
   * is what makes the nonce unique, so it is not XORed with a reuse guard.
   * @param ciphertext `PrivateMessage.ciphertext`, of which the first `KDF.Nh`
   *   bytes are the sample, or all of it if it is shorter */
  senderDataKey(ciphertext: Uint8Array): MessageKey {
    let sample = ciphertext.subarray(0, this.suite.secretLength);
    return {
      key: this.suite.expandWithLabel(this.senderDataSecret, "key", sample, this.suite.aead.keyLength),
      nonce: this.suite.expandWithLabel(this.senderDataSecret, "nonce", sample, this.suite.aead.nonceLength),
    };
  }

  /** Both ratchets of one leaf, derived on first use, RFC 9420 § 9 Figure 26 */
  protected ratchets(leafIndex: number): LeafRatchets {
    let ratchets = this.leafRatchets.get(leafIndex);
    if (!ratchets) {
      ratchets = new LeafRatchets(this.suite, this.leafSecret(leafIndex));
      this.leafRatchets.set(leafIndex, ratchets);
    }
    return ratchets;
  }

  /** Walks from the root down to the leaf, RFC 9420 § 9 Figure 25. Both
   * children are derived at each step, because the sibling subtree holds the
   * other members' leaves, and the parent is then dropped. A node we already
   * walked through on the way to another leaf is skipped: its secret is gone,
   * but its children have theirs. */
  protected leafSecret(leafIndex: number): Uint8Array {
    if (leafIndex < 0 || leafIndex >= this.leafCount) {
      throw new MLSError(`Leaf ${leafIndex} is outside a secret tree of ${this.leafCount} leaves`);
    }
    let node = this.leafCount - 1;
    for (let level = this.depth; level > 0; level--) {
      let step = 1 << (level - 1);
      let secret = this.nodeSecrets.get(node);
      if (secret) {
        let length = this.suite.secretLength;
        this.nodeSecrets.delete(node);
        this.nodeSecrets.set(node - step, this.suite.expandWithLabel(secret, "tree", kLeft, length));
        this.nodeSecrets.set(node + step, this.suite.expandWithLabel(secret, "tree", kRight, length));
      }
      node = (leafIndex >> (level - 1)) & 1 ? node + step : node - step;
    }
    return this.takeNodeSecret(node);
  }

  protected takeNodeSecret(node: number): Uint8Array {
    let secret = this.nodeSecrets.get(node);
    if (!secret) {
      throw new MLSError(`The secret of secret tree node ${node} was already consumed`);
    }
    this.nodeSecrets.delete(node);
    return secret;
  }
}

/** One AEAD key with its nonce, for a single message */
export interface MessageKey {
  key: Uint8Array;
  nonce: Uint8Array;
}

/** The two ratchets that a leaf's secret starts, RFC 9420 § 9 Figure 26.
 * They are created together, because deriving them consumes the leaf secret. */
class LeafRatchets {
  readonly handshake: Ratchet;
  readonly application: Ratchet;

  constructor(suite: CipherSuite, leafSecret: Uint8Array) {
    this.handshake = new Ratchet(suite, suite.expandWithLabel(leafSecret, "handshake", kNoBytes, suite.secretLength));
    this.application = new Ratchet(suite, suite.expandWithLabel(leafSecret, "application", kNoBytes, suite.secretLength));
  }
}

/** One sender ratchet, RFC 9420 § 9.1: the sequence of single-use key/nonce
 * pairs that one member uses for one content type in one epoch. */
class Ratchet {
  protected readonly suite: CipherSuite;
  protected secret: Uint8Array;
  protected generation = 0;
  /** Generation → key that we ratcheted past without using it, for messages
   * that arrive out of order */
  protected readonly unused = new Map<number, MessageKey>();

  constructor(suite: CipherSuite, secret: Uint8Array) {
    this.suite = suite;
    this.secret = secret;
  }

  /** The key of one particular generation, for a message we received. The
   * ratchet forgets it afterwards, and keeps the generations we skipped over. */
  key(generation: number): MessageKey {
    let unused = this.unused.get(generation);
    if (unused) {
      this.unused.delete(generation);
      return unused;
    }
    if (generation < this.generation) {
      throw new MLSError(`The message key of generation ${generation} was already used or forgotten`);
    }
    if (generation - this.generation > kMaxSkippedGenerations) {
      throw new MLSError(`Message skips ${generation - this.generation} generations of the sender ratchet`);
    }
    while (this.generation < generation) {
      let skipped = this.next();
      this.unused.set(skipped.generation, skipped);
    }
    this.forgetOldest();
    return this.next();
  }

  /** The key of the next unused generation, for a message we are sending */
  next(): MessageKey & { generation: number } {
    let generation = this.generation;
    let key = this.suite.deriveTreeSecret(this.secret, "key", generation, this.suite.aead.keyLength);
    let nonce = this.suite.deriveTreeSecret(this.secret, "nonce", generation, this.suite.aead.nonceLength);
    this.secret = this.suite.deriveTreeSecret(this.secret, "secret", generation, this.suite.secretLength);
    this.generation = generation + 1;
    return { generation, key, nonce };
  }

  /** Bounds what a sender who skips generations can make us hold on to.
   * The map is in insertion order, so the oldest generations come first. */
  protected forgetOldest(): void {
    for (let generation of this.unused.keys()) {
      if (this.unused.size <= kMaxUnusedKeys) {
        return;
      }
      this.unused.delete(generation);
    }
  }
}

/** The depth of the perfect tree that holds `leafCount` leaves. Every MLS tree
 * is perfect, RFC 9420 § 4.1, so a caller's odd leaf count rounds up. */
function depthFor(leafCount: number): number {
  let depth = 0;
  while (1 << depth < leafCount) {
    depth++;
  }
  return depth;
}

/** RFC 9420 § 15.3: a member could otherwise claim generation 0xFFFFFFFF and
 * make everyone else derive billions of keys. */
const kMaxSkippedGenerations = 1000;
/** How many keys of skipped generations we hold, for late messages */
const kMaxUnusedKeys = 1000;
const kLeft = utf8("left");
const kRight = utf8("right");
const kNoBytes = new Uint8Array(0);
