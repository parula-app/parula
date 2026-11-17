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
    this.fromWBXML(response.Get ?? {});
  }

  async save(): Promise<void> {
    this.validate();
    await this.callOOF({ Set: this.toWBXML() });
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

  /** @param wbxmljs `Get` of the `Oof` response */
  fromWBXML(wbxmljs: Record<string, any>) {
    this.oofState = sanitize.integerRange(wbxmljs.OofState, 0, 2, OOFState.Disabled);
    this.setTimes(sanitize.date(wbxmljs.StartTime, null), sanitize.date(wbxmljs.EndTime, null));
    let messages = ensureArray(wbxmljs.OofMessage).filter(message => message && typeof (message) == "object");
    let internal = messages.find(message => "AppliesToInternal" in message);
    let known = messages.find(message => "AppliesToExternalKnown" in message);
    let unknown = messages.find(message => "AppliesToExternalUnknown" in message);
    // While OOF is off, Exchange reports all messages as disabled, so use Exchange's default
    this.externalAudience =
      unknown?.Enabled == "1" ? AutoResponderAudience.All :
      known?.Enabled == "1" ? AutoResponderAudience.Contacts :
      internal?.Enabled == "1" ? AutoResponderAudience.None :
      AutoResponderAudience.All;
    let external = [unknown, known].find(message => message?.Enabled == "1") ?? unknown ?? known;
    this.internalHTML = sanitizeHTML(internal?.ReplyMessage);
    this.externalHTML = sanitizeHTML(external?.ReplyMessage);
  }

  /** Elements must be in schema order */
  toWBXML() {
    let external = this.stripEmptyParagraph(this.externalHTML);
    return {
      OofState: String(this.oofState),
      // `[]` omits the element
      StartTime: this.scheduled ? this.startTime.toISOString() : [],
      EndTime: this.scheduled ? this.endTime.toISOString() : [],
      OofMessage: [
        this.oofMessage("AppliesToInternal", true, this.stripEmptyParagraph(this.internalHTML)),
        this.oofMessage("AppliesToExternalKnown", this.externalAudience != AutoResponderAudience.None, external),
        this.oofMessage("AppliesToExternalUnknown", this.externalAudience == AutoResponderAudience.All, external),
      ],
    };
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
