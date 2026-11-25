/** The hash-based half of an MLS cipher suite, RFC 9420 § 5.1.
 *
 * RFC 9420 lists the KDF, the hash and the MAC as three primitives, but every
 * cipher suite it defines builds all three on the same hash function, so they
 * live together here: HKDF (RFC 5869) for `extract`/`expand`, the bare hash for
 * tree and transcript hashes, and HMAC for the confirmation and membership tags.
 *
 * The labelled variants are elsewhere: MLS `ExpandWithLabel` on `CipherSuite`,
 * HPKE `LabeledExtract`/`LabeledExpand` on `HPKE`. */
import { extract, expand } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import type { CHash } from "@noble/hashes/utils.js";

export class KDF {
  /** The HPKE `kdf_id` code point, RFC 9180 § 7.2 */
  readonly id: number;
  /** `Nh`: the hash output size in bytes */
  readonly hashLength: number;
  protected readonly algorithm: CHash;

  protected constructor(id: number, algorithm: CHash, hashLength: number) {
    this.id = id;
    this.algorithm = algorithm;
    this.hashLength = hashLength;
  }

  static readonly hkdfSHA256 = new KDF(0x0001, sha256, 32);
  static readonly hkdfSHA384 = new KDF(0x0002, sha384, 48);
  static readonly hkdfSHA512 = new KDF(0x0003, sha512, 64);

  extract(salt: Uint8Array, ikm: Uint8Array): Uint8Array {
    return extract(this.algorithm, ikm, salt);
  }

  expand(prk: Uint8Array, info: Uint8Array, length: number): Uint8Array {
    return expand(this.algorithm, prk, info, length);
  }

  hash(data: Uint8Array): Uint8Array {
    return this.algorithm(data);
  }

  mac(key: Uint8Array, data: Uint8Array): Uint8Array {
    return hmac(this.algorithm, key, data);
  }
}
