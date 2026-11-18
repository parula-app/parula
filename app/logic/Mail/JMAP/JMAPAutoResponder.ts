import { AutoResponder } from "../AutoResponder";
import type { JMAPAccount } from "./JMAPAccount";
import type { TJMAPChangeResponse, TJMAPGetResponse } from "./TJMAPGeneric";
import type { TJMAPVacationResponse } from "./TJMAPMail";
import { checkChangeError } from "./JMAPError";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { convertHTMLToText, convertTextToHTML, sanitizeHTML } from "../../util/convertHTML";

/** `VacationResponse` <https://www.rfc-editor.org/rfc/rfc8621.html#section-8>.
 * The server replies to all senders with the same message. */
export class JMAPAutoResponder extends AutoResponder {
  declare readonly account: JMAPAccount;

  /** Only the owner of the account */
  get supported(): boolean {
    return !this.account.isDependentAccount &&
      !!this.account.accountCapabilities["urn:ietf:params:jmap:vacationresponse"];
  }

  async load(): Promise<void> {
    let response = await this.account.makeSingleCall("VacationResponse/get", {
      accountId: this.account.accountID,
      ids: ["singleton"],
    }) as TJMAPGetResponse<TJMAPVacationResponse>;
    this.fromJMAP(response.list[0]);
  }

  async save(): Promise<void> {
    this.validate();
    await this.setVacationResponse(this.isOn);
  }

  /** Writes the reply and the time range.
   * @param isEnabled false only stores the reply */
  protected async setVacationResponse(isEnabled: boolean) {
    let response = await this.account.makeSingleCall("VacationResponse/set", {
      accountId: this.account.accountID,
      update: {
        singleton: this.toJMAP(isEnabled),
      },
    }) as TJMAPChangeResponse<TJMAPVacationResponse>;
    checkChangeError(response);
  }

  fromJMAP(json: TJMAPVacationResponse) {
    this.isOn = sanitize.boolean(json.isEnabled, false);
    let fromDate = sanitize.date(json.fromDate, null);
    let toDate = sanitize.date(json.toDate, null);
    this.scheduled = !!fromDate || !!toDate;
    this.setTimes(fromDate ?? this.startTime, toDate ?? this.endTime);
    this.internalHTML = json.htmlBody
      ? sanitizeHTML(json.htmlBody)
      : convertTextToHTML(sanitize.string(json.textBody, ""));
  }

  /** The subject stays as it is on the server */
  toJMAP(isEnabled: boolean): TJMAPVacationResponse {
    let html = this.stripEmptyParagraph(this.internalHTML);
    return {
      isEnabled: isEnabled,
      fromDate: this.isOn && this.scheduled ? this.startTime.toISOString() : null,
      toDate: this.isOn && this.scheduled ? this.endTime.toISOString() : null,
      // null = the server's default reply
      htmlBody: html || null,
      textBody: html ? convertHTMLToText(html) : null,
    };
  }
}
