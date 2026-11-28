import { Event, FreeBusyStatus, freeBusyStatusLabels } from "./Event";
import { UserError } from "../util/util";
import { gt } from "../../l10n/l10n";

export { FreeBusyStatus, freeBusyStatusLabels };

/** An appointment in the calendar of another person, as far as their server reveals it.
 * `title` and `location` are set only when the person lets us see them. */
export class FreeBusyEvent extends Event {
  protected _busyStatus: FreeBusyStatus;

  constructor(startTime: Date, endTime: Date, busyStatus: FreeBusyStatus) {
    super();
    this.startTime = startTime;
    this.endTime = endTime;
    this._busyStatus = busyStatus;
  }

  get busyStatus(): FreeBusyStatus {
    return this._busyStatus;
  }

  get isFree(): boolean {
    return this._busyStatus == FreeBusyStatus.Free;
  }

  get statusLabel(): string {
    return freeBusyStatusLabels[this._busyStatus];
  }

  get isReadOnly(): boolean {
    return true;
  }

  async save(): Promise<never> {
    throw this.readOnlyError();
  }

  async deleteIt(): Promise<never> {
    throw this.readOnlyError();
  }

  protected readOnlyError(): UserError {
    return new UserError(gt`You can only see the appointments in the calendar ${this.calendar?.name ?? ""}`);
  }
}
