import { ExchangeAutoResponder, OOFState } from "../EWS/ExchangeAutoResponder";
import { AutoResponderAudience } from "../AutoResponder";
import type { OWAAccount } from "./OWAAccount";
import { OWAGetMailboxAutoReplyConfigurationRequest, OWASetMailboxAutoReplyConfigurationRequest } from "./Request/OWAMailboxAutoReplyConfigurationRequests";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { sanitizeHTML } from "../../util/convertHTML";

export class OWAAutoResponder extends ExchangeAutoResponder {
  declare readonly account: OWAAccount;

  async load(): Promise<void> {
    let response = await this.account.callOWA(new OWAGetMailboxAutoReplyConfigurationRequest());
    this.fromOWA(response.Options);
  }

  async save(): Promise<void> {
    this.validate();
    await this.account.callOWA(new OWASetMailboxAutoReplyConfigurationRequest(this.toOWA()));
  }

  /** @param options as returned by `GetMailboxAutoReplyConfiguration` in `load()` */
  fromOWA(options: any) {
    this.oofState = sanitize.integerRange(options.AutoReplyState, 0, 2, OOFState.Disabled);
    this.setTimes(sanitize.date(options.StartTime, null), sanitize.date(options.EndTime, null));
    this.externalAudience = this.sanitizeAudience(options.ExternalAudience, AutoResponderAudience.None);
    this.internalHTML = sanitizeHTML(options.InternalMessage);
    this.externalHTML = sanitizeHTML(options.ExternalMessage);
  }

  toOWA() {
    return {
      __type: "MailboxAutoReplyConfigurationOptions:#Exchange",
      AutoReplyState: this.oofState,
      StartTime: this.scheduled ? this.startTime.toISOString() : undefined,
      EndTime: this.scheduled ? this.endTime.toISOString() : undefined,
      ExternalAudience: this.oofAudience,
      InternalMessage: this.stripEmptyParagraph(this.internalHTML),
      ExternalMessage: this.stripEmptyParagraph(this.externalHTML),
    };
  }
}
