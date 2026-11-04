import type { Event } from "../Event";
import { Participant } from "../Participant";
import { RecurrenceRule } from "../RecurrenceRule";
import { ParticipationStatus, InvitationResponse } from "../Invitation/InvitationStatus";
import { ContentDisposition } from "../../Abstract/Attachment";
import { ICalContainer, ICalParser } from "./ICalParser";
import { ICalTimezone } from "./ICalTimezone";
import { WindowsToIANATimezone } from "./WindowsTimezone";
import { fileExtensionForMIMEType } from "../../util/util";
import { base64ToUint8Array, stringFromDataURL } from "../../util/blob";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { gt } from "../../../l10n/l10n";
import type { ArrayColl } from "svelte-collections";

/**
 * @param ics iCal .ics contents to be parsed
 * @param event Output: Put the iCal data into this object
 * @returns whether an iCal event is indeed contained an event
 */
export function convertICalToEvent(ics: string, event: Event): boolean {
  let parsed = new ICalParser(ics);
  let vevents = parsed.containers.vcalendar?.[0].containers.vevent;
  if (!vevents?.length) {
    return false;
  }
  // A recurring event with modified occurrences has multiple VEVENTs:
  // the master, and one per modified occurrence, marked with RECURRENCE-ID.
  let master = vevents.find(v => !v.entries.recurrenceid) ?? vevents[0];
  convertICalContainerToEvent(master, event);
  return true;
}

/**
 * Takes a iCal .ics calendar file with events (multiple iCal events concatenated) and
 * returns Event objects for it.
 * @param iCalFile file contents
 * @param newEvent Factory function to create the subclass of Event that you need
 */
export function convertICalToEvents(iCalFile: string, newEvent: () => Event, errorCallback: (ex: Error) => void): Event[] {
  let events = [];
  let vevents = new ICalParser(iCalFile).containers.vcalendar?.flatMap(vcalendar => vcalendar.containers.vevent ?? []) ?? [];
  if (!vevents.length) {
    throw new Error(gt`No iCal found`);
  }
  for (let iCal of vevents) {
    try {
      let event = newEvent();
      convertICalContainerToEvent(iCal, event);
      events.push(event);
    } catch (ex) {
      errorCallback(ex);
    }
  }
  return events;
}

/**
 * @param ics iCal / ICS, already parsed
 * @param event Output: Put the ics data into this object
 * TODO need to handle more removed properties
 */
export function convertICalContainerToEvent(vevent: ICalContainer, event: Event): void {
  if (vevent.entries.uid) {
    event.calUID = vevent.entries.uid[0].value;
  }
  if (vevent.entries.summary) {
    event.title = vevent.entries.summary[0].value;
  }
  if (vevent.entries.description) {
    // Plaintext
    event.descriptionText = vevent.entries.description[0].value;
    // HTML RFC 2445 4.2.1, 4.2, RFC 5545 3.2.1 and Thunderbird
    // <https://datatracker.ietf.org/doc/html/rfc2445#section-4.2.1>
    // <https://bugzilla.mozilla.org/show_bug.cgi?id=1607834>
    let altrep = vevent.entries.description[0].properties.altrep;
    event.rawHTMLDangerous = stringFromDataURL(altrep, "text/html");
  }
  // HTML RFC 9073 6.5 <https://www.rfc-editor.org/rfc/rfc9073.html#name-styled-description>
  // Preference order: 1. RFC 9075, 2. Thunderbird, 3. Outlook
  if (vevent.entries.styleddescription) {
    let entry = vevent.entries.styleddescription.find(entry =>
      (!entry.properties.fmttype || entry.properties.fmttype.toLowerCase() == "text/html") &&
      entry.properties.value.toUpperCase() == "TEXT");
    if (entry) {
      event.rawHTMLDangerous = entry.value;
    }
  }
  // HTML Outlook
  if (vevent.entries.xaltdesc && !event.hasHTML) {
    let entry = vevent.entries.xaltdesc.find(entry =>
      (!entry.properties.fmttype || entry.properties.fmttype.toLowerCase() == "text/html"));
    if (entry) {
      event.rawHTMLDangerous = entry.value;
    }
  }
  if (vevent.entries.dtstart) {
    [event.startTime, event.timezone] = parseDate(vevent.entries.dtstart[0], vevent);
  }
  if (vevent.entries.dtend) {
    [event.endTime] = parseDate(vevent.entries.dtend[0], vevent);
  }
  if (vevent.entries.recurrenceid) {
    [event.recurrenceStartTime] = parseDate(vevent.entries.recurrenceid[0], vevent);
  }
  if (vevent.entries.dtstamp) {
    [event.lastUpdateTime] = parseDate(vevent.entries.dtstamp[0], vevent);
  }
  event.sequence = sanitize.integer(vevent.entries.sequence?.[0].value, 0);
  if (vevent.entries.dtstart?.[0].properties.value?.toLowerCase() == "date") {
    event.allDay = true;
  }
  if (vevent.entries.rrule && event.startTime) {
    event.recurrenceRule = RecurrenceRule.fromCalString(event.duration, event.timezone, event.startTime, vevent.entries.rrule[0].line);
  } else {
    event.recurrenceRule = null;
  }
  if (vevent.entries.conference) {
    // <https://www.rfc-editor.org/rfc/rfc7986#section-5.11>
    // There can be several, e.g. a `tel:` dial-in next to the video link
    event.isOnline = true;
    event.onlineMeetingURL = vevent.entries.conference
      .map(entry => sanitize.url(entry.value, null))
      .find(url => !!url) ?? null;
  }
  if (vevent.entries.location) {
    // Some clients send the online meeting URL in `LOCATION` (see `CONFERENCE` above)
    event.setLocationFromServer(vevent.entries.location[0].value);
  }
  if (vevent.entries.status?.[0].value == "CANCELLED") {
    event.isCancelled = true;
  }
  event.participants.clear(); // in case we're updating an existing event
  let organizer: Participant | undefined;
  let organizerEntry = vevent.entries.organizer?.[0];
  if (organizerEntry) {
    let emailAddress = sanitize.emailAddress(emailAddressFromCalAddress(organizerEntry.value), null);
    if (emailAddress) {
      organizer = new Participant(emailAddress, sanitize.label(organizerEntry.properties.cn, null), InvitationResponse.Organizer);
      event.participants.add(organizer);
    }
  }
  if (vevent.entries.attendee) {
    for (let { value, properties: { role, partstat, cn } } of vevent.entries.attendee) {
      let emailAddress = sanitize.emailAddress(emailAddressFromCalAddress(value), null);
      if (!emailAddress) {
        continue; // we cannot address this participant, e.g. free text instead of an address
      }
      let participant = new Participant(emailAddress, sanitize.label(cn, null), sanitize.integer(ParticipationStatus[partstat?.toUpperCase() as keyof typeof ParticipationStatus] || InvitationResponse.Unknown));
      if (participant.emailAddress == organizer?.emailAddress || /^CHAIR$/i.test(role)) {
        participant.response = InvitationResponse.Organizer;
        // Remove the organizer as it has less detail than an attendee
        if (organizer) {
          event.participants.remove(organizer);
          organizer = undefined;
        }
      }
      event.participants.add(participant);
    }
  }
  readAttachments(vevent, event);
}

/** ORGANIZER and ATTENDEE are a CAL-ADDRESS, RFC 5545 3.3.3, i.e. a `mailto:` URI.
 * // <compat for="Doctolib" reason="Writes `MAILTO:<foo@example.com>`, with the angle
 * brackets of an RFC 5322 mail header inside the URI, where RFC 6068 allows only the
 * bare address and RFC 3986 does not allow the brackets at all"> */
function emailAddressFromCalAddress(calAddress: string): string {
  return calAddress.replace(/^MAILTO:/i, "").replace(/^<(.*)>$/, "$1");
}

/** Inline attachments, RFC 5545 3.8.1.1.
 * Attachments that are only referenced by URI are not supported. */
function readAttachments(vevent: ICalContainer, event: Event): void {
  event.attachments.clear(); // in case we're updating an existing event
  let fallbackID = 0;
  for (let entry of vevent.entries.attach ?? []) {
    if (entry.properties.value?.toUpperCase() != "BINARY") {
      continue;
    }
    let attachment = event.newAttachment();
    attachment.mimeType = sanitize.nonemptystring(entry.properties.fmttype, "application/octet-stream");
    attachment.filename = sanitize.filename(
      entry.properties.filename ?? entry.properties["x-filename"] ?? entry.properties["x-apple-filename"],
      "attachment-" + ++fallbackID + "." + fileExtensionForMIMEType(attachment.mimeType));
    attachment.content = new File([base64ToUint8Array(entry.value)], attachment.filename, { type: attachment.mimeType });
    attachment.size = attachment.content.size;
    attachment.disposition = ContentDisposition.attachment;
    event.attachments.add(attachment);
  }
}

const icalDateRegex = /^(\d{4})(\d\d)(\d\dT\d\d)(\d\d)(\d\dZ?)$/;

/**
 * @param container The iCal component that contains the date, e.g. the `VEVENT`.
 *   The `VTIMEZONE`s next to it define the `TZID`s that are not IANA timezone names.
 */
export function parseDate(icalDate: { value: string, properties: { tzid?: string } }, container?: ICalContainer): [Date | null, string | null] {
  let value = icalDate.value;
  let tzid = icalDate.properties.tzid || null;
  if (value.length == 8) {
    // Represent dates as 00:00:00 local time.
    value += "T000000";
  }
  // Sanity check.
  if (!icalDateRegex.test(value)) {
    return [null, null];
  }
  // Convert to regular Date string format.
  value = value.replace(icalDateRegex, "$1-$2-$3:$4:$5");
  if (value.endsWith("Z")) { // UTC
    return [new Date(value), tzid || "UTC"];
  }
  if (!tzid) { // floating
    return [new Date(value), null];
  }
  if (tzid in WindowsToIANATimezone) {
    tzid = WindowsToIANATimezone[tzid];
  }
  value += "Z";
  let utc = new Date(value);
  try {
    // Work out the time zone offset for the time given as UTC.
    // "lt" locale has date format YYYY-MM-DD hh:mm:ss,
    // which we can easily convert into ISO format.
    let offset = new Date(utc.toLocaleString("lt", { timeZone: tzid }).replace(" ", "T") + "Z").getTime() - utc.getTime();
    let local = new Date(utc.getTime() - offset);
    // Check the time zone offset at this local time,
    // as that may have jumped across a DST change.
    offset = new Date(local.toLocaleString("lt", { timeZone: tzid }).replace(" ", "T") + "Z").getTime() - utc.getTime();
    if (offset) {
      local = new Date(local.getTime() - offset);
    }
    return [local, tzid];
  } catch (ex) {
    return [vtimezoneToUTC(container, tzid, utc), null];
  }
}

/**
 * For a `TZID` that is not an IANA timezone name, which the `VTIMEZONE`
 * next to `container` defines, RFC 5545 3.2.19
 * @param local The local time in the UTC fields
 */
function vtimezoneToUTC(container: ICalContainer | undefined, tzid: string, local: Date): Date | null {
  let vtimezone = container?.parent.containers.vtimezone?.find(vtimezone => vtimezone.entries.tzid?.[0].value == tzid);
  return vtimezone ? new ICalTimezone(vtimezone).toUTC(local) : null;
}
