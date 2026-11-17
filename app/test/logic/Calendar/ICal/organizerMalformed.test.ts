import { ICalParser } from "../../../../logic/Calendar/ICal/ICalParser";
import { convertICalContainerToEvent } from "../../../../logic/Calendar/ICal/ICalToEvent";
import { Event } from "../../../../logic/Calendar/Event";
import { expect, test } from "vitest";

function veventWith(organizerLine: string) {
  let ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:1", "SUMMARY:Test"]
    .concat(organizerLine ? [organizerLine] : [])
    .concat(["END:VEVENT", "END:VCALENDAR"]).join("\r\n");
  return new ICalParser(ics).containers.vcalendar[0].containers.vevent[0];
}

/** RFC 5545 3.6.1 lists ORGANIZER as optional, so an event may legally have none,
 * and a broken sender may send one that names nobody. */
test("An event without a usable organizer still parses", () => {
  for (let organizerLine of [
    "", // no ORGANIZER at all
    "ORGANIZER:", // no value
    "ORGANIZER;CN=Bob:", // a name, but no address
    "ORGANIZER:MAILTO:", // a mailto: URI without an address
    "ORGANIZER:MAILTO: parce que je suis absent du bureau", // free text, PARULA-201
  ]) {
    let event = new Event();
    convertICalContainerToEvent(veventWith(organizerLine), event);
    expect(event.organizer).toBe(null);
    expect(event.title).toBe("Test");
  }
});
