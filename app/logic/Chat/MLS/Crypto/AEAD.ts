/** The AEAD half of an MLS cipher suite, RFC 9420 § 5.1, RFC 9180 § 7.3.
 *
 * MLS treats the authentication tag as part of the ciphertext, so `seal()`
 * returns plaintext + tag and `open()` expects the same. */
import { gcm } from "@noble/ciphers/aes.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";

export abstract class AEAD {
  /** The HPKE `aead_id` code point, RFC 9180 § 7.3 */
  abstract readonly id: number;
  /** `Nk`: key length in bytes */
  abstract readonly keyLength: number;
  /** `Nn`: nonce length in bytes */
  abstract readonly nonceLength: number;
  /** `Nt`: authentication tag length in bytes */
  readonly tagLength: number = 16;

  abstract seal(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): Uint8Array;
  /** @throws if the tag does not verify */
  abstract open(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, ciphertext: Uint8Array): Uint8Array;
}

export class AESGCM extends AEAD {
  readonly id: number;
  readonly keyLength: number;
  readonly nonceLength = 12;

  /** @param keyLength 16 for AES-128-GCM, 32 for AES-256-GCM */
  constructor(keyLength: number) {
    super();
    this.keyLength = keyLength;
    this.id = keyLength == 16 ? 0x0001 : 0x0002;
  }

  seal(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): Uint8Array {
    return gcm(key, nonce, aad).encrypt(plaintext);
  }

  open(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    return gcm(key, nonce, aad).decrypt(ciphertext);
  }
}

export class ChaCha20Poly1305 extends AEAD {
  readonly id = 0x0003;
  readonly keyLength = 32;
  readonly nonceLength = 12;

  seal(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): Uint8Array {
    return chacha20poly1305(key, nonce, aad).encrypt(plaintext);
  }

  open(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    return chacha20poly1305(key, nonce, aad).decrypt(ciphertext);
  }
}
