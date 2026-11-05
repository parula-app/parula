import { Calendar } from "../Calendar";
import { FreeBusyStatus, type FreeBusyEvent } from "../FreeBusyEvent";
import { Participant } from "../Participant";
import { InvitationResponse } from "../Invitation/InvitationStatus";
import { k1DayMS } from "../../util/date";
import { assert } from "../../util/util";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { gt } from "../../../l10n/l10n";
import { ArrayColl } from "svelte-collections";

export class ExchangeCalendar extends Calendar {
  /** Exchange's calendar can only accept incoming invitations from its inbox */
  readonly canAcceptAnyInvitation = false;
  /** Is this the default calendar that handles incoming invitations */
  useForInvitations: boolean = false;
  /** The colleague who owns this calendar lets us see only the times, titles and locations
   * of their appointments, from their availability, but not the calendar folder */
  hasLimitedDetails = false;

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.useForInvitations = sanitize.boolean(json.useForInvitations, false);
    this.hasLimitedDetails = sanitize.boolean(json.hasLimitedDetails, false);
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.useForInvitations = this.useForInvitations;
    json.hasLimitedDetails = this.hasLimitedDetails;
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

  protected get owner(): Participant {
    return new Participant(this.username, this.name, InvitationResponse.Unknown);
  }

  async showsTitles(): Promise<boolean> {
    let from = new Date();
    let to = new Date(from.getTime() + k1DayMS);
    let [availability] = await this.arePersonsFree([this.owner], from, to);
    return !!availability?.hasDetails;
  }

  protected async listEventsFromAvailability() {
    const kTimeSpanDays = 42; // the longest that the server allows
    const kTimeSpansBefore = 1;
    const kTimeSpans = 4;
    let events = new ArrayColl<FreeBusyEvent>();
    let today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < kTimeSpans; i++) {
      let from = new Date(today.getTime() + (i - kTimeSpansBefore) * kTimeSpanDays * k1DayMS);
      let to = new Date(from.getTime() + kTimeSpanDays * k1DayMS);
      let [availability] = await this.arePersonsFree([this.owner], from, to);
      assert(availability?.availability, gt`Could not get the appointments in the calendar ${this.name}`);
      for (let appointment of availability.availability) {
        if (i > 0 && appointment.startTime < from) {
          continue; // The server also sends the appointments that started earlier, which we already have
        }
        appointment.calendar = this;
        events.add(appointment);
      }
    }
    this.events.replaceAll(events.contents);
  }
}
