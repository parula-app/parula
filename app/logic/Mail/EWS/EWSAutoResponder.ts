import { ExchangeAutoResponder, OOFState } from "./ExchangeAutoResponder";
import { AutoResponderAudience } from "../AutoResponder";
import type { EWSAccount } from "./EWSAccount";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { sanitizeHTML } from "../../util/convertHTML";

export class EWSAutoResponder extends ExchangeAutoResponder {
  declare readonly account: EWSAccount;

  async load(): Promise<void> {
    let request = {
      m$GetUserOofSettingsRequest: {
        t$Mailbox: {
          t$Address: this.account.emailAddress,
        },
      },
    };
    let response = await this.account.callEWS(request);
    this.fromEWS(response);
  }

  async save(): Promise<void> {
    this.validate();
    let request = {
      m$SetUserOofSettingsRequest: {
        t$Mailbox: {
          t$Address: this.account.emailAddress,
        },
        t$UserOofSettings: this.toEWS(),
      },
    };
    await this.account.callEWS(request);
  }

  /** @param json as returned by `GetUserOofSettings` in `load()` */
  fromEWS(json: any) {
    let settings = json.OofSettings;
    this.oofState = sanitize.integerRange(OOFState[settings.OofState as string], 0, 2, OOFState.Disabled);
    this.setTimes(this.parseUTC(settings.Duration?.StartTime), this.parseUTC(settings.Duration?.EndTime));
    const audiences = {
      None: AutoResponderAudience.Internal,
      Known: AutoResponderAudience.Contacts,
      All: AutoResponderAudience.All,
    };
    // Exchange has only `None` (`ExternalOofOptions` `InternalOnly`) and `All`
    this.maxAudience = sanitize.translate(json.AllowExternalOof, audiences, AutoResponderAudience.All);
    // With `Internal`, Exchange saves the audience as `Internal`, and doesn't reply outside
    // with an audience that was saved before the admin's change
    this.externalAudience = this.maxAudience == AutoResponderAudience.Internal ? AutoResponderAudience.Internal :
      sanitize.translate(settings.ExternalAudience, audiences, AutoResponderAudience.Internal);
    this.internalHTML = sanitizeHTML(settings.InternalReply?.Message);
    this.externalHTML = sanitizeHTML(settings.ExternalReply?.Message);
  }

  /** Elements must be in schema order */
  toEWS() {
    return {
      t$OofState: OOFState[this.oofState],
      t$ExternalAudience: sanitize.translate(this.externalAudience, {
        [AutoResponderAudience.Internal]: "None",
        [AutoResponderAudience.Contacts]: "Known",
        [AutoResponderAudience.All]: "All",
      }),
      t$Duration: this.scheduled ? {
        t$StartTime: this.startTime.toISOString(),
        t$EndTime: this.endTime.toISOString(),
      } : null,
      t$InternalReply: {
        t$Message: this.stripEmptyParagraph(this.internalHTML),
      },
      t$ExternalReply: {
        t$Message: this.stripEmptyParagraph(this.externalHTML),
      },
    };
  }

  /** @param time E.g. "2026-10-05T07:00:00". Exchange omits the time zone, but means UTC. */
  protected parseUTC(time: string): Date | null {
    if (!time || typeof (time) != "string") {
      return null;
    }
    return sanitize.date(/(Z|[+-]\d\d:?\d\d)$/i.test(time) ? time : time + "Z", null);
  }
}
