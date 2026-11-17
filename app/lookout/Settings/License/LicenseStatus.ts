import { BadTicket, type Ticket } from "../../../logic/util/LicenseClient";
import { appName } from "../../../logic/build";
import { getDateString } from "../../../logic/util/date";
import { gt } from "../../../l10n/l10n";

export class LicenseStatus {
  readonly license: Ticket;

  constructor(license: Ticket = new BadTicket()) {
    this.license = license;
  }

  get text(): string {
    let license = this.license;
    if (license.isSoonExpiring) {
      return gt`Your license expires in ${license.daysLeft} days, on ${getDateString(license.expiresOn)}`;
    }
    if (license.isExpired) {
      return gt`Your license has expired on ${getDateString(license.expiresOn)}`;
    }
    if (license.valid) {
      return gt`Your license is valid until ${getDateString(license.expiresOn)}. Thank you for your purchase.`;
    }
    return gt`You can buy a license to use ${appName} fully`;
  }

  get needsPurchase(): boolean {
    let license = this.license;
    return !license.valid || license.isExpired || license.isSoonExpiring;
  }

  get purchaseLabel(): string {
    return this.license.valid ? gt`Renew License` : gt`Buy License`;
  }
}
