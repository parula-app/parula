import { TopicLink, TopicLinkType } from "./TopicLink";
import { Event } from "../../Calendar/Event";
import { appGlobal } from "../../app";

/** The UID of iCalendar. The same for all participants.
 * For a recurring event, it links the whole series. */
export class EventLink extends TopicLink {
  readonly type = TopicLinkType.Event;
  static readonly targetClass = Event;
  protected readonly idProperty = "identifier";
  protected readonly dateProperty = "startDate";
  declare target: Event | null;

  setTarget(event: Event) {
    let master = event.parentEvent ?? event;
    super.setTarget(master);
    this.targetID = master.calUID;
    this.name = master.title;
    this.date = master.startTime;
  }

  async findTarget(): Promise<Event | null> {
    await Promise.all(appGlobal.calendars.contents.map(calendar => calendar.readFromDB()));
    for (let calendar of appGlobal.calendars) {
      let event = calendar.events.find(event => event.calUID == this.targetID && !event.recurrenceStartTime);
      if (event) {
        return this.target = event;
      }
    }
    return this.target = null;
  }
}
