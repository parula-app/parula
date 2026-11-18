/** Signal's hardcoded sealed-sender trust roots (Docs/03 §7). The 33-byte DJB
 * public keys whose signatures anchor the ServerCertificate → SenderCertificate
 * chain. These are the production values baked into Signal-Android and
 * Signal-Desktop (`UNIDENTIFIED_SENDER_TRUST_ROOTS`, `serverTrustRoots`). */
import { base64Decode } from "../Crypto/primitives";
import { djbDecode } from "../Crypto/curve";

/** The raw 32-byte trust-root public keys (the form `validateSenderCertificate`
 * verifies XEdDSA signatures against). The second one signs server certificate id 3. */
export const kSignalTrustRoots = [
  "BXu6QIKVz5MA8gstzfOgRQGqyLqOwNKHL6INkv3IHWMF",
  "BUkY0I+9+oPgDCn4+Ac6Iu813yvqkDr/ga8DzLxFxuk6",
].map(djb => djbDecode(base64Decode(djb)));
