import { Event, RecurrenceCase } from "../Event";
import type { TJMAPCalendarEvent, TJSCalendarAlert, TJSCalendarRecurrenceRule, TJSCalendarRecurrenceFrequency } from "./TJSCalendar";
import { Frequency, RecurrenceRule, type RecurrenceInit } from "../RecurrenceRule";
import { InvitationResponse } from "../Invitation/InvitationStatus";
import { Participant } from "../Participant";
import { k1DayS, k1HourS, k1MinuteS } from "../../util/date";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { NotImplemented, assert } from "../../util/util";
import { ArrayColl } from "svelte-collections";

export class JSCalendarEvent {
  static toEvent(jmap: TJMAPCalendarEvent, event: Event) {
    // ID and metadata
    if (!event.parentEvent) {
      event.calUID = sanitize.nonemptystring(jmap.uid, null);
    }
    event.lastUpdateTime = sanitize.date(jmap.updated, null);
    event.sequence = sanitize.integer(jmap.sequence, 0);
    event.original = jmap;

    // Text
    event.title = sanitize.nonemptystring(jmap.title, "");
    // RFC 8984 section 4.2.2: `description` defaults to "", so servers may leave it out
    let description = sanitize.string(jmap.description, "");
    if (jmap.descriptionContentType?.startsWith("text/html")) {
      event.descriptionHTML = description;
    } else { // text/plain, and anything else that we don't know what to do with
      event.descriptionText = description;
    }

    // Time
    event.startTime = this.toDate(jmap.start, jmap);
    event.timezone = jmap.timeZone ?? null;
    event.allDay = sanitize.boolean(jmap.showWithoutTime, false);
    event.duration = toSeconds(sanitize.nonemptystring(jmap.duration, "PT0S"));

    // Reminder. We support only one alarm per event, so take the first.
    event.alarm = this.toAlarm(Object.values(jmap.alerts ?? {})[0], event);

    // Recurrence
    if (jmap.recurrenceRule) {
      event.recurrenceCase = RecurrenceCase.Master;
      event.recurrenceRule = this.getRecurrenceRule(jmap, event.duration);
      // Exceptions and exclusions have to be handled by the caller,
      // once the event has been saved locally.
    }

    // Location
    if (jmap.locations) {
      let location = Object.values(jmap.locations)[0];
      event.location = sanitize.string(location.name, "");
      if (location.description) {
        event.location += kLocationNameDescriptionSeparator;
      }
      event.location += sanitize.string(location.description, "");
    }
    if (jmap.virtualLocations) {
      let conf = Object.values(jmap.virtualLocations)[0];
      event.isOnline = true;
      event.onlineMeetingURL = sanitize.url(conf.uri, null);
    }

    // Meeting with other participants
    event.isCancelled = jmap.status == "cancelled";
    if (jmap.participants) {
      let organizer = toEmailAddress(jmap.organizerCalendarAddress);
      let participants = new ArrayColl<Participant>();
      for (let id in jmap.participants) {
        let participant = jmap.participants[id];
        let emailAddress = toEmailAddress(participant.calendarAddress);
        let response =
          organizer && organizer == emailAddress ? InvitationResponse.Organizer :
            !participant.participationStatus || participant.participationStatus == "needs-action" ? InvitationResponse.NoResponseReceived :
              participant.participationStatus == "accepted" ? InvitationResponse.Accept :
                participant.participationStatus == "declined" ? InvitationResponse.Decline :
                  participant.participationStatus == "tentative" ? InvitationResponse.Tentative :
                    InvitationResponse.Unknown;
        let p = new Participant(emailAddress, participant.name, response);
        participants.add(p);
      }
      event.participants.replaceAll(participants);
      let myIdentities = event.calendar?.identitiesAvailable.contents ?? [];
      let me = participants.find(p => myIdentities.some(identity => identity.isEMailAddress(p.emailAddress)));
      if (me) {
        event.myParticipation = me.response;
      }
    }

    event.color = sanitize.nonemptystring(jmap.color, null);
  }

  static fromEvent(event: Event, jmap: TJMAPCalendarEvent) {
    // ID and metadata
    Object.assign(jmap, event.original);
    if (!event.parentEvent) {
      jmap.uid = event.calUID;
    }
    jmap.updated = (event.lastUpdateTime ?? new Date()).toISOString();
    // An invitation must keep the organizer's sequence, or the server ignores the organizer's next update
    if (event.isIncomingMeeting) {
      if (!event.parentEvent && event.sequence > (jmap.sequence ?? 0)) { // The organizer's change came by email
        jmap.sequence = event.sequence;
      }
    } else {
      jmap.sequence ??= -1;
      jmap.sequence++;
    }

    // Text
    jmap.title = event.title;
    if (event.hasHTML) {
      jmap.descriptionContentType = "text/html";
      jmap.description = event.rawHTMLDangerous;
    } else {
      jmap.descriptionContentType = "text/plain";
      jmap.description = event.descriptionText;
    }

    // Time
    jmap.start = this.fromDate(event.startTime, event);
    jmap.duration = fromSeconds(event.duration);
    jmap.timeZone = event.timezone;
    jmap.showWithoutTime = event.allDay;

    // Reminder. Keep an unchanged alert as it is: ours is an offset from the start
    // and fires before every occurrence, an absolute trigger only once.
    let alert = Object.values(jmap.alerts ?? {})[0];
    if (this.toAlarm(alert, event)?.getTime() != event.alarm?.getTime()) {
      jmap.useDefaultAlerts = false; // or the server ignores our alerts
      if (!event.alarm) {
        delete jmap.alerts[Object.keys(jmap.alerts)[0]];
      } else if (alert) {
        alert.trigger = this.fromAlarm(event);
      } else {
        (jmap.alerts ??= {})["0"] = { "@type": "Alert", action: "display", trigger: this.fromAlarm(event) };
      }
    }

    // Recurrence
    if (event.recurrenceCase == RecurrenceCase.Master) {
      let er = event.recurrenceRule;
      let jr = jmap.recurrenceRule;
      // Keep the parts of the rule that we don't support, unless the user changed the repetition
      if (!jr || !this.isSameRepetition(this.getRecurrenceRule(jmap, event.duration), er)) {
        jr = jmap.recurrenceRule ??= {} as TJSCalendarRecurrenceRule;
        delete jr.byMonthDay;
        delete jr.byMonth;
        delete jr.byYearDay;
        delete jr.byWeekNo;
        delete jr.byHour;
        delete jr.byMinute;
        delete jr.bySecond;
        delete jr.bySetPosition;
        jr.frequency = er.frequency.toLowerCase() as TJSCalendarRecurrenceFrequency;
        jr.interval = er.interval;
        jr.firstDayOfWeek = jsCalWeekday[er.first];
        if (er.weekdays) {
          if (er.week) {
            jr.byDay = er.weekdays.map(day => ({ day: jsCalWeekday[day], nthOfPeriod: er.week == 5 ? -1 : er.week }));
          } else {
            jr.byDay = er.weekdays.map(day => ({ day: jsCalWeekday[day] }));
          }
        } else {
          delete jr.byDay;
        }
      }
      if (er.seriesEndTime) {
        delete jr.count;
        jr.until = this.fromDate(er.seriesEndTime, event);
      } else if (Number.isFinite(er.count)) {
        delete jr.until;
        jr.count = er.count;
      } else {
        delete jr.count;
        delete jr.until;
      }
      for (let exclusion of event.exclusions) {
        let ro = jmap.recurrenceOverrides ??= {};
        ro[this.fromDate(exclusion, event)] = { excluded: true } as TJMAPCalendarEvent;
      }
      for (let exception of event.exceptions) {
        let ro = jmap.recurrenceOverrides ??= {};
        this.fromEvent(exception, ro[this.fromDate(exception.recurrenceStartTime, event)] ??= {} as TJMAPCalendarEvent);
      }
    }

    // Location
    if (event.location) {
      jmap.locations ??= {};
      let location = Object.values(jmap.locations)[0];
      if (!location) {
        location = {
          "@type": "Location",
        };
        jmap.locations["0"] = location;
      }
      let descriptionPos = event.location.indexOf(kLocationNameDescriptionSeparator);
      if (descriptionPos > 1) {
        location.name = event.location.substring(0, descriptionPos);
        location.description = event.location.substring(descriptionPos + kLocationNameDescriptionSeparator.length);
      } else {
        location.name = event.location;
        delete location.description;
      }
    } else if (jmap.locations) {
      let first = Object.keys(jmap.locations)[0];
      delete jmap.locations[first];
    }
    if (event.isOnline && event.onlineMeetingURL) {
      jmap.virtualLocations ??= {};
      let location = Object.values(jmap.virtualLocations)[0];
      if (!location) {
        location = {
          "@type": "VirtualLocation",
          uri: "",
        };
        jmap.virtualLocations["0"] = location;
      }
      location.uri = event.onlineMeetingURL;
    } else if (jmap.virtualLocations) {
      let first = Object.keys(jmap.virtualLocations)[0];
      delete jmap.virtualLocations[first];
    }

    // Meeting with other participants
    if (event.isCancelled) {
      jmap.status = "cancelled";
    } else if (jmap.status == "cancelled") {
      jmap.status = null;
    }
    if (event.participants.hasItems) {
      jmap.participants ??= {};
      for (let id of Object.keys(jmap.participants)) {
        let participant = jmap.participants[id];
        let emailAddress = toEmailAddress(participant.calendarAddress);
        let p = emailAddress
          ? event.participants.find(p => p.emailAddress?.toLowerCase() == emailAddress)
          : event.participants.find(p => p.name == participant.name);
        if (!p) {
          delete jmap.participants[id];
          continue;
        }
        if (p.response == InvitationResponse.Organizer) {
          participant.roles ??= {};
          participant.roles.owner = true;
        } else if (p.response == InvitationResponse.Accept) {
          participant.participationStatus = "accepted";
        } else if (p.response == InvitationResponse.Decline) {
          participant.participationStatus = "declined";
        } else if (p.response == InvitationResponse.Tentative) {
          participant.participationStatus = "tentative";
        } else if (p.response == InvitationResponse.NoResponseReceived) {
          participant.participationStatus = "needs-action";
        } else if (p.response == InvitationResponse.Unknown) {
          // JMAP status that we don't support. Keep it as-is.
        } // else `InvitationResponse` not yet listed here -> keep as-is
      }
      // Add the participants that are not in the JSCalendar event yet
      for (let p of event.participants) {
        let existing = Object.values(jmap.participants).find(participant => {
          let emailAddress = toEmailAddress(participant.calendarAddress);
          return emailAddress
            ? emailAddress == p.emailAddress?.toLowerCase()
            : participant.name == p.name;
        });
        if (existing) {
          continue;
        }
        jmap.participants[crypto.randomUUID()] = {
          "@type": "Participant",
          name: p.name,
          calendarAddress: p.emailAddress ? "mailto:" + p.emailAddress : undefined,
          roles: p.response == InvitationResponse.Organizer ? { owner: true } : { attendee: true },
          participationStatus:
            p.response == InvitationResponse.Accept ? "accepted" :
            p.response == InvitationResponse.Decline ? "declined" :
            p.response == InvitationResponse.Tentative ? "tentative" :
            "needs-action",
        };
      }
      if (event.organizer?.emailAddress) {
        jmap.organizerCalendarAddress = "mailto:" + event.organizer.emailAddress;
      }
    } else {
      delete jmap.participants;
      delete jmap.organizerCalendarAddress;
    }

    jmap.color = event.color;
  }

  /** @param masterDuration in seconds */
  static getRecurrenceRule(jmap: TJMAPCalendarEvent, masterDuration: number): RecurrenceRule {
    let r = jmap.recurrenceRule;
    let rrinit: RecurrenceInit = {
      masterDuration,
      timezone: jmap.timeZone ?? null,
      seriesStartTime: this.toDate(jmap.start, jmap),
      seriesEndTime: this.toDate(r.until, jmap, null),
      count: sanitize.integer(r.count, Infinity),
    // iCal and we don't support hourly, minutely or secondly. Esp. the latter is pretty silly
      frequency: sanitize.translate(r.frequency, {
        yearly: Frequency.Yearly,
        monthly: Frequency.Monthly,
        weekly: Frequency.Weekly,
        daily: Frequency.Daily,
      }, Frequency.Yearly),
      interval: sanitize.integerRange(r.interval, 1, Infinity, 1),
      first: sanitize.integer(jsCalWeekday[r.firstDayOfWeek as keyof typeof jsCalWeekday], jsCalWeekday.mo),
    };
    if (r.byDay) {
      rrinit.weekdays = r.byDay.map(day => sanitize.integer(jsCalWeekday[day.day as keyof typeof jsCalWeekday]));
      // jsCalendar uses -1..4 but we use 0..5
      rrinit.week = (sanitize.integer(r.byDay[0].nthOfPeriod, 0) + 6) % 6;
    }
    return new RecurrenceRule(rrinit);
  }

  /** Whether `rule` repeats like `serverRule`, apart from the start and the end of the series */
  protected static isSameRepetition(serverRule: RecurrenceRule, rule: RecurrenceRule): boolean {
    return serverRule.frequency == rule.frequency &&
      serverRule.interval == rule.interval &&
      serverRule.week == rule.week &&
      serverRule.first == rule.first &&
      [...serverRule.weekdays ?? []].sort().join() == [...rule.weekdays ?? []].sort().join();
  }

  /** When the alert fires. null, if there is none, or we don't know the trigger. */
  static toAlarm(alert: TJSCalendarAlert | undefined, event: Event): Date | null {
    let trigger = alert?.trigger;
    if (trigger?.["@type"] == "AbsoluteTrigger") {
      return sanitize.date(trigger.when, null);
    }
    // OffsetTrigger is the default type of a trigger
    if (trigger && (trigger["@type"] ?? "OffsetTrigger") == "OffsetTrigger" && "offset" in trigger) {
      let relativeTo = trigger.relativeTo == "end" ? event.endTime : event.startTime;
      return new Date(relativeTo.getTime() + toSeconds(trigger.offset) * 1000);
    }
    return null;
  }

  /** Always an offset from the start, because that's all that our UI can set */
  static fromAlarm(event: Event): TJSCalendarAlert["trigger"] {
    return {
      "@type": "OffsetTrigger",
      offset: fromSeconds(Math.round((event.alarm.getTime() - event.startTime.getTime()) / 1000)),
    };
  }

  static toDate(date: string, jmap: TJMAPCalendarEvent, fallback?: null): Date {
    if (!date) {
      return null;
    }
    if (/Z$/.test(date) || !jmap.timeZone || jmap.showWithoutTime) {
      // Easy cases:
      // - date was already in UTC
      // - no time zone was provided
      // - event is an all-day event
      return sanitize.date(date, fallback);
    }
    date += "Z";
    let utc = sanitize.date(date, fallback);
    // Work out the time zone offset for the time given as UTC.
    // "lt" locale has date format YYYY-MM-DD hh:mm:ss,
    // which we can easily convert into ISO format.
    let offset = new Date(utc.toLocaleString("lt", { timeZone: jmap.timeZone }).replace(" ", "T") + "Z").getTime() - utc.getTime();
    let local = new Date(utc.getTime() - offset);
    // Check the time zone offset at this local time,
    // as that may have jumped across a DST change.
    offset = new Date(local.toLocaleString("lt", { timeZone: jmap.timeZone }).replace(" ", "T") + "Z").getTime() - utc.getTime();
    if (offset) {
      local = new Date(local.getTime() - offset);
    }
    return local;
  }

  static fromDate(date: Date, event: Event): string {
    // "lt" locale has date/time format YYYY-MM-DD HH:MM:SS.
    if (event.allDay) {
      // toISOString() might return the wrong date
      return date.toLocaleDateString("lt") + "T00:00:00";
    }
    let options = event.timezone ? { timeZone: event.timezone } : undefined;
    return date.toLocaleString("lt", options).replace(" ", "T");
  }
}

/** @param duration ISO 8601, e.g. "PT1H". Alarm offsets may be negative, e.g. "-PT15M". */
function toSeconds(duration: string): number {
  let match = duration.match(/^(-?)P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/);
  assert(match, "JSCalendar duration is invalid. Bad value: " + duration);
  let [, sign, weeks, days, hours, minutes, seconds] = match;
  let total = (Number(weeks || 0) * 7 + Number(days || 0)) * k1DayS
    + Number(hours || 0) * k1HourS
    + Number(minutes || 0) * k1MinuteS
    + Number(seconds || 0);
  return sign ? -total : total;
}

/** @param seconds may be negative, for alarm offsets */
function fromSeconds(seconds: number): string {
  let sign = seconds < 0 ? "-" : "";
  let abs = Math.abs(seconds);
  if (abs % k1DayS == 0) {
    return sign + "P" + abs / k1DayS + "D";
  } else if (abs % k1HourS == 0) {
    return sign + "PT" + abs / k1HourS + "H";
  } else if (abs % k1MinuteS == 0) {
    return sign + "PT" + abs / k1MinuteS + "M";
  }
  return sign + "PT" + abs + "S";
}

/**
 * @param calendarAddress mailto: URI, e.g. "mailto:fred@example.com"
 * @returns e.g. "fred@example.com", or null, if it's not a mailto: URI with a valid email address
 */
function toEmailAddress(calendarAddress: string | undefined): string | null {
  return sanitize.emailAddress(calendarAddress?.replace(/^mailto:/i, ""), null);
}

const kLocationNameDescriptionSeparator = "\n---\n";

/** Maps between jsCal names and JavaScript day of week values */
enum jsCalWeekday {
  su = 0,
  mo = 1,
  tu = 2,
  we = 3,
  th = 4,
  fr = 5,
  sa = 6,
}
