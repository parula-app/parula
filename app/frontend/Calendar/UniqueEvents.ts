import type { Event } from "../../logic/Calendar/Event";
import { ArrayColl, type Collection } from "svelte-collections";

export class UniqueEvents extends ArrayColl<Event> {
  protected readonly eventsByKey = new Map<string, Event[]>();
  protected readonly keyOfEvent = new Map<Event, string>();

  constructor(source: Collection<Event>) {
    super();
    source.registerObserver(this);
    this.added(source.contents);
  }

  added(events: Event[]) {
    let shown: Event[] = [];
    for (let event of events) {
      let key = this.key(event);
      if (!key) {
        shown.push(event);
        continue;
      }
      this.keyOfEvent.set(event, key);
      let sameEvents = this.eventsByKey.get(key);
      if (sameEvents) {
        sameEvents.push(event);
      } else {
        this.eventsByKey.set(key, [event]);
        shown.push(event);
      }
    }
    if (shown.length) {
      this.addAll(shown);
    }
  }

  removed(events: Event[]) {
    let hidden: Event[] = [];
    let previouslyShown = new Map<string, Event>();
    for (let event of events) {
      let key = this.keyOfEvent.get(event);
      if (!key) {
        hidden.push(event);
        continue;
      }
      this.keyOfEvent.delete(event);
      let sameEvents = this.eventsByKey.get(key);
      if (!previouslyShown.has(key)) {
        previouslyShown.set(key, sameEvents[0]);
      }
      sameEvents.splice(sameEvents.indexOf(event), 1);
    }
    let shown: Event[] = [];
    for (let [key, previous] of previouslyShown) {
      let current = this.eventsByKey.get(key)[0];
      if (!current) {
        this.eventsByKey.delete(key);
      }
      if (current == previous) {
        continue;
      }
      hidden.push(previous);
      if (current) {
        shown.push(current);
      }
    }
    this.removeAll(hidden);
    if (shown.length) {
      this.addAll(shown);
    }
  }

  protected key(event: Event): string | null {
    if (!event.calUID) {
      return null;
    }
    return event.calUID + " " + (event.recurrenceStartTime?.getTime() ?? "");
  }
}
