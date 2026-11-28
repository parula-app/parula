/** Account Device Verification (ADV) signatures used during multi-device
 * companion pairing. When the user's phone authorizes us as a linked device,
 * the server delivers a signed device identity; we verify the account's
 * signature and add our own device signature.
 *
 * Byte prefixes (E2EE account): account signature over {6,0}, device over {6,1}. */
import { xeddsaSign, xeddsaVerify } from "../../Signal/Crypto/curve";
import { hmacSHA256, concatBytes, bytesEqual } from "../../Signal/Crypto/primitives";

const kAccountSignaturePrefix = new Uint8Array([6, 0]);
const kDeviceSignaturePrefix = new Uint8Array([6, 1]);

/** Verifies that the user's primary account authorized this companion device.
 * @param accountSignatureKey the primary device's identity public key (32 bytes)
 * @param details the ADVSignedDeviceIdentity.details bytes
 * @param companionIdentityPub our identity public key (32 bytes) */
export function verifyAccountSignature(accountSignatureKey: Uint8Array, details: Uint8Array,
    companionIdentityPub: Uint8Array, accountSignature: Uint8Array): boolean {
  let message = concatBytes(kAccountSignaturePrefix, details, companionIdentityPub);
  return xeddsaVerify(accountSignatureKey, message, accountSignature);
}

/** Produces our device signature, proving we accept being linked to this account.
 * @param companionIdentityPriv our identity private key (32 bytes) */
export function generateDeviceSignature(companionIdentityPriv: Uint8Array, details: Uint8Array,
    companionIdentityPub: Uint8Array, accountSignatureKey: Uint8Array): Uint8Array {
  let message = concatBytes(kDeviceSignaturePrefix, details, companionIdentityPub, accountSignatureKey);
  return xeddsaSign(companionIdentityPriv, message);
}

/** Verifies the advSecret-keyed HMAC envelope wrapping the device identity, all of it, because it proves that the phone that scanned our QR code sent it */
export function verifyDeviceIdentityHMAC(advSecret: Uint8Array, details: Uint8Array, hmac: Uint8Array): boolean {
  return bytesEqual(hmacSHA256(advSecret, details), hmac);
}
