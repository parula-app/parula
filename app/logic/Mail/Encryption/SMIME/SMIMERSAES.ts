// RSAES-PKCS1.5-v1_5 operations. See RFC8017 section 7.2
// https://datatracker.ietf.org/doc/html/rfc8017#section-7.2
// RFCs are Copyright (c) IETF Trust and their authors.
// Code components are licenced under the BSD licence.

/* BSD License

Copyright (c) IETF

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */

import type { RSAPublicKey, RSAPrivateKey } from "./SMIMEASN1";
import { uint8ArrayToHex } from "../../../util/blob";

export enum BlockType {
  Signed = 0x01,
  Encrypted = 0x02,
}

/**
 * Prefix FF PKCS1 padding bytes to data.
 */
export function padFF(data: Uint8Array, key: RSAPublicKey): Uint8Array {
  // k denotes the length in octets of the modulus n
  let k = key.n.toString(16).length + 1 >> 1;
  if (data.length > k - 11) {
    throw new Error("data too long for key modulus");
  }

  // Concatenate k - length - 3 FF octets.
  // em = [0x00, 0x01, ...0xFF, 0x00, ...data]
  let em = new Uint8Array(k);
  em[0] = 0x00;
  em[1] = BlockType.Signed;

  em.fill(0xFF, 2, k - data.length - 1);

  em.set(data, k - data.length);
  return em;
}

/**
 * Prefix random PKCS1 padding (a form of salting) to data.
 */
export function padRandom(data: Uint8Array, key: RSAPublicKey): Uint8Array {
  // k denotes the length in octets of the modulus n
  let k = key.n.toString(16).length + 1 >> 1;
  if (data.length > k - 11) {
    throw new Error("data too long for key modulus");
  }

  // Concatenate k - length - 3 pseudo-randomly generated nonzero octets.
  // em = [0x00, 0x02, ...ps, 0x00, ...data]
  let em = new Uint8Array(k);
  em[1] = BlockType.Encrypted;

  let randomNeeded = k - 3 - data.length;
  while (randomNeeded) {
    let randomNonZeroBytes = crypto.getRandomValues(new Uint8Array(randomNeeded)).filter(Boolean);
    em.set(randomNonZeroBytes, randomNeeded + 2 - randomNonZeroBytes.length);
    randomNeeded -= randomNonZeroBytes.length;
  }

  em.set(data, k - data.length);
  return em;
}

export function unpadPKCS(data: Uint8Array, blockType: BlockType): Uint8Array {
  if (data[0] != 0x00 || data[1] != blockType) {
    throw new Error("Decryption error");
  }
  let pos = data.indexOf(0x00, 2);
  if (pos < 10) {
    throw new Error("Decryption error");
  }
  if (blockType == BlockType.Signed) {
    // The padding of a signature block must be all 0xFF octets. RFC8017
    // requires this, and accepting other bytes here opens BERserk-style
    // signature forgeries against small-exponent (e.g. e=3) keys.
    for (let i = 2; i < pos; i++) {
      if (data[i] != 0xFF) {
        throw new Error("Decryption error");
      }
    }
  }
  return data.slice(pos + 1);
}

/**
 * Perform RSAES-PKCS1 encryption using a modulus and exponent.
 * This is not recommended for arbitrary messages,
 * but is acceptable for random keys such as 128-bit symmetric keys.
 */
export function encrypt(data: Uint8Array, key: RSAPublicKey): Uint8Array {
  // k denotes the length in octets of the modulus n
  let k = key.n.toString(16).length + 1 >> 1;
  if (data.length != k) {
    throw new Error("Decryption error");
  }

  // Convert the message to an integer message representative m.
  let m = UbigintFromHex(uint8ArrayToHex(data));

  // Apply the RASEP encryption primitive to the RSA public key and
  // message representative m to produce a ciphertext representative c.
  let c = UbigintModPow(m, key.e, key.n);

  // Convert the ciphertext representative c to a ciphertext of length k octets.
  return Uint8ArrayFromHex(UbigintToHex(c, k));
}

export function decrypt(data: Uint8Array, key: RSAPrivateKey) {
  // k denotes the length in octets of the modulus n
  let k = key.n.toString(16).length + 1 >> 1;
  if (data.length != k) {
    throw new Error("Decryption error");
  }

  // Convert the ciphertext to an integer ciphertext representative c.
  let c = UbigintFromHex(uint8ArrayToHex(data));
  if (c >= key.n) {
    throw new Error("Decryption error");
  }

  // Apply the RASEP decryption primitive to the RSA public key and
  // ciphertext representative c to produce a message representative m.
  // let m = UbigintModPow(c, key.d, key.n);
  let m1 = UbigintModPow(c % key.p, key.dP, key.p);
  let m2 = UbigintModPow(c % key.q, key.dQ, key.q);
  // Chinese Remainder Theorem
  // ironically uses modulus rather than remainder, and m1 might be less than m2
  let m = m2 + ((m1 - m2) * key.qInv % key.p + key.p) % key.p * key.q;

  // Convert the message representative m to a message of length k.
  return Uint8ArrayFromHex(UbigintToHex(m, k));
}

/**
 * Calculates v ** p % n but slightly more efficiently.
 * Assumes p and n are positive.
 *
 * Note: This is not constant-time and uses no blinding, so it is in principle
 * open to timing/padding-oracle attacks. That is an inherent limitation of a
 * hand-rolled bigint RSA (WebCrypto won't expose the raw RSA primitive we need
 * for CMS). A local mail client has no adaptive network oracle, and decrypt
 * errors are reported uniformly ("Decryption error"), so the practical risk is
 * low; do not reuse this for a server-side or network-facing decryption path.
 */
function UbigintModPow(v: bigint, p: bigint, n: bigint): bigint {
  let result = v;
  for (let digit of p.toString(2).slice(1)) {
    result = result * result % n;
    if (digit == "1") {
      result = result * v % n;
    }
  }
  return result;
}

function UbigintFromHex(hex: string): bigint {
  return BigInt("0x" + hex);
}

// k denotes the length in octets of the modulus n
function UbigintToHex(data: bigint, k: number): string {
  return data.toString(16).padStart(k * 2, "0");
}

function Uint8ArrayFromHex(hex: string): Uint8Array {
  return Uint8Array.fromHex?.(hex) ?? Uint8Array.from(hex.match(/../g), s => parseInt(s, 16));
}

declare global {
  interface Uint8ArrayConstructor {
    fromHex(hex: string): Uint8Array;
  }
}
