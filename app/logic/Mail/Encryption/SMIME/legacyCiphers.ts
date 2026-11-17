// Triple DES (FIPS 46-3), RC2 (RFC 2268) and RC4.
// WebCrypto implements none of them, because they are all outdated, but
// .p12 files that were written by other mail apps still use them.
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

/**
 * Decrypts data that was encrypted with Triple DES in CBC mode.
 * @param key 24 bytes (3 keys) or 16 bytes (2 keys, the third being the first)
 * @param iv 8 bytes
 * @returns the plaintext, without the padding
 */
export function tripleDESDecrypt(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  if (key.length != 24 && key.length != 16) {
    throw new Error("Triple DES needs a 16 or 24 byte key");
  }
  let schedules = [
    keySchedule(key.subarray(0, 8)),
    keySchedule(key.subarray(8, 16)),
    keySchedule(key.length == 24 ? key.subarray(16, 24) : key.subarray(0, 8)),
  ];
  // Undoes E(key3, D(key2, E(key1, plaintext)))
  return decryptCBC(data, iv, block =>
    desBlock(desBlock(desBlock(block, schedules[2], true), schedules[1], false), schedules[0], true));
}

/**
 * Decrypts data that was encrypted with RC2 in CBC mode.
 * @param effectiveKeyBits how many bits of the key actually matter,
 *   e.g. 40 for the deliberately weakened export variant
 * @param iv 8 bytes
 * @returns the plaintext, without the padding
 */
export function rc2Decrypt(data: Uint8Array, key: Uint8Array, iv: Uint8Array, effectiveKeyBits: number): Uint8Array {
  let expandedKey = expandRC2Key(key, effectiveKeyBits);
  return decryptCBC(data, iv, block => rc2Block(block, expandedKey));
}

/** Decrypts data that was encrypted with RC4.
 * RC4 is a stream cipher, so this is the same operation as encrypting,
 * and there is neither an IV nor padding. */
export function rc4Decrypt(data: Uint8Array, key: Uint8Array): Uint8Array {
  if (!key.length) {
    throw new Error("RC4 needs a key");
  }
  let state = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    state[i] = i;
  }
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = j + state[i] + key[i % key.length] & 0xFF;
    [state[i], state[j]] = [state[j], state[i]];
  }
  let plaintext = new Uint8Array(data.length);
  let x = 0;
  let y = 0;
  for (let pos = 0; pos < data.length; pos++) {
    x = x + 1 & 0xFF;
    y = y + state[x] & 0xFF;
    [state[x], state[y]] = [state[y], state[x]];
    plaintext[pos] = data[pos] ^ state[state[x] + state[y] & 0xFF];
  }
  return plaintext;
}

/** Runs a block cipher in CBC mode, where each plaintext block was
 * XORed with the ciphertext block before it.
 * @param iv the block that the first block was XORed with
 * @returns the plaintext, without the padding */
function decryptCBC(data: Uint8Array, iv: Uint8Array, decryptBlock: (block: Uint8Array) => Uint8Array): Uint8Array {
  let blockLength = iv.length;
  if (!data.length || data.length % blockLength) {
    throw new Error("Ciphertext must be whole blocks");
  }
  let plaintext = new Uint8Array(data.length);
  let previous = iv;
  for (let pos = 0; pos < data.length; pos += blockLength) {
    let block = data.subarray(pos, pos + blockLength);
    let decrypted = decryptBlock(block);
    for (let i = 0; i < blockLength; i++) {
      plaintext[pos + i] = decrypted[i] ^ previous[i];
    }
    previous = block;
  }
  return unpadPKCS7(plaintext, blockLength);
}

/** Removes the padding that fills up the last block, RFC 5652 section 6.3.
 * A wrong passphrase practically always shows up here. */
function unpadPKCS7(plaintext: Uint8Array, blockLength: number): Uint8Array {
  let padding = plaintext[plaintext.length - 1];
  if (!padding || padding > blockLength) {
    throw new Error("Bad padding");
  }
  for (let i = plaintext.length - padding; i < plaintext.length; i++) {
    if (plaintext[i] != padding) {
      throw new Error("Bad padding");
    }
  }
  return plaintext.subarray(0, plaintext.length - padding);
}

/* Triple DES */

/** Runs the DES cipher on a single 8 byte block.
 * Decryption is the same operation, with the subkeys in reverse order. */
function desBlock(block: Uint8Array, subkeys: Uint8Array[], reverse: boolean): Uint8Array {
  let bits = permute(bytesToBits(block), kInitialPermutation);
  let left: Uint8Array = bits.slice(0, 32);
  let right: Uint8Array = bits.slice(32, 64);
  for (let round = 0; round < 16; round++) {
    let mixed = feistel(right, subkeys[reverse ? 15 - round : round]);
    for (let i = 0; i < 32; i++) {
      mixed[i] ^= left[i];
    }
    left = right;
    right = mixed;
  }
  // The halves are swapped one last time, i.e. the right half comes first
  let preOutput = new Uint8Array(64);
  preOutput.set(right, 0);
  preOutput.set(left, 32);
  return bitsToBytes(permute(preOutput, kFinalPermutation));
}

/** The DES round function: expand the half block, mix in the subkey,
 * and substitute each 6 bits by 4 bits */
function feistel(right: Uint8Array, subkey: Uint8Array): Uint8Array {
  let expanded = permute(right, kExpansion);
  let substituted = new Uint8Array(32);
  for (let box = 0; box < 8; box++) {
    let bits = new Uint8Array(6);
    for (let i = 0; i < 6; i++) {
      bits[i] = expanded[box * 6 + i] ^ subkey[box * 6 + i];
    }
    let row = bits[0] * 2 + bits[5];
    let column = bits[1] * 8 + bits[2] * 4 + bits[3] * 2 + bits[4];
    let value = kSubstitutionBoxes[box][row * 16 + column];
    for (let i = 0; i < 4; i++) {
      substituted[box * 4 + i] = value >> 3 - i & 1;
    }
  }
  return permute(substituted, kPermutation);
}

/** Derives the 16 round keys of 48 bits each from an 8 byte DES key.
 * The parity bits of the key are dropped. */
function keySchedule(key: Uint8Array): Uint8Array[] {
  let bits = permute(bytesToBits(key), kKeyPermutation);
  let left = bits.slice(0, 28);
  let right = bits.slice(28, 56);
  let subkeys: Uint8Array[] = [];
  for (let shift of kKeyShifts) {
    rotateLeft(left, shift);
    rotateLeft(right, shift);
    let combined = new Uint8Array(56);
    combined.set(left, 0);
    combined.set(right, 28);
    subkeys.push(permute(combined, kKeyCompression));
  }
  return subkeys;
}

function rotateLeft(bits: Uint8Array, count: number) {
  let start = bits.slice(0, count);
  bits.copyWithin(0, count);
  bits.set(start, bits.length - count);
}

/** Reorders bits, as listed in the given table. The table entries are
 * 1-based positions in the input, just as they are printed in FIPS 46-3. */
function permute(bits: Uint8Array, table: Uint8Array): Uint8Array {
  let permuted = new Uint8Array(table.length);
  for (let i = 0; i < table.length; i++) {
    permuted[i] = bits[table[i] - 1];
  }
  return permuted;
}

/** Splits bytes into one array entry per bit, most significant bit first */
function bytesToBits(bytes: Uint8Array): Uint8Array {
  let bits = new Uint8Array(bytes.length * 8);
  for (let i = 0; i < bits.length; i++) {
    bits[i] = bytes[i >> 3] >> 7 - (i & 7) & 1;
  }
  return bits;
}

function bitsToBytes(bits: Uint8Array): Uint8Array {
  let bytes = new Uint8Array(bits.length >> 3);
  for (let i = 0; i < bits.length; i++) {
    bytes[i >> 3] |= bits[i] << 7 - (i & 7);
  }
  return bytes;
}

const kInitialPermutation = Uint8Array.of(
  58, 50, 42, 34, 26, 18, 10, 2,
  60, 52, 44, 36, 28, 20, 12, 4,
  62, 54, 46, 38, 30, 22, 14, 6,
  64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1,
  59, 51, 43, 35, 27, 19, 11, 3,
  61, 53, 45, 37, 29, 21, 13, 5,
  63, 55, 47, 39, 31, 23, 15, 7);

const kFinalPermutation = Uint8Array.of(
  40, 8, 48, 16, 56, 24, 64, 32,
  39, 7, 47, 15, 55, 23, 63, 31,
  38, 6, 46, 14, 54, 22, 62, 30,
  37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28,
  35, 3, 43, 11, 51, 19, 59, 27,
  34, 2, 42, 10, 50, 18, 58, 26,
  33, 1, 41, 9, 49, 17, 57, 25);

/** Expands the 32 bit half block to the 48 bits of a round key */
const kExpansion = Uint8Array.of(
  32, 1, 2, 3, 4, 5,
  4, 5, 6, 7, 8, 9,
  8, 9, 10, 11, 12, 13,
  12, 13, 14, 15, 16, 17,
  16, 17, 18, 19, 20, 21,
  20, 21, 22, 23, 24, 25,
  24, 25, 26, 27, 28, 29,
  28, 29, 30, 31, 32, 1);

/** Shuffles the 32 bits that come out of the substitution boxes */
const kPermutation = Uint8Array.of(
  16, 7, 20, 21,
  29, 12, 28, 17,
  1, 15, 23, 26,
  5, 18, 31, 10,
  2, 8, 24, 14,
  32, 27, 3, 9,
  19, 13, 30, 6,
  22, 11, 4, 25);

/** Selects the 56 key bits that are actually used */
const kKeyPermutation = Uint8Array.of(
  57, 49, 41, 33, 25, 17, 9,
  1, 58, 50, 42, 34, 26, 18,
  10, 2, 59, 51, 43, 35, 27,
  19, 11, 3, 60, 52, 44, 36,
  63, 55, 47, 39, 31, 23, 15,
  7, 62, 54, 46, 38, 30, 22,
  14, 6, 61, 53, 45, 37, 29,
  21, 13, 5, 28, 20, 12, 4);

/** Picks the 48 bits of a round key out of the rotated key halves */
const kKeyCompression = Uint8Array.of(
  14, 17, 11, 24, 1, 5,
  3, 28, 15, 6, 21, 10,
  23, 19, 12, 4, 26, 8,
  16, 7, 27, 20, 13, 2,
  41, 52, 31, 37, 47, 55,
  30, 40, 51, 45, 33, 48,
  44, 49, 39, 56, 34, 53,
  46, 42, 50, 36, 29, 32);

/** How far the key halves are rotated before each round */
const kKeyShifts = Uint8Array.of(1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1);

/** The 8 substitution boxes, 4 rows of 16 values each */
const kSubstitutionBoxes = [
  Uint8Array.of(
    14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7,
    0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
    4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0,
    15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13),
  Uint8Array.of(
    15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10,
    3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5,
    0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15,
    13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9),
  Uint8Array.of(
    10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8,
    13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
    13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7,
    1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12),
  Uint8Array.of(
    7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15,
    13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
    10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4,
    3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14),
  Uint8Array.of(
    2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9,
    14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
    4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14,
    11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3),
  Uint8Array.of(
    12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11,
    10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
    9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6,
    4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13),
  Uint8Array.of(
    4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1,
    13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
    1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2,
    6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12),
  Uint8Array.of(
    13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7,
    1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
    7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8,
    2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11),
];

/* RC2 */

/** Decrypts a single 8 byte block, by undoing the mixing and mashing rounds
 * of the encryption, in reverse order. RFC 2268 section 4. */
function rc2Block(block: Uint8Array, expandedKey: Uint16Array): Uint8Array {
  let r = new Uint16Array(4);
  for (let i = 0; i < 4; i++) {
    r[i] = block[i * 2] | block[i * 2 + 1] << 8;
  }
  let j = 63;
  for (let round = 0; round < 16; round++) {
    if (round == 5 || round == 11) {
      // R-mashing round
      for (let i = 3; i >= 0; i--) {
        r[i] -= expandedKey[r[i + 3 & 3] & 63];
      }
    }
    // R-mixing round
    for (let i = 3; i >= 0; i--) {
      let rotation = kRC2Rotations[i];
      r[i] = r[i] >> rotation | r[i] << 16 - rotation;
      r[i] -= expandedKey[j--] + (r[i + 3 & 3] & r[i + 2 & 3]) + (~r[i + 3 & 3] & r[i + 1 & 3]);
    }
  }
  let plaintext = new Uint8Array(8);
  for (let i = 0; i < 4; i++) {
    plaintext[i * 2] = r[i] & 0xFF;
    plaintext[i * 2 + 1] = r[i] >> 8;
  }
  return plaintext;
}

/** Turns the key into the 64 words that the cipher rounds use.
 * The effective key length limits how much of the key influences the
 * result, which is how the 40 bit export variant is weakened.
 * RFC 2268 section 2. */
function expandRC2Key(key: Uint8Array, effectiveKeyBits: number): Uint16Array {
  if (!key.length || key.length > 128) {
    throw new Error("RC2 needs a key of 1 to 128 bytes");
  }
  let expanded = new Uint8Array(128);
  expanded.set(key);
  for (let i = key.length; i < 128; i++) {
    expanded[i] = kPiTable[expanded[i - 1] + expanded[i - key.length] & 0xFF];
  }
  let effectiveBytes = effectiveKeyBits + 7 >> 3;
  let mask = 0xFF >> effectiveBytes * 8 - effectiveKeyBits;
  expanded[128 - effectiveBytes] = kPiTable[expanded[128 - effectiveBytes] & mask];
  for (let i = 127 - effectiveBytes; i >= 0; i--) {
    expanded[i] = kPiTable[expanded[i + 1] ^ expanded[i + effectiveBytes]];
  }
  let words = new Uint16Array(64);
  for (let i = 0; i < 64; i++) {
    words[i] = expanded[i * 2] | expanded[i * 2 + 1] << 8;
  }
  return words;
}

/** How far each of the 4 words is rotated in a mixing round */
const kRC2Rotations = [1, 2, 3, 5];

/** A fixed permutation of all byte values, based on the digits of pi */
const kPiTable = Uint8Array.of(
  0xd9, 0x78, 0xf9, 0xc4, 0x19, 0xdd, 0xb5, 0xed, 0x28, 0xe9, 0xfd, 0x79, 0x4a, 0xa0, 0xd8, 0x9d,
  0xc6, 0x7e, 0x37, 0x83, 0x2b, 0x76, 0x53, 0x8e, 0x62, 0x4c, 0x64, 0x88, 0x44, 0x8b, 0xfb, 0xa2,
  0x17, 0x9a, 0x59, 0xf5, 0x87, 0xb3, 0x4f, 0x13, 0x61, 0x45, 0x6d, 0x8d, 0x09, 0x81, 0x7d, 0x32,
  0xbd, 0x8f, 0x40, 0xeb, 0x86, 0xb7, 0x7b, 0x0b, 0xf0, 0x95, 0x21, 0x22, 0x5c, 0x6b, 0x4e, 0x82,
  0x54, 0xd6, 0x65, 0x93, 0xce, 0x60, 0xb2, 0x1c, 0x73, 0x56, 0xc0, 0x14, 0xa7, 0x8c, 0xf1, 0xdc,
  0x12, 0x75, 0xca, 0x1f, 0x3b, 0xbe, 0xe4, 0xd1, 0x42, 0x3d, 0xd4, 0x30, 0xa3, 0x3c, 0xb6, 0x26,
  0x6f, 0xbf, 0x0e, 0xda, 0x46, 0x69, 0x07, 0x57, 0x27, 0xf2, 0x1d, 0x9b, 0xbc, 0x94, 0x43, 0x03,
  0xf8, 0x11, 0xc7, 0xf6, 0x90, 0xef, 0x3e, 0xe7, 0x06, 0xc3, 0xd5, 0x2f, 0xc8, 0x66, 0x1e, 0xd7,
  0x08, 0xe8, 0xea, 0xde, 0x80, 0x52, 0xee, 0xf7, 0x84, 0xaa, 0x72, 0xac, 0x35, 0x4d, 0x6a, 0x2a,
  0x96, 0x1a, 0xd2, 0x71, 0x5a, 0x15, 0x49, 0x74, 0x4b, 0x9f, 0xd0, 0x5e, 0x04, 0x18, 0xa4, 0xec,
  0xc2, 0xe0, 0x41, 0x6e, 0x0f, 0x51, 0xcb, 0xcc, 0x24, 0x91, 0xaf, 0x50, 0xa1, 0xf4, 0x70, 0x39,
  0x99, 0x7c, 0x3a, 0x85, 0x23, 0xb8, 0xb4, 0x7a, 0xfc, 0x02, 0x36, 0x5b, 0x25, 0x55, 0x97, 0x31,
  0x2d, 0x5d, 0xfa, 0x98, 0xe3, 0x8a, 0x92, 0xae, 0x05, 0xdf, 0x29, 0x10, 0x67, 0x6c, 0xba, 0xc9,
  0xd3, 0x00, 0xe6, 0xcf, 0xe1, 0x9e, 0xa8, 0x2c, 0x63, 0x16, 0x01, 0x3f, 0x58, 0xe2, 0x89, 0xa9,
  0x0d, 0x38, 0x34, 0x1b, 0xab, 0x33, 0xff, 0xb0, 0xbb, 0x48, 0x0c, 0x5f, 0xb9, 0xb1, 0xcd, 0x2e,
  0xc5, 0xf3, 0xdb, 0x47, 0xe5, 0xa5, 0x9c, 0x77, 0x0a, 0xa6, 0x20, 0x68, 0xfe, 0x7f, 0xc1, 0xad);
