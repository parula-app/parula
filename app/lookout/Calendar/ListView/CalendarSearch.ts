import type { Event } from "../../../logic/Calendar/Event";
import type { PersonUID } from "../../../logic/Abstract/PersonUID";

export function eventOrganizers(events: Event[]): PersonUID[] {
  let byEMail = new Map<string, PersonUID>();
  for (let event of events) {
    let organizer = event.organizer;
    if (organizer?.emailAddress && !byEMail.has(organizer.emailAddress)) {
      byEMail.set(organizer.emailAddress, organizer);
    }
  }
  return [...byEMail.values()].sort((a, b) => (a.name ?? a.emailAddress).localeCompare(b.name ?? b.emailAddress));
}
