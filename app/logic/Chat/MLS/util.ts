/** Generic helpers for the MLS implementation.
 * Byte helpers (`concatBytes`, `randomBytes`, `bytesEqual`, base64) are reused
 * from `Chat/Signal/Crypto/primitives`. */

/** MLS labels and identity strings are all UTF-8. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** The group could not be advanced, e.g. a signature or MAC did not verify, or
 * the message is for an epoch we do not have. The caller drops the message and,
 * where the protocol allows it, rejoins the group. */
export class MLSError extends Error {
}
