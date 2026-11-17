import type { Event } from "../Event";
import { InvitationResponse, ParticipationStatus, type iCalMethod } from "../Invitation/InvitationStatus";
import { VTimezone } from "./VTimezone";
import { myTimezone } from "../../util/date";
import { appName } from "../../build";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import type { Collection } from "svelte-collections";

export async function getICal(event: Event, method?: iCalMethod): Promise<string | null> {
  assert(event, "Need event");
  /* We have to special-case RRULE as it contains ";"s
   * which must not be escaped as normal text values would */
  const lines: (string | string[])[] = [];
  lines.push(["BEGIN", "VCALENDAR"]);
  if (method) {
    lines.push(["METHOD", method]);
  }
  lines.push(["VERSION", "2.0"]);
  lines.push(["PRODID", `-//Beonex//${appName}//EN`]);
  addVTimezones(lines, event);
  await addVEvent(lines, event, method);
  for (let exception of event.exceptions) {
    await addVEvent(lines, exception, method);
  }
  lines.push(["END", "VCALENDAR"]);
  return lines.map(line2ical).join("");
}

/**
 * Spells out the daylight saving time rules of every timezone that the event
 * uses. Outlook and Exchange do not understand the `TZID` names and would
 * otherwise show the event at the wrong time, RFC 5545 3.6.5.
 */
function addVTimezones(lines: (string | string[])[], event: Event): void {
  let timezones = new Set([event, ...event.exceptions]
    .filter(occurrence => !occurrence.allDay)
    .map(timezoneOf)
    .filter(timezone => timezone != "UTC")); // written as UTC times, without `TZID`
  for (let timezone of timezones) {
    lines.push(...new VTimezone(timezone, event.startTime).toICalLines());
  }
}

/** The timezone in which the times of the event are meant */
function timezoneOf(event: Event): string {
  return event.timezone || myTimezone();
}

/** @param method (Optional) The invitation action, only if this iCal is sent as an invitation email */
async function addVEvent(lines: (string | string[])[], event: Event, method?: iCalMethod): Promise<void> {
  lines.push(["BEGIN", "VEVENT"]);
  lines.push(["DTSTAMP", utc2ical(new Date())]);
  lines.push(["UID", event.calUID]);
  if (event.sequence) {
    lines.push(["SEQUENCE", String(event.sequence)]);
  }
  if (event.title) {
    lines.push(["SUMMARY", event.title]);
  }
  if (event.getLocationForServer()) {
    lines.push(["LOCATION", event.getLocationForServer()]);
  }
  if (event.isOnline && event.onlineMeetingURL) {
    // <https://www.rfc-editor.org/rfc/rfc7986#section-5.11>
    // `locationForServer` already put the URL in `LOCATION` for clients that don't know `CONFERENCE`
    lines.push(["CONFERENCE", event.onlineMeetingURL]);
    // Maybe also add to the end of descriptionText and HTML?
    // if (!event.descriptionHTML.includes(event.onlineMeetingURL)) { ...
  }
  if (event.descriptionText) {
    if (event.hasHTML) {
      // Plaintext, and HTML RFC 2445 4.2.1, 4.2, RFC 5545 3.2.1 and Thunderbird
      // <https://datatracker.ietf.org/doc/html/rfc2445#section-4.2.1>
      // <https://bugzilla.mozilla.org/show_bug.cgi?id=1607834>
    lines.push(["DESCRIPTION", "ALTREP", "data:text/html," + encodeURIComponent(event.descriptionHTML), event.descriptionText]);
      // HTML RFC 9073 6.5 <https://www.rfc-editor.org/rfc/rfc9073.html#name-styled-description>
      lines.push(["STYLED-DESCRIPTION", "VALUE", "TEXT", "FMTTYPE", "text/html", event.descriptionHTML]);
      // HTML Outlook
      lines.push(["X-ALT-DESC", "FMTTYPE", "text/html", event.descriptionHTML]);
    } else {
      // Plaintext
      lines.push(["DESCRIPTION", event.descriptionText]);
    }
  }
  if (event.allDay) {
    lines.push(["DTSTART", "VALUE", "DATE", date2ical(event.startTime)]);
    lines.push(["DTEND", "VALUE", "DATE", date2ical(event.endTime)]);
    lines.push(["X-MICROSOFT-CDO-ALLDAYEVENT", "TRUE"]);
    if (event.recurrenceStartTime) {
      lines.push(["RECURRENCE-ID", "VALUE", "DATE", date2ical(event.recurrenceStartTime)]);
    }
  } else {
    let timezone = timezoneOf(event);
    if (timezone == "UTC") {
      lines.push(["DTSTART", "VALUE", "DATE-TIME", utc2ical(event.startTime)]);
      lines.push(["DTEND", "VALUE", "DATE-TIME", utc2ical(event.endTime)]);
      if (event.recurrenceStartTime) {
        lines.push(["RECURRENCE-ID", "VALUE", "DATE-TIME", utc2ical(event.recurrenceStartTime)]);
      }
    } else {
      lines.push(["DTSTART", "VALUE", "DATE-TIME", "TZID", timezone, datetime2ical(event.startTime, timezone)]);
      lines.push(["DTEND", "VALUE", "DATE-TIME", "TZID", timezone, datetime2ical(event.endTime, timezone)]);
      if (event.recurrenceStartTime) {
        lines.push(["RECURRENCE-ID", "VALUE", "DATE-TIME", "TZID", timezone, datetime2ical(event.recurrenceStartTime, timezone)]);
      }
    }
  }
  if (event.isCancelled) {
    lines.push(["STATUS", "CANCELLED"]);
  }
  let organizer = event.participants.find(participant => participant.response == InvitationResponse.Organizer);
  if (organizer) {
    lines.push(["ORGANIZER", "MAILTO:" + organizer.emailAddress]);
  }
  if (event.recurrenceRule) {
    lines.push(event.recurrenceRule.getCalString(event.allDay) + "\r\n");
    let timezone = timezoneOf(event);
    for (let exclusion of event.exclusions) {
      if (event.allDay) {
        lines.push(["EXDATE", "VALUE", "DATE", date2ical(exclusion)]);
      } else if (timezone == "UTC") {
        lines.push(["EXDATE", "VALUE", "DATE-TIME", utc2ical(exclusion)]);
      } else {
        lines.push(["EXDATE", "VALUE", "DATE-TIME", "TZID", timezone, datetime2ical(exclusion, timezone)]);
      }
    }
  }
  for (let participant of event.participants) {
    switch (participant.response) {
    case InvitationResponse.Organizer:
      lines.push(["ATTENDEE", "ROLE", "CHAIR", "PARTSTAT", "ACCEPTED", "CN", participant.name, "MAILTO:" + participant.emailAddress]);
      break;
    case InvitationResponse.Tentative:
    case InvitationResponse.Accept:
    case InvitationResponse.Decline:
      lines.push(["ATTENDEE", "PARTSTAT", ParticipationStatus[participant.response], "CN", participant.name, "MAILTO:" + participant.emailAddress]);
      break;
    default:
      lines.push(["ATTENDEE", "RSVP", "TRUE", "CN", participant.name, "MAILTO:" + participant.emailAddress]);
      break;
    }
  }
  if (!method) {
    await addAttachments(lines, event);
  } // else: Invitations send the files as email attachments @see OutgoingInvitation.addAttachments()
  lines.push(["END", "VEVENT"]);
}

/** Inline attachments, RFC 5545 3.8.1.1.
 * `FILENAME` is RFC 8607, `X-FILENAME` is what Outlook writes. */
async function addAttachments(lines: (string | string[])[], event: Event): Promise<void> {
  if (event.attachments.isEmpty) {
    return;
  }
  await event.loadAttachments();
  for (let attachment of event.attachments) {
    if (!attachment.content) {
      continue; // We can't send what we don't have
    }
    lines.push(["ATTACH", "VALUE", "BINARY", "ENCODING", "BASE64",
      "FMTTYPE", attachment.mimeType, "FILENAME", attachment.filename, "X-FILENAME", attachment.filename,
      await attachment.contentAsBase64()]);
  }
}

/**
 * Exports the given events into a single large iCal .ics file with all contacts
 * concatenated
 * @param events what to export
 * @param filenameWithoutExt a suggested filename, without extension.
 *    The name will be name filesystem-safe.
 * @returns iCal file contents, as UTF8 text file
 */
export async function eventsToICalFile(events: Collection<Event>, filenameWithoutExt: string): Promise<File> {
  let fileContents = "";
  for (let event of events) {
    // TODO Don't wrap *each* `VEVENT` with `VCALENDAR`, but all with a single one
    fileContents += await getICal(event);
  }
  let filename = sanitize.filename(filenameWithoutExt) + ".ics";
  let file = new File([fileContents], filename, { type: "text/calendar" });
  return file;
}

function line2ical(line: string | string[]): string {
  if (typeof line == "string") {
    return line;
  }
  let text = line.shift();
  let value = line.pop();
  while (line.length) {
    text += ";" + line.shift() + "=" + escaped(line.shift(), true);
  }
  text += ":" + escaped(value, false);
  // Lines longer than 75 octets should be folded.
  // XXX should use TextEncoder to count octets.
  return text.match(/.{1,75}/gu).join("\r\n ") + "\r\n";
}

function utc2ical(date: Date): string {
  return date.toISOString().replace(/-|:|\..../g, "");
}

function date2ical(date: Date): string {
  return String(date.getFullYear()) + String(date.getMonth() + 1).padStart(2, "0") + String(date.getDate()).padStart(2, "0");
}

function datetime2ical(date: Date, timeZone: string): string {
  // "lt" locale has date format YYYY-MM-DD hh:mm:ss,
  // which we can easily convert into iCal format.
  return date.toLocaleString("lt", { timeZone }).replace(" ", "T").replace(/-|:/g, "");
}

function escaped(s: string, quote: boolean): string {
  if (!s) {
    return "";
  } else if (quote) {
    // param-value isn't supposed to include these at all;
    // maybe we should just delete them?
    s = s.replace(/["\\]/g, "\\$&").replace(/\r\n?|\n/g, "\\n");
    if (/[\\:;,]/.test(s)) {
      s = `"${s}"`;
    }
  } else {
    s = s.replace(/[\\;,]/g, "\\$&").replace(/\r\n?|\n/g, "\\n");
  }
  return s;
}
