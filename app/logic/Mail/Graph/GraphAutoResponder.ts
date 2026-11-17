import { AutoResponder, AutoResponderAudience } from "../AutoResponder";
import type { GraphAccount } from "./GraphAccount";
import type { TGraphAutoReplies, TGraphDateTimeZone } from "./TGraphMail";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { sanitizeHTML } from "../../util/convertHTML";
import { PermissionMissing } from "../../Abstract/Account";
import type { OAuth2 } from "../../Auth/OAuth2";
import { gt } from "../../../l10n/l10n";

/** `mailboxSettings/automaticRepliesSetting`. Exchange replies once per sender. */
export class GraphAutoResponder extends AutoResponder {
  declare readonly account: GraphAccount;

  get supported(): boolean {
    return !this.account.isDependentAccount;
  }

  get supportsExternal(): boolean {
    return true;
  }

  get supportsContacts(): boolean {
    return true;
  }

  async load(): Promise<void> {
    let settings = await this.call(() => this.account.graphCall("mailboxSettings/automaticRepliesSetting"));
    this.fromGraph(settings);
  }

  async save(): Promise<void> {
    this.validate();
    await this.call(() => this.account.graphPatch("mailboxSettings", { automaticRepliesSetting: this.toGraph() }));
  }

  async grantPermission(): Promise<void> {
    await this.account.upgradeScopes();
  }

  protected async call<T>(func: () => Promise<T>): Promise<T> {
    try {
      return await func();
    } catch (ex) {
      // Logins from before we asked for `MailboxSettings.ReadWrite`.
      // If the login has it, a new login would not help, so show the server error.
      if ((ex?.httpCode ?? ex?.status) == 403 && !(this.account.oAuth2 as OAuth2)?.scope?.includes("MailboxSettings.ReadWrite")) {
        throw new PermissionMissing(ex, gt`To see and change your automatic replies, please log in once more and allow access.`);
      }
      throw ex;
    }
  }

  fromGraph(json: TGraphAutoReplies) {
    // The server is not consistent in the casing
    let status = sanitize.string(json.status, "").toLowerCase();
    this.isOn = status == "alwaysenabled" || status == "scheduled";
    this.scheduled = status == "scheduled";
    this.setTimes(this.parseTime(json.scheduledStartDateTime), this.parseTime(json.scheduledEndDateTime));
    let audience = sanitize.string(json.externalAudience, "").toLowerCase();
    this.externalAudience = Object.values(AutoResponderAudience)
      .find(value => value.toLowerCase() == audience) ?? AutoResponderAudience.None;
    this.internalHTML = sanitizeHTML(json.internalReplyMessage);
    this.externalHTML = sanitizeHTML(json.externalReplyMessage);
  }

  toGraph(): TGraphAutoReplies {
    return {
      status: !this.isOn ? "disabled" : this.scheduled ? "scheduled" : "alwaysEnabled",
      externalAudience: this.externalAudience,
      internalReplyMessage: this.stripEmptyParagraph(this.internalHTML),
      externalReplyMessage: this.stripEmptyParagraph(this.externalHTML),
      // JSON omits `undefined`. `null` would go to the server.
      scheduledStartDateTime: this.scheduled ? this.toTime(this.startTime) : undefined,
      scheduledEndDateTime: this.scheduled ? this.toTime(this.endTime) : undefined,
    };
  }

  /** We send UTC, and we don't ask for another time zone with
   * `Prefer: outlook.timezone`, so Graph returns UTC, its default */
  protected parseTime(time: TGraphDateTimeZone): Date | null {
    if (!time?.dateTime || time.timeZone && time.timeZone != "UTC") {
      return null;
    }
    return sanitize.date(time.dateTime + "Z", null);
  }

  protected toTime(date: Date): TGraphDateTimeZone {
    return {
      dateTime: date.toISOString().replace("Z", ""),
      timeZone: "UTC",
    };
  }
}
