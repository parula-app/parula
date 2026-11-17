import { Calendar } from "../Calendar";
import { FreeBusyStatus } from "../FreeBusyEvent";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

export class ExchangeCalendar extends Calendar {
  /** Exchange's calendar can only accept incoming invitations from its inbox */
  readonly canAcceptAnyInvitation = false;
  /** Is this the default calendar that handles incoming invitations */
  useForInvitations: boolean = false;

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.useForInvitations = sanitize.boolean(json.useForInvitations, false);
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.useForInvitations = this.useForInvitations;
    return json;
  }

  /** @param busyType Exchange `BusyType`, e.g. `OOF`
   * @returns null for `NoData` */
  protected freeBusyStatus(busyType: string): FreeBusyStatus | null {
    return sanitize.translate(busyType, {
      Free: FreeBusyStatus.Free,
      Tentative: FreeBusyStatus.Tentative,
      Busy: FreeBusyStatus.Busy,
      OOF: FreeBusyStatus.OutOfOffice,
      WorkingElsewhere: FreeBusyStatus.WorkingElsewhere,
    }, null);
  }
}
