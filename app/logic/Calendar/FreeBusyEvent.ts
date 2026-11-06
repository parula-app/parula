import { Event, FreeBusyStatus, freeBusyStatusLabels } from "./Event";

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
}
