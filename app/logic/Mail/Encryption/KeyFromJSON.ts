import type { PublicKey } from "./PublicKey";
import type { PrivateKey } from "./PrivateKey";
import { PGPPublicKey } from "./PGP/PGPPublicKey";
import { PGPPrivateKey } from "./PGP/PGPPrivateKey";
import { SMIMEPublicKey } from "./SMIME/SMIMEPublicKey";
import { SMIMEPrivateKey } from "./SMIME/SMIMEPrivateKey";
import { EncryptionSystem } from "./enums";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

export function publicKeyFromJSON(json: any): PublicKey {
  let PublicKeyClass = sanitize.translate(json.system, {
    [EncryptionSystem.PGP]: PGPPublicKey,
    [EncryptionSystem.SMIME]: SMIMEPublicKey,
  });
  let publicKey = new PublicKeyClass();
  publicKey.fromJSON(json);
  return publicKey;
}

export function privateKeyFromJSON(json: any): PublicKey & PrivateKey {
  let PrivateKeyClass = sanitize.translate(json.system, {
    [EncryptionSystem.PGP]: PGPPrivateKey,
    [EncryptionSystem.SMIME]: SMIMEPrivateKey,
  });
  let privateKey = new PrivateKeyClass();
  privateKey.fromPrivateJSON(json);
  return privateKey;
}
