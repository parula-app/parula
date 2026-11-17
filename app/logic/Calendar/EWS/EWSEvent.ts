import { ExchangeEvent } from "./ExchangeEvent";
import { RecurrenceCase } from "../Event";
import { Participant } from "../Participant";
import { InvitationResponse, type InvitationResponseInMessage } from "../Invitation/InvitationStatus";
import { Frequency, Weekday, RecurrenceRule } from "../RecurrenceRule";
import { IANAToWindowsTimezone, WindowsToIANATimezone } from "../ICal/WindowsTimezone";
import type { EWSCalendar } from "./EWSCalendar";
import { EWSOutgoingInvitation } from "./EWSOutgoingInvitation";
import { EWSCreateItemRequest } from "../../Mail/EWS/Request/EWSCreateItemRequest";
import { EWSDeleteItemRequest } from "../../Mail/EWS/Request/EWSDeleteItemRequest";
import { EWSUpdateItemRequest } from "../../Mail/EWS/Request/EWSUpdateItemRequest";
import { getEmailAddressOrX400 } from "../../Mail/EWS/EWSEMail";
import { ContentDisposition } from "../../Abstract/Attachment";
import { k1MinuteMS } from "../../util/date";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert, ensureArray } from "../../util/util";
import { base64ToUint8Array } from "../../util/blob";
import type { ArrayColl } from "svelte-collections";

const ResponseTypes: Record<InvitationResponseInMessage, string> = {
  [InvitationResponse.Accept]: "AcceptItem",
  [InvitationResponse.Tentative]: "TentativelyAcceptItem",
  [InvitationResponse.Decline]: "DeclineItem",
};

enum WeekOfMonth {
  'First' = 1,
  'Second' = 2,
  'Third' = 3,
  'Fourth'= 4,
  'Last' = 5,
};

const RecurrenceType: Record<string, Frequency> = {
  RelativeYearlyRecurrence: Frequency.Yearly,
  AbsoluteYearlyRecurrence: Frequency.Yearly,
  RelativeMonthlyRecurrence: Frequency.Monthly,
  AbsoluteMonthlyRecurrence: Frequency.Monthly,
  WeeklyRecurrence: Frequency.Weekly,
  DailyRecurrence: Frequency.Daily,
};

export class EWSEvent extends ExchangeEvent {
  declare calendar: EWSCalendar;
  declare parentEvent: EWSEvent;
  declare readonly exceptions: ArrayColl<EWSEvent>;

  get itemID(): string | null {
    return this.pID;
  }
  set itemID(val: string | null) {
    this.pID = val;
  }

  fromXML(xmljs: Record<string, any>) {
    this.itemID = sanitize.nonemptystring(xmljs.ItemId.Id);
    this.calUID = sanitize.nonemptystring(xmljs.UID, null);
    this.title = sanitize.nonemptystring(xmljs.Subject, "");
    if (xmljs.Body?.BodyType == "Text") {
      this.rawText = sanitize.nonemptystring(xmljs.Body.Value, "");
      this.rawHTMLDangerous = null;
    } else {
      this.rawText = sanitize.nonemptystring(xmljs.TextBody?.Value, "");
      if (xmljs.Body?.BodyType == "HTML") {
        this.rawHTMLDangerous = sanitize.nonemptystring(xmljs.Body.Value, "");
      } else {
        this.rawHTMLDangerous = null;
      }
    }
    if (xmljs.DateTimeStamp) {
      this.lastUpdateTime = sanitize.date(xmljs.DateTimeStamp);
    }
    if (xmljs.RecurrenceId) {
      this.recurrenceStartTime = sanitize.date(xmljs.RecurrenceId);
      // In case it's not otherwise provided to us.
      this.startTime = new Date(this.recurrenceStartTime);
    }
    if (xmljs.Start) {
      this.startTime = sanitize.date(xmljs.Start);
    }
    if (xmljs.End) {
      this.endTime = sanitize.date(xmljs.End);
    }
    if (xmljs.DueDate) {
      this.endTime = sanitize.date(xmljs.DueDate);
    }
    this.timezone = fromWindowsZone(sanitize.nonemptystring(xmljs.StartTimeZoneId, null));
    this.allDay = sanitize.boolean(xmljs.IsAllDayEvent, false);
    this.setAllDayTimeToLocalMidnight();
    if (xmljs.Recurrence) {
      this.recurrenceRule = this.newRecurrenceRuleFromXML(xmljs.Recurrence);
      if (xmljs.DeletedOccurrences?.DeletedOccurrence) {
        for (let deletion of ensureArray(xmljs.DeletedOccurrences.DeletedOccurrence)) {
          this.makeExclusionLocally(this.toLocalMidnight(sanitize.date(deletion.Start)));
        }
      }
    } else {
      this.recurrenceRule = null;
    }
    if (xmljs.ReminderIsSet == "true") {
      this.alarm = new Date(this.startTime.getTime() - k1MinuteMS * sanitize.integer(xmljs.ReminderMinutesBeforeStart));
    } else {
      this.alarm = null;
    }
    this.setLocationFromServer(sanitize.nonemptystring(xmljs.Location, ""));
    this.isCancelled = sanitize.boolean(xmljs.IsCancelled, false);
    let organizer: string | undefined;
    let participants: Participant[] = [];
    if (xmljs.Organizer && (xmljs.RequiredAttendees?.Attendee || xmljs.OptionalAttendees?.Attendee)) {
      organizer = getEmailAddressOrX400(xmljs.Organizer.Mailbox.EmailAddress);
      xmljs.Organizer.ResponseType = "Organizer";
      addParticipants(xmljs.Organizer, participants);
    }
    if (xmljs.RequiredAttendees?.Attendee) {
      addParticipants(xmljs.RequiredAttendees.Attendee, participants, organizer);
    }
    if (xmljs.OptionalAttendees?.Attendee) {
      addParticipants(xmljs.OptionalAttendees.Attendee, participants, organizer);
    }
    this.participants.replaceAll(participants);
    if (xmljs.MyResponseType) {
      this.myParticipation = sanitize.integer(InvitationResponse[xmljs.MyResponseType], InvitationResponse.Unknown);
    }
    if (xmljs.LastModifiedTime) {
      this.lastMod = sanitize.date(xmljs.LastModifiedTime);
    }
    this.attachmentsFromXML(xmljs);
  }

  /** Only the meta-data. The contents are fetched later,
   * @see downloadAttachmentsFromServer() */
  protected attachmentsFromXML(xmljs: Record<string, any>) {
    let attachments = ensureArray(xmljs.Attachments?.FileAttachment);
    this.attachments.replaceAll(attachments.map(a => {
      let attachment = this.newAttachment();
      attachment.pID = sanitize.nonemptystring(a.AttachmentId.Id);
      attachment.filename = sanitize.filename(a.Name, "attachment");
      attachment.mimeType = sanitize.nonemptystring(a.ContentType, "application/octet-stream");
      attachment.size = sanitize.integer(a.Size, null);
      attachment.disposition = ContentDisposition.attachment;
      return attachment;
    }));
  }

  protected async downloadAttachmentsFromServer(): Promise<void> {
    for (let attachment of this.attachments) {
      if (attachment.content || !attachment.pID) {
        continue;
      }
      let response = await this.calendar.account.callEWS({
        m$GetAttachment: {
          m$AttachmentIds: {
            t$AttachmentId: {
              Id: attachment.pID,
            },
          },
        },
      });
      let content = sanitize.nonemptystring(response.Attachments.FileAttachment.Content);
      attachment.content = new File([base64ToUint8Array(content)],
        attachment.filename, { type: attachment.mimeType });
      attachment.size = attachment.content.size;
    }
  }

  /** Exchange cannot save attachments as part of the event,
   * but needs separate calls, after the event exists on the server. */
  protected async saveAttachmentsToServer(): Promise<void> {
    let removed = this.removedAttachments;
    if (removed.length) {
      await this.calendar.account.callEWS({
        m$DeleteAttachment: {
          m$AttachmentIds: {
            t$AttachmentId: removed.map(attachment => ({
              Id: attachment.pID,
            })),
          },
        },
      });
    }
    for (let attachment of this.attachments) {
      if (attachment.pID) {
        continue; // already on the server
      }
      await attachment.load();
      let response = await this.calendar.account.callEWS({
        m$CreateAttachment: {
          m$ParentItemId: {
            Id: this.itemID,
          },
          m$Attachments: {
            t$FileAttachment: {
              t$Name: attachment.filename,
              t$ContentType: attachment.mimeType,
              t$Content: await attachment.contentAsBase64(),
            },
          },
        },
      });
      attachment.pID = sanitize.nonemptystring(response.Attachments.FileAttachment.AttachmentId.Id);
    }
  }

  protected newRecurrenceRuleFromXML(xmljs: any): RecurrenceRule {
    let masterDuration = this.duration;
    let timezone = this.timezone;
    let seriesStartTime = this.startTime;
    let seriesEndTime: Date | null = null;
    if (xmljs.EndDateRecurrence) {
      // These dates don't have a time, but they do have a time zone suffixed.
      // Parse them as machine-local time, like the iCal path does,
      // because `dateString()` writes them back using machine-local date fields.
      if (!seriesStartTime) {
        this.startTime = seriesStartTime = sanitize.date(xmljs.EndDateRecurrence.StartDate.slice(0, 10) + "T00:00:00");
      }
      // RecurrenceRule wants this to be at least the same time as the endTime
      seriesEndTime = sanitize.date(xmljs.EndDateRecurrence.EndDate.slice(0, 10) + "T23:59:59");
    }
    let count = sanitize.integer(xmljs.NumberedRecurrence?.NumberOfOccurrences, Infinity);
    let key = Object.keys(RecurrenceType).find(key => key in xmljs);
    let pattern = xmljs[key];
    let frequency = RecurrenceType[key];
    let interval = sanitize.integer(pattern.Interval, 1);
    let weekdays = extractWeekdays(sanitize.nonemptystring(pattern.DaysOfWeek, null));
    let week = sanitize.integer(WeekOfMonth[pattern.DayOfWeekIndex], 0);
    let first = sanitize.integer(Weekday[pattern.FirstDayOfWeek], Weekday.Monday);
    return new RecurrenceRule({ masterDuration, timezone, seriesStartTime, seriesEndTime, count, frequency, interval, weekdays, week, first });
  }

  get outgoingInvitation() {
    return new EWSOutgoingInvitation(this);
  }

  async saveToServer() {
    await this.prepareSaveToServer();

    /* Exchange saves the attachments separately from the event, and sends the
     * invitations while saving the event. So, when creating a meeting that has
     * attachments, create it without the attendees first, which sends no
     * invitation, and add the attendees only after the attachments.
     * Otherwise, the attendees would get 2 invitations,
     * and the first one without the attachments. */
    let isNew = !this.itemID;
    let inviteAfterAttachments = isNew && !this.parentEvent &&
      this.participants.hasItems && this.attachments.hasItems;

    /* Disabling tasks for now.
    if (this.startTime) {
    */
      await this.saveCalendarItemToServer(inviteAfterAttachments);
    /* Disabling tasks for now.
    } else {
      await this.saveTask();
    }
    */
    await this.saveAttachmentsToServer();
    if (inviteAfterAttachments) {
      await this.saveCalendarItemToServer();
    }
    if (isNew) {
      await this.saveLocally(); // Save server IDs, otherwise we get dups
    }
  }

  /** @param withoutAttendees Save the event as an appointment without
   *   attendees, so that the server sends no invitations yet. @see saveToServer() */
  async saveCalendarItemToServer(withoutAttendees = false) {
    let request: any = this.itemID ?
      new EWSUpdateItemRequest(this.itemID, { SendMeetingInvitationsOrCancellations: "SendToAllAndSaveCopy" }) :
      this.parentEvent ?
      new EWSUpdateOccurrenceRequest(this, { SendMeetingInvitationsOrCancellations: "SendToAllAndSaveCopy" }) :
      new EWSCreateItemRequest({ m$SavedItemFolderId: { t$FolderId: { Id: this.calendar.folderID } }, SendMeetingInvitations: withoutAttendees ? "SendToNone" : "SendToAllAndSaveCopy" });
    if (this.isIncomingMeeting) {
      request.addField("CalendarItem", "ReminderIsSet", this.alarm != null, "item:ReminderIsSet");
      request.addField("CalendarItem", "ReminderMinutesBeforeStart", this.alarmMinutesBeforeStart(), "item:ReminderMinutesBeforeStart");
      await this.calendar.account.callEWS(request);
      return;
    }
    request.addField("CalendarItem", "Subject", this.title, "item:Subject");
    request.addField("CalendarItem", "Body", this.rawHTMLDangerous ? { BodyType: "HTML", _TextContent_: this.rawHTMLDangerous } : { BodyType: "Text", _TextContent_: this.descriptionText }, "item:Body");
    request.addField("CalendarItem", "ReminderIsSet", this.alarm != null, "item:ReminderIsSet");
    request.addField("CalendarItem", "ReminderMinutesBeforeStart", this.alarmMinutesBeforeStart(), "item:ReminderMinutesBeforeStart");
    if (this.calUID && !this.itemID && !this.parentEvent) {
      // This probably only makes sense when creating an event.
      // (And it's not even needed then as Exchange will auto-generate one.)
      request.addField("CalendarItem", "UID", this.calUID, "calendar:UID");
    }
    request.addField("CalendarItem", "Start", this.dateString(this.startTime), "calendar:Start");
    request.addField("CalendarItem", "End", this.dateString(this.endTime), "calendar:End");
    request.addField("CalendarItem", "IsAllDayEvent", this.allDay, "calendar:IsAllDayEvent");
    request.addField("CalendarItem", "Location", this.getLocationForServer(), "calendar:Location");
    request.addField("CalendarItem", "RequiredAttendees", !withoutAttendees && this.participants.hasItems ? {
      t$Attendee: this.participants.contents.map(entry => ({
        t$Mailbox: {
          t$EmailAddress: entry.emailAddress,
          t$Name: entry.name,
        }
      })),
    } : "", "calendar:RequiredAttendees");
    // No support for optional attendees in mustang;
    // all attendees get converted to be required for now.
    request.addField("CalendarItem", "OptionalAttendees", null, "calendar:OptionalAttendees");
    if (!this.parentEvent) { // Exchange Online requires not to write the `Recurrence` prop for recurrence instances
      request.addField("CalendarItem", "Recurrence", this.recurrenceRule ? this.saveRule(this.recurrenceRule) : null, "calendar:Recurrence");
    }
    let timezone = IANAToWindowsTimezone[this.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone] || "UTC";
    request.addField("CalendarItem", "StartTimeZone", { Id: timezone }, "calendar:StartTimeZone");
    request.addField("CalendarItem", "EndTimeZone", { Id: timezone }, "calendar:EndTimeZone");
    let response = await this.calendar.account.callEWS(request);
    this.itemID = sanitize.nonemptystring(response.Items.CalendarItem.ItemId.Id);

    if (!this.calUID) {
      // Need an extra server roundtrip to get the UID
      request = {
        m$GetItem: {
          m$ItemShape: {
            t$BaseShape: "IdOnly",
            t$AdditionalProperties: {
              t$FieldURI: [{
                FieldURI: "calendar:UID",
              }],
            },
          },
          m$ItemIds: {
            t$ItemId: response.Items.CalendarItem.ItemId,
          },
        },
      };
      response = await this.calendar.account.callEWS(request);
      this.calUID = sanitize.nonemptystring(response.Items.CalendarItem.UID);
    }
  }

  async saveTask() {
    let request = this.itemID ? new EWSUpdateItemRequest(this.itemID) : new EWSCreateItemRequest({ m$SavedItemFolderId: { t$FolderId: { Id: this.calendar.folderID } } });
    request.addField("Task", "Subject", this.title, "item:Subject");
    request.addField("Task", "ReminderIsSet", this.alarm != null, "item:ReminderIsSet");
    request.addField("Task", "ReminderMinutesBeforeStart", this.alarmMinutesBeforeStart(), "item:ReminderMinutesBeforeStart");
    request.addField("Task", "DueDate", this.endTime?.toISOString(), "task:DueDate");
    request.addField("Task", "Recurrence", this.recurrenceRule ? this.saveRule(this.recurrenceRule) : null, "task:Recurrence");
    let response = await this.calendar.account.callEWS(request);
    this.itemID = sanitize.nonemptystring(response.Items.Task.ItemId.Id);
  }

  dateString(date: Date, day: boolean = this.allDay): string {
    if (day) {
      return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
    }
    return date.toISOString();
  }

  alarmMinutesBeforeStart(): number {
    if (!this.alarm) {
      // Exchange requires a value, even if there is no alarm.
      // It uses a separate flag for whether the alarm is set.
      return 0;
    }
    return (this.alarm.getTime() - this.startTime.getTime()) / -k1MinuteMS | 0;
  }

  saveRule(rule: RecurrenceRule) {
    let recurrenceType = rule.frequency[0] + rule.frequency.slice(1).toLowerCase();
    if (recurrenceType == "Yearly" || recurrenceType == "Monthly") {
      recurrenceType = (rule.week ? "Relative" : "Absolute") + recurrenceType;
    }
    let pattern: any = {};
    if (rule.frequency != Frequency.Yearly) {
      pattern.t$Interval = rule.interval;
    }
    if (/^Relative/.test(recurrenceType)) {
      let weekdays = rule.weekdays || [rule.seriesStartTime.getUTCDay()];
      pattern.t$DaysOfWeek = relativeWeekdayString(weekdays);
    } else if (/^Weekly/.test(recurrenceType)) {
      let weekdays = rule.weekdays || [rule.seriesStartTime.getUTCDay()];
      pattern.t$DaysOfWeek = weekdays.map(day => Weekday[day]).join(" ");
    }
    if (rule.frequency == Frequency.Weekly) {
      pattern.t$FirstDayOfWeek = Weekday[rule.first];
    }
    if (/Relative/.test(recurrenceType)) {
      pattern.t$DayOfWeekIndex = WeekOfMonth[rule.week];
    }
    if (/Absolute/.test(recurrenceType)) {
      pattern.t$DayOfMonth = rule.seriesStartTime.getUTCDate();
    }
    if (rule.frequency == Frequency.Yearly) {
      pattern.t$Month = rule.seriesStartTime.toLocaleDateString("en", { month: "long", timeZone: "UTC" });
    }
    let recurrence: any = {};
    recurrence[`t$${recurrenceType}Recurrence`] = pattern;
    if (rule.count < Infinity) {
      recurrence.t$NumberedRecurrence = {
        t$StartDate: this.dateString(this.startTime, true),
        t$NumberOfOccurrences: rule.count,
      };
    } else if (rule.seriesEndTime) {
      recurrence.t$EndDateRecurrence = {
        t$StartDate: this.dateString(this.startTime, true),
        t$EndDate: this.dateString(rule.seriesEndTime, true),
      };
    } else {
      recurrence.t$NoEndRecurrence = {
        t$StartDate: this.dateString(this.startTime, true),
      };
    }
    return recurrence;
  }

  async deleteFromServer() {
    if (this.itemID) {
      // This works both for recurring masters and exceptions.
      let request = new EWSDeleteItemRequest(this.itemID, {
        DeleteType: "HardDelete",
        SendMeetingCancellations: "SendToAllAndSaveCopy",
      });
      try {
        await this.calendar.account.callEWS(request);
      } catch (ex) {
        if (ex.type == "ErrorItemNotFound") {
          // already done
        } else {
          throw ex;
        }
      }
    } else if (this.parentEvent) {
      // Create an exclusion.
      let request = {
        m$DeleteItem: {
          m$ItemIds: {
            t$OccurrenceItemId: {
              RecurringMasterId: this.parentEvent.itemID,
              InstanceIndex: this.parentEvent.recurrenceRule.getIndexOfOccurrence(this.recurrenceStartTime) + 1,
            },
          },
          DeleteType: "HardDelete",
          SendMeetingCancellations: "SendToAllAndSaveCopy",
        },
      };
      await this.calendar.account.callEWS(request);
    }
  }

  /** Returns a copy of the event as read from the server */
  async fetchFromServer(): Promise<EWSEvent> {
    assert(this.itemID, "can't query unsaved event");
    let request = {
      m$GetItem: {
        m$ItemShape: {
          t$BaseShape: "Default",
          t$BodyType: "Best",
          t$AdditionalProperties: {
            t$FieldURI: [{
              FieldURI: "item:Body",
            }, {
              FieldURI: "item:Attachments",
            }, {
              FieldURI: "item:ReminderIsSet",
            }, {
              FieldURI: "item:ReminderMinutesBeforeStart",
            }, {
              FieldURI: "item:LastModifiedTime",
            }, {
              FieldURI: "item:TextBody",
            }, {
              FieldURI: "calendar:StartTimeZoneId",
            }, {
              FieldURI: "calendar:IsAllDayEvent",
            }, {
              FieldURI: "calendar:MyResponseType",
            }, {
              FieldURI: "calendar:RequiredAttendees",
            }, {
              FieldURI: "calendar:OptionalAttendees",
            }, {
              FieldURI: "calendar:Recurrence",
            }, {
              FieldURI: "calendar:ModifiedOccurrences",
            }, {
              FieldURI: "calendar:DeletedOccurrences",
            }, {
              FieldURI: "calendar:UID",
            }, {
              FieldURI: "calendar:RecurrenceId",
            }, {
              FieldURI: "task:Recurrence",
            }],
          },
        },
        m$ItemIds: {
          t$ItemId: {
            Id: this.itemID,
          },
        },
      },
    };
    let result = await this.calendar.account.callEWS(request);
    let event = this.calendar.newEvent(this.parentEvent);
    event.fromXML(result.Items.CalendarItem);
    return event;
  }

  async makeExclusions(exclusions: EWSEvent[]) {
    let request = {
      m$DeleteItem: {
        m$ItemIds: exclusions.map(event => ({
          t$OccurrenceItemId: {
            RecurringMasterId: this.itemID,
            InstanceIndex: this.recurrenceRule.getIndexOfOccurrence(event.recurrenceStartTime) + 1,
          },
        })),
        DeleteType: "HardDelete",
        SendMeetingCancellations: "SendToAllAndSaveCopy",
      },
    };
    await this.calendar.account.callEWS(request);
    await super.makeExclusions(exclusions);
  }

  async respondToInvitation(response: InvitationResponseInMessage, sendReply = true): Promise<void> {
    assert(this.isIncomingMeeting, "Only invitations can be responded to");
    let itemID = this.itemID;
    // Unfortunately this API won't take an OccurrenceItemId directly.
    if (!itemID) {
      // In case the invitation is for a single instance of a recurring meeting
      assert(this.recurrenceCase == RecurrenceCase.Instance, "must be an instance, or have an itemID");
      let request = {
        m$GetItem: {
          m$ItemShape: {
            t$BaseShape: "IdOnly",
          },
          m$ItemIds: {
            t$OccurrenceItemId: {
              RecurringMasterId: this.parentEvent.itemID,
              InstanceIndex: this.parentEvent.recurrenceRule.getIndexOfOccurrence(this.recurrenceStartTime) + 1,
            },
          },
        },
      };
      let response = await this.calendar.account.callEWS(request);
      itemID = sanitize.nonemptystring(response.Items.CalendarItem.ItemId.Id);
    }
    let request = new EWSCreateItemRequest({MessageDisposition: sendReply ? "SendAndSaveCopy" : "SaveOnly"});
    request.addField(ResponseTypes[response], "ReferenceItemId", { Id: itemID });
    await this.calendar.account.callEWS(request);
    await this.calendar.listEvents(); // Sync whatever Exchange decides to do
  }
}

function addParticipants(attendees: { Mailbox: { EmailAddress: string, Name: string }, ResponseType: string }[], participants: Participant[], organizer?: string) {
  for (let attendee of ensureArray(attendees)) {
    let emailAddress = sanitize.emailAddress(attendee.Mailbox.EmailAddress, null);
    if (emailAddress != organizer && emailAddress) {
      participants.push(new Participant(emailAddress, sanitize.nonemptystring(attendee.Mailbox.Name, null), sanitize.integer(InvitationResponse[attendee.ResponseType as keyof typeof InvitationResponse], InvitationResponse.Unknown)));
    }
  }
}

/** Sets of weekdays for the special `DaysOfWeek` values
 * used by relative monthly/yearly patterns, e.g. "first weekday of the month" */
export const kSpecialWeekdays: Record<string, Weekday[]> = {
  Day: [0, 1, 2, 3, 4, 5, 6],
  Weekday: [1, 2, 3, 4, 5],
  WeekendDay: [0, 6],
};

function extractWeekdays(daysOfWeek: string): Weekday[] | null {
  return daysOfWeek ? daysOfWeek.split(" ").flatMap((day: keyof typeof Weekday) => kSpecialWeekdays[day] ?? sanitize.integer(Weekday[day])) : null;
}

/** The single `DaysOfWeek` value for a relative monthly/yearly pattern,
 * which may be one of the special values */
export function relativeWeekdayString(weekdays: Weekday[]): string {
  return Object.keys(kSpecialWeekdays).find(day =>
    kSpecialWeekdays[day].length == weekdays.length && kSpecialWeekdays[day].every(d => weekdays.includes(d)))
    ?? weekdays.map(day => Weekday[day]).join(" ");
}

class EWSUpdateOccurrenceRequest {
  m$UpdateItem: any = {
    m$ItemChanges: {
      t$ItemChange: {
        t$OccurrenceItemId: {},
        t$Updates: {
          t$SetItemField: [],
          t$DeleteItemField: [],
        },
      },
    },
    ConflictResolution: "AlwaysOverwrite",
  };

  constructor(event: EWSEvent, attributes?: {[key: string]: string | boolean}) {
    this.itemChange.t$OccurrenceItemId.RecurringMasterId = event.parentEvent.itemID;
    this.itemChange.t$OccurrenceItemId.InstanceIndex = event.parentEvent.recurrenceRule.getIndexOfOccurrence(event.recurrenceStartTime) + 1;
    Object.assign(this.m$UpdateItem, attributes);
  }

  protected get itemChange() {
    return this.m$UpdateItem.m$ItemChanges.t$ItemChange;
  }

  addField(type: string, key: string, value: any, FieldURI: string, FieldIndex?: string) {
    let field = {} as any;
    if (FieldIndex) {
      field.t$IndexedFieldURI = { FieldURI, FieldIndex };
    } else {
      field.t$FieldURI = { FieldURI };
    }
    if (value == null) {
      this.itemChange.t$Updates.t$DeleteItemField.unshift(field);
    } else {
      field["t$" + type] = { ["t$" + key]: value };
      this.itemChange.t$Updates.t$SetItemField.unshift(field); // reverse order for Event time zone
    }
  }
}

function fromWindowsZone(zone: string | null): string | null {
  return zone in IANAToWindowsTimezone ? zone : WindowsToIANATimezone[zone] ?? null;
}
