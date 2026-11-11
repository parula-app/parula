import { ExchangeAutoResponder, OOFState } from "../EWS/ExchangeAutoResponder";
import { AutoResponderAudience } from "../AutoResponder";
import type { ActiveSyncAccount } from "./ActiveSyncAccount";
import { ActiveSyncError } from "./ActiveSyncError";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { sanitizeHTML } from "../../util/convertHTML";
import { ensureArray } from "../../util/util";

/** `Settings` command, `Oof` property. Exchange replies once per sender. */
export class ActiveSyncAutoResponder extends ExchangeAutoResponder {
  declare readonly account: ActiveSyncAccount;

  async load(): Promise<void> {
    let response = await this.callOOF({ Get: { BodyType: "HTML" } });
    this.fromEAS(response.Get ?? {});
  }

  async save(): Promise<void> {
    this.validate();
    await this.callOOF({ Set: this.toEAS() });
  }

  /** @param request `Get` or `Set`
   * @returns `Oof` of the response */
  protected async callOOF(request: { Get?: object, Set?: object }): Promise<Record<string, any>> {
    let response = await this.account.callEAS("Settings", { Oof: request });
    if (response?.Oof?.Status != "1") {
      throw new ActiveSyncError("Settings", response?.Oof?.Status, this.account);
    }
    return response.Oof;
  }

  /** @param get `Get` of the `Oof` response */
  fromEAS(get: Record<string, any>) {
    this.oofState = sanitize.integerRange(get.OofState, 0, 2, OOFState.Disabled);
    this.setTimes(sanitize.date(get.StartTime, null), sanitize.date(get.EndTime, null));
    let messages = ensureArray(get.OofMessage).filter(message => message && typeof (message) == "object");
    let internal = messages.find(message => "AppliesToInternal" in message);
    let known = messages.find(message => "AppliesToExternalKnown" in message);
    let unknown = messages.find(message => "AppliesToExternalUnknown" in message);
    this.externalAudience =
      unknown?.Enabled == "1" ? AutoResponderAudience.All :
      known?.Enabled == "1" ? AutoResponderAudience.Contacts :
      AutoResponderAudience.None;
    // The server omits the audiences that the admin does not allow
    this.maxAudience =
      unknown ? AutoResponderAudience.All :
      known ? AutoResponderAudience.Contacts :
      AutoResponderAudience.None;
    let external = [unknown, known].find(message => message?.Enabled == "1") ?? unknown ?? known;
    this.internalHTML = sanitizeHTML(internal?.ReplyMessage);
    this.externalHTML = sanitizeHTML(external?.ReplyMessage);
  }

  /** Elements must be in schema order, apart from within `OofMessage` */
  toEAS() {
    let set: any = {
      OofState: String(this.oofState),
    };
    if (this.scheduled) {
      set.StartTime = this.startTime.toISOString();
      set.EndTime = this.endTime.toISOString();
    }
    let external = this.stripEmptyParagraph(this.externalHTML);
    set.OofMessage = [
      this.oofMessage("AppliesToInternal", true, this.stripEmptyParagraph(this.internalHTML)),
      this.oofMessage("AppliesToExternalKnown", this.externalAudience != AutoResponderAudience.None, external),
      this.oofMessage("AppliesToExternalUnknown", this.externalAudience == AutoResponderAudience.All, external),
    ];
    return set;
  }

  protected oofMessage(appliesTo: string, enabled: boolean, message: string) {
    return {
      [appliesTo]: {},
      Enabled: enabled ? "1" : "0",
      ReplyMessage: message,
      BodyType: "HTML",
    };
  }
}
