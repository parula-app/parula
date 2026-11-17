import type { Calendar } from "../../logic/Calendar/Calendar";
import { getLocalStorage } from "../Util/LocalStorage";
import { ArrayColl, type Collection } from "svelte-collections";
import type { Writable } from "svelte/store";

/** The calendars that the user switched on in the calendar list.
 * We save the calendars which he switched *off*, so that calendars
 * that he adds later show up without him doing anything. */
export class ShownCalendars extends ArrayColl<Calendar> {
  protected readonly hiddenIDs = getLocalStorage<string[]>("calendar.hidden", []);
  protected readonly allCalendars: Collection<Calendar>;
  protected readonly selectedCalendar: Writable<Calendar | null>;

  constructor(allCalendars: Collection<Calendar>, selectedCalendar: Writable<Calendar | null>) {
    super();
    this.allCalendars = allCalendars;
    this.selectedCalendar = selectedCalendar;
    allCalendars.registerObserver(this);
    this.update();
  }

  show(calendar: Calendar, show: boolean): void {
    this.hiddenIDs.value = show
      ? this.hiddenIDs.value.filter(id => id != calendar.id)
      : this.hiddenIDs.value.concat(calendar.id);
    this.update();
  }

  /** Observes `allCalendars` */
  added() {
    this.update();
  }
  removed() {
    this.update();
  }

  protected update(): void {
    let hiddenIDs = this.hiddenIDs.value;
    this.replaceAll(this.allCalendars.contents.filter(cal => !hiddenIDs.includes(cal.id)));
    this.selectedCalendar.update(calendar => this.contains(calendar) ? calendar : this.first);
  }
}
