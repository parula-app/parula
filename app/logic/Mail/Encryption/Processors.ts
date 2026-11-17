import { PGPReadProcessor } from "./PGP/PGPReadProcessor";
import { SMIMEReadProcessor } from "./SMIME/SMIMEReadProcessor";

/** Not in the private key classes: `Person` loads those, and the processors
 * reach `MailIdentity` and `Account` from there. */
export function encryptionProcessorsHookup() {
  PGPReadProcessor.hookup();
  SMIMEReadProcessor.hookup();
}
