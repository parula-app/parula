import type { PublicKey } from "../../../logic/Mail/Encryption/PublicKey";
import { TrustLevel } from "../../../logic/Mail/Encryption/enums";
import { gt } from "../../../l10n/l10n";

export function certificateStatus(key: PublicKey): string {
  if (key.trustLevel == TrustLevel.Distrusted) {
    return gt`Not trusted`;
  }
  if (key.obsolete) {
    return key.expires && key.expires.getTime() < Date.now() ? gt`Expired *=> No longer valid` : gt`Not used *=> Status: the certificate is outdated and no longer used`;
  }
  return key.encryptByDefault ? gt`Default *=> Status: the certificate is used for encryption by default` : "";
}
