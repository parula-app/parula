import type { Calendar } from "./Calendar";
import type { Participant } from "./Participant";
import { Attachment, ContentDisposition, type MessageWithAttachments } from "../Abstract/Attachment";
import { RecurrenceRule, type RecurrenceInit, Frequency } from "./RecurrenceRule";
import { OutgoingInvitation } from "./Invitation/OutgoingInvitation";
import { InvitationResponse, type InvitationResponseInMessage } from "./Invitation/InvitationStatus";
import type { MailAccount } from "../Mail/MailAccount";
import type { MeetAccount } from "../Meet/MeetAccount";
import { k1DayS, k1HourS, k1MinuteS, myTimezone } from "../util/date";
import { convertHTMLToText, convertTextToHTML, sanitizeHTML } from "../util/convertHTML";
import { Observable, notifyChangedAccessor, notifyChangedProperty, notifyChangedObservable } from "../util/Observable";
import { Lock } from "../util/flow/Lock";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { randomID, AbstractFunction, assert } from "../util/util";
import { dataError } from "../util/error";
import { gt } from "../../l10n/l10n";
import { ArrayColl } from "svelte-collections";

export class Event extends Observable {
  id: string;
  dbID: number;
  /** iCal UID if this is a meeting */
  calUID: string | null = null;
  /** Protocol-specific ID for this event */
  pID: string | null = null;
  @notifyChangedProperty
  title: string;
  /** HTML hex color string with # */
  @notifyChangedProperty
  color: string | null = null;
  @notifyChangedProperty
  protected _text: string | null = null;
  /** Plaintext version of the description */
  get descriptionText(): string {
    if (this._text != null) {
      return this._text;
    }
    try {
      if (this._rawHTML != null) {
        return this._text = convertHTMLToText(this._rawHTML);
      }
    } catch (ex) {
      dataError(ex);
    }
    return "";
  }
  set descriptionText(val: string | null) {
    this._text = val;
    this._rawHTML = null;
    this._sanitizedHTML = null;
  }
  get rawText(): string | null {
    return this._text;
  }
  /* Only use in combination with setting `.rawHTMLDangerous` */
  set rawText(val: string | null) {
    this._text = val;
  }
  /**
   * HTML version of the description.
   * Directly from the network.
   * Attention: Untrusted. MUST be sanitized before using it.
   * This is the version that will be saved on disk.
   * @see _sanitizedHTML
   */
  @notifyChangedProperty
  protected _rawHTML: string | null = null;
  /** HTML version of the description.
   * Sanitized.
   * This is only cached here in RAM, but not saved on disk,
   * so that we can change the sanitization. */
  protected _sanitizedHTML: string | null = null;
  /** Sanitized HTML version of the description. */
  get descriptionHTML(): string {
    if (this._sanitizedHTML != null) {
      return this._sanitizedHTML;
    }
    try {
      if (this._rawHTML != null) {
        return this._sanitizedHTML = sanitizeHTML(this._rawHTML);
      }
      if (this._text != null) {
        return this._sanitizedHTML = convertTextToHTML(this._text);
      }
    } catch (ex) {
      dataError(ex);
    }
    return "";
  }
  set descriptionHTML(val: string | null) {
    this._rawHTML = val;
    this._sanitizedHTML = null;
    this._text = null;
  }
  get rawHTMLDangerous(): string | null {
    return this._rawHTML;
  }
  /* Only use in combination with setting `.rawText` */
  set rawHTMLDangerous(val: string | null) {
    this._rawHTML = val;
    this._sanitizedHTML = null;
  }
  get hasHTML(): boolean {
    return !!this.rawHTMLDangerous;
  }
  get hasDescription(): boolean {
    return !!this.rawHTMLDangerous || !!this.rawText;
  }

  @notifyChangedProperty
  startTime: Date;
  @notifyChangedProperty
  endTime: Date;
  @notifyChangedProperty
  allDay = false;
  /** IANA timezone name, e.g. "Europe/Berlin" */
  @notifyChangedProperty
  timezone: string | null = null;

  /**
   * Shows whether this is a normal non-recurring event,
   * recurrence master, generated instance, or exception.
   *
   * | `Event.recurrenceCase` | `Event.parentEvent` | `Event.recurrenceRule` |
   * | ---------------------- | ------------------- | ---------------------- |
   * | Normal                 | without             | without                |
   * | Master                 | without             | with                   |
   * | Instance               | with                | without                |
   * | Exception              | with                | without                |
   *
   * Other state combinations are invalid.
   */
  @notifyChangedProperty
  recurrenceCase = RecurrenceCase.Normal;
  /** Describes the recurrence pattern.
   * Only for RecurrenceCase == Master */
  @notifyChangedProperty
  protected _recurrenceRule: RecurrenceRule | null = null;
  /** Links back to the recurring master.
   * Only for RecurrenceCase == Instance or Exception */
  @notifyChangedProperty
  parentEvent: Event | null = null;
  /**
   * Only for RecurrenceCase == Exception (or Instance)
   *
   * If this is an instance or exception of a recurring meeting (not the master),
   * then this is the instance's original start time.
   * The `startTime` may contain a modified time as an exception.
   * This allows us to work out the instance index of an exception,
   * even if its actual start time has been modified.
   *
   * For RecurrenceCase == Instance, it's identical to `startTime`.
   */
  recurrenceStartTime: Date | null = null;
  /** Contains all instances that should be displayed for this event.
   *
   * For recurrenceCase == Master:
   *
   * Contains all Instances generated from the master.
   * Does *not* contain:
   * - The master itself
   * - Exceptions
   * - Exclusions
   *
   * For recurrenceCase == Normal and Exception:
   *   Contains the event itself.
   *
   * This is a dynamic collection, and will be updated automatically
   * when the master changes or the recurrence rule changes.
   */
  readonly instances = new ArrayColl<Event>([this]);
  /**
   * Only for RecurrenceCase == Master
   *
   * Contains exclusions, i.e. where there would normally
   * be an recurrence instance, but exceptionally, there is none
   * on that specific day/time.
   */
  readonly exclusions = new ArrayColl<Date>;
  /**
   * Only for RecurrenceCase == Master
   *
   * Contains exceptions, i.e. where there would normally
   * be an recurrence instance, but exceptionally, this one
   * is different, e.g. on a different time, or different
   * location or other property.
   *
   * `exceptions.get().recurrenceStartTime` contains the time of the
   * normal instance that this exception replaces.
   */
  readonly exceptions = new ArrayColl<Event>;

  @notifyChangedProperty
  alarm: Date | null = null;

  @notifyChangedProperty
  location: string;
  @notifyChangedProperty
  onlineMeetingURL: string;
  @notifyChangedProperty
  isOnline = false;
  /** When saving, if this is set and `onlineMeetingURL` is not,
   * then use this account to create an online meeting and
   * put the URL in `onlineMeetingURL` */
  @notifyChangedProperty
  createOnlineMeetingWithAccount: MeetAccount | null = null;
  @notifyChangedObservable
  readonly participants = new ArrayColl<Participant>();
  /** Files that the organizer attached to the event, e.g. the agenda */
  @notifyChangedObservable
  readonly attachments = new ArrayColl<Attachment>();
  @notifyChangedProperty
  myParticipation = InvitationResponse.Unknown;
  /** Only for incoming meetings
   * The event was cancelled by the organizer (not our user). */
  @notifyChangedProperty
  isCancelled = false;
  /** Only for incoming meetings
   * The organizer changed the time or the place of the meeting,
   * and our user did not respond to the change yet. */
  @notifyChangedProperty
  isMoved = false;
  /** If we're currently editing this event,
   * saves the original state before the editing.
   *
   * Allows to calculate `hasChanged()`, revert changes,
   * and to implement full editable offline support.
   * Set be `startEditing()` and `stopEditing()` */
  @notifyChangedProperty
  unedited: Event | null = null;
  /** DTSTAMP when the status was sent that is captured in this object.
   * Used during auto-update to avoid overwriting with older info.
   * We don't need to track local changes, only those sent by others.
   * Local changes sent to others will always get the current timestamp in `ICalGenerator` */
  lastUpdateTime: Date | null;
  /** iCal SEQUENCE: The version of the meeting, which the organizer increases
   * with each change. Used together with `lastUpdateTime`, RFC 5546 2.1.5 */
  sequence = 0;
  /** Includes changes to `alarm`, lastUpdateTime does not consider to be a change */
  @notifyChangedProperty
  lastMod = new Date();
  /** The verbatim data we got from the server.
   * For round-trips: Allows to keep unknown properties to be kept as-is, even during edit,
   * instead of destroying everything unknown.
   * @type JSON or string (Optional) */
  original: Object | string | undefined;
  @notifyChangedProperty
  syncState: number | string | undefined;
  @notifyChangedProperty
  calendar: Calendar;
  readonly storageLock = new Lock();

  constructor(calendar?: Calendar, parentEvent?: Event) {
    super();
    this.id = randomID();
    this.calendar = calendar;
    if (parentEvent) {
      this.parentEvent = parentEvent;
      this.copyFromRecurrenceMaster(parentEvent);
      this.recurrenceCase = RecurrenceCase.Instance;
    }
  }

  /** The event has not ended yet, i.e. it is currently happening or still to come.
   * For a recurring master, whether any of its occurrences is still to come. */
  isUpcoming(): boolean {
    if (this.recurrenceRule) {
      // An occurrence that started less than the event duration ago is still running
      let nowStart = new Date(Date.now() - this.duration * 1000);
      return !!this.recurrenceRule.getOccurrenceAfter(nowStart);
    }
    return this.endTime > new Date();
  }

  /** in seconds */
  get duration(): number {
    let seconds = Math.round((this.endTime?.getTime() - this.startTime?.getTime()) / 1000);
    if (this.allDay) {
      let clockChangeSeconds = (this.startTime?.getTimezoneOffset() - this.endTime?.getTimezoneOffset()) * k1MinuteS;
      return Math.round(Math.ceil((seconds + clockChangeSeconds) / k1DayS) * k1DayS); // return entire days, not 1 second less
    }
    return seconds;
  }
  @notifyChangedAccessor
  set duration(seconds: number) {
    assert(seconds >= 0, `Duration must be >= 0, but is ${seconds}, starttime ${this.startTime?.toLocaleTimeString()}, endtime ${this.endTime?.toLocaleTimeString()}`);
    this.endTime ??= new Date(this.startTime);
    if (this.allDay) {
      this.endTime.setTime(this.startTime.getTime());
      // End date is non-inclusive next day. RFC 5545 section 3.6.1
      this.endTime.setDate(this.endTime.getDate() + Math.round(seconds / k1DayS));
    } else {
      this.endTime.setTime(this.startTime.getTime() + seconds * 1000);
    }
  }

  /** in minutes */
  get durationMinutes(): number {
    return this.duration / k1MinuteS;
  }
  set durationMinutes(minutes: number) {
    this.duration = minutes * k1MinuteS;
  }

  /** in hours */
  get durationHours(): number {
    return this.duration / k1HourS;
  }
  set durationHours(hours: number) {
    this.duration = hours * k1HourS;
  }

  /** in days */
  get durationDays(): number {
    return this.duration / k1DayS;
  }
  set durationDays(days: number) {
    this.duration = days * k1DayS;
  }

  /** @param term search term, in lower case */
  matchesSearch(term: string): boolean {
    return this.title?.toLowerCase().includes(term) ||
      this.hasDescription && this.descriptionText?.toLowerCase().includes(term) ||
      this.participants.some(person =>
        person.name?.toLowerCase().includes(term) ||
        person.emailAddress?.includes(term));
  }

  get recurrenceRule(): RecurrenceRule | null {
    return this._recurrenceRule!;
  }
  set recurrenceRule(rule: RecurrenceRule | null) {
    if (rule) {
      this.setRecurrenceRule(rule);
    } else {
      this.clearRecurrenceRule();
    }
  }
  /**
   * Removes a recurrence pattern and all instances and exceptions.
   */
  protected clearRecurrenceRule() {
    if (!this._recurrenceRule) {
      return;
    }
    // clearExceptions() in finishEditing()
    this._muteObservers = true;
    this.recurrenceCase = RecurrenceCase.Normal;
    this._muteObservers = false;
    this._recurrenceRule = null; // notifies
    this.instances.replaceAll([this]);
  }
  /**
   * Updates a recurrence pattern.
   * Instances and exceptions are regenerated if necessary.
   */
  protected setRecurrenceRule(rule: RecurrenceRule) {
    assert(this.recurrenceCase == RecurrenceCase.Normal || this.recurrenceCase == RecurrenceCase.Master, "Instances can't themselves recur");
    this._muteObservers = true;
    this.recurrenceCase = RecurrenceCase.Master;
    this._muteObservers = false;
    this._recurrenceRule = rule; // notifies
    // clearExceptions() as necessary in finishEditing()
    this.generateRecurringInstances();
  }

  newRecurrenceRule(frequency: Frequency, interval = 1, week = 0, weekdays?: number[]): void {
    let init: RecurrenceInit = {
      masterDuration: this.duration,
      timezone: this.timezone,
      seriesStartTime: this.startTime,
      frequency,
      interval,
    };
    // The UI cannot edit the end of the series, so keep any existing end,
    // instead of making the series endless
    if (this.recurrenceRule) {
      init.seriesEndTime = this.recurrenceRule.seriesEndTime;
      init.count = this.recurrenceRule.count;
    }
    if (frequency == Frequency.Weekly) {
      init.weekdays = weekdays;
    } else if (frequency == Frequency.Monthly || frequency == Frequency.Yearly) {
      init.week = week;
    }
    this.recurrenceRule = new RecurrenceRule(init, true);
  }

  /** Create a new instance of the same event.
   * Copy all data of the `original` event into this new Event object.
   * Not sure why anyone would need this; editing code can use
   * copyEditableFieldsFrom and recurring events need extra care. */
  copyFrom(original: Event) {
    this.copyEditableFieldsFrom(original);
    this.recurrenceStartTime = original.recurrenceStartTime ? new Date(original.recurrenceStartTime) : null;
    this.recurrenceCase = original.recurrenceCase;
    this.recurrenceRule = original.recurrenceRule;
    if (this.recurrenceRule) {
      this.instances.replaceAll(original.instances);
      this.exceptions.replaceAll(original.exceptions);
      this.exclusions.replaceAll(original.exclusions.contents.map(exclusion => new Date(exclusion)));
    }
    this.parentEvent = original.parentEvent;
  }

  /**
   * Copy editable data between events. Can be used to make temporary copies
   * to see how they have been changed by editing, or in case you actually
   * end up wanting to change a different event, e.g. by applying changes
   * to the rest of the series. Does not copy recurrence data; use
   * `confirmAndChangeRecurrenceRule` to update edited recurrence data.
   */
  copyEditableFieldsFrom(original: Event) {
    this.copyFromRecurrenceMaster(original);
    this.startTime = original.startTime ? new Date(original.startTime) : null;
    this.endTime = original.endTime ? new Date(original.endTime) : null;
    this.alarm = original.alarm ? new Date(original.alarm) : null;
  }

  /**
   * Used to update placeholder instances from their recurring master.
   * Copies the event properties that are shared between recurring instances.
   */
  protected copyFromRecurrenceMaster(original: Event) {
    this.calUID = original.calUID;
    this.title = original.title;
    this.rawText = original.rawText;
    this.rawHTMLDangerous = original.rawHTMLDangerous;
    this.timezone = original.timezone;
    this.allDay = original.allDay;
    this.location = original.location;
    this.isOnline = original.isOnline;
    this.onlineMeetingURL = original.onlineMeetingURL;
    this.participants.replaceAll(original.participants);
    this.attachments.replaceAll(original.attachments);
    this.myParticipation = original.myParticipation;
    this.isMoved = original.isMoved;
    this.lastUpdateTime = original.lastUpdateTime ? new Date(original.lastUpdateTime) : original.lastUpdateTime;
    this.sequence = original.sequence;
  }

  fromExtraJSON(json: any) {
    assert(typeof (json) == "object", "Must be a JSON object");
    this.syncState = json.syncState;
    this.isOnline = sanitize.boolean(json.isOnline, false);
    this.onlineMeetingURL = sanitize.url(json.onlineMeetingURL, null);
    this.isCancelled = sanitize.boolean(json.isCancelled, false);
    this.isMoved = sanitize.boolean(json.isMoved, false);
    this.lastUpdateTime = sanitize.date(json.lastUpdateTime, null);
    this.sequence = sanitize.integer(json.sequence, 0);
    this.lastMod = sanitize.date(json.lastMod, this.lastMod);
  }
  toExtraJSON(): any {
    let json: any = {};
    json.syncState = this.syncState;
    json.isOnline = this.isOnline;
    json.onlineMeetingURL = this.onlineMeetingURL;
    json.isCancelled = this.isCancelled;
    json.isMoved = this.isMoved;
    json.lastUpdateTime = this.lastUpdateTime;
    json.sequence = this.sequence;
    json.lastMod = this.lastMod;
    return json;
  }

  get outgoingInvitation() {
    return new OutgoingInvitation(this);
  }

  /** Whether `other` is the same event as this one, either the same object,
   * or the same meeting in another calendar or in an invitation email */
  isSameUID(other: Event | null | undefined): boolean {
    return this == other || !!this.calUID && this.calUID == other?.calUID;
  }

  /** Whether this is a later version of the meeting than `other`,
   * as the organizer sent it. RFC 5546 2.1.5 */
  isNewerVersionThan(other: Event): boolean {
    if (this.sequence != other.sequence) {
      return this.sequence > other.sequence;
    }
    return (this.lastUpdateTime?.getTime() ?? 0) > (other.lastUpdateTime?.getTime() ?? 0);
  }

  /** Assumes that `startEditing()` was called before */
  hasChanged(): boolean {
    return !!this.unedited && !this.matches(this.unedited);
  }

  matches(other: Event): boolean {
    return (
      this.calUID == other.calUID &&
      this.startTime?.getTime() == other.startTime?.getTime() &&
      this.endTime?.getTime() == other.endTime?.getTime() &&
      this.timezone == other.timezone &&
      this.allDay == other.allDay &&
      this.title == other.title &&
      this.rawText == other.rawText &&
      this.rawHTMLDangerous == other.rawHTMLDangerous &&
      this.location == other.location &&
      this.isOnline == other.isOnline &&
      this.onlineMeetingURL == other.onlineMeetingURL &&
      this.myParticipation == other.myParticipation &&
      this.participants.length == other.participants.length &&
      (this.participants.isEmpty || this.participants.contents.every((pThis, i) =>
        pThis.emailAddress == other.participants.get(i).emailAddress)) &&
      this.attachments.length == other.attachments.length &&
      (this.attachments.isEmpty || this.attachments.contents.every((aThis, i) =>
        aThis.filename == other.attachments.get(i).filename)) &&
      !this.recurrenceRule == !other.recurrenceRule &&
      (!this.recurrenceRule || this.recurrenceRule.matches(other.recurrenceRule)) &&
      this.exclusions.length == other.exclusions.length &&
      this.alarm?.getTime() == other.alarm?.getTime()
    );
  }

  /**
   * Starts editing an event.
   *
   * If it is already being edited, this is a no-op. This can happen when switching
   * between the event editor and another screen, or certain updates within
   * editing events can also trigger it.
   */
  startEditing() {
    if (this.unedited) {
      return;
    }
    this.timezone ||= myTimezone();
    this.unedited = this.calendar.newEvent();
    this.unedited.copyFrom(this);
  }
  finishEditing() {
    if (this.unedited?.recurrenceCase == RecurrenceCase.Master) {
      let timesMatch = this.unedited._recurrenceRule?.timesMatch(this._recurrenceRule);
      if (!timesMatch) {
        this.clearExceptions();
      }
    }
    this.unedited = null;
  }
  cancelEditing() {
    if (this.unedited) {
      this.copyFrom(this.unedited);
    }
    this.finishEditing();
  }

  createMeeting() {
    this.outgoingInvitation.createOrganizer();
  }

  /** An occurrence may share the participant objects with its series.
   * Call this before changing a participant of only this occurrence,
   * e.g. my response, so that the change doesn't apply to the whole series. */
  separateParticipantsFromSeries() {
    if (this.parentEvent) {
      this.participants.replaceAll(this.participants.contents.map(participant => participant.clone()));
    }
  }

  /** Who invited to this meeting.
   * null, if this is a private event of our user, without other participants. */
  get organizer(): Participant | null {
    return this.participants.find(participant => participant.response == InvitationResponse.Organizer) ?? null;
  }

  newAttachment(): Attachment {
    let attachment = new Attachment();
    attachment.message = this;
    let storage = this.calendar?.storage;
    attachment.storage = new ArrayColl(storage ? [storage] : []);
    return attachment;
  }

  /** Reads the attachment contents from the local disk and, for those that
   * aren't saved there yet, downloads them from the server. */
  async loadAttachments(): Promise<void> {
    for (let attachment of this.attachments) {
      await attachment.read();
    }
    // Only those that are on the server can be downloaded from there.
    if (this.attachments.every(attachment => attachment.content || !attachment.pID)) {
      return;
    }
    await this.downloadAttachmentsFromServer();
    for (let attachment of this.attachments) {
      await attachment.save();
    }
  }

  /** Copies the attachments of the `original` event or invitation email to this
   * event, e.g. when accepting an invitation or moving the event to another calendar.
   * `copyFrom()` merely shares the attachment objects, but they still belong
   * to the `original` event and are saved in its calendar, not in ours. */
  async adoptAttachmentsFrom(original: MessageWithAttachments) {
    await original.loadAttachments?.();
    this.attachments.replaceAll(original.attachments.contents
      // Not the invitation iCal itself, signatures, nor inline images
      // Exchange uses `multipart/related` with `Content-ID`
      .filter(attachment => !attachment.hidden && attachment.disposition != ContentDisposition.inline)
      .map(attachment => attachment.cloneTo(this)));
  }

  /** Fetches the attachment contents from the server.
   * Only needed for protocols that send the attachment metadata,
   * but not the contents, together with the event. Only those set
   * `Attachment.pID`, and only for those is this function called. */
  protected async downloadAttachmentsFromServer(): Promise<void> {
    throw new AbstractFunction();
  }

  /** Attachments that are still on the server, but that the user
   * removed from the event during the current editing session.
   * Call before `finishEditing()`. */
  get removedAttachments(): Attachment[] {
    if (!this.unedited) {
      return [];
    }
    return this.unedited.attachments.contents.filter(removed =>
      removed.pID && !this.attachments.some(attachment => attachment.pID == removed.pID));
  }

  get isNew(): boolean {
    return !this.dbID;
  }

  get isEditable(): boolean {
    return !this.isIncomingMeeting;
  }

  get isIncomingMeeting(): boolean {
    switch (this.myParticipation) {
    case InvitationResponse.Unknown:
    case InvitationResponse.Organizer:
      return false;
    }
    return true;
  }

  get isOutgoingMeeting(): boolean {
    return this.myParticipation == InvitationResponse.Organizer;
  }

  get isUnanswered(): boolean {
    return this.myParticipation == InvitationResponse.NoResponseReceived;
  }

  /** How this event shows in our availability */
  get busyStatus(): FreeBusyStatus {
    if (this.isCancelled || this.myParticipation == InvitationResponse.Decline) {
      return FreeBusyStatus.Free;
    }
    if (this.myParticipation == InvitationResponse.Tentative || this.isUnanswered) {
      return FreeBusyStatus.Tentative;
    }
    return FreeBusyStatus.Busy;
  }

  async createOnlineMeeting() {
    if (this.onlineMeetingURL || !this.createOnlineMeetingWithAccount) {
      return;
    }
    this.onlineMeetingURL = await this.createOnlineMeetingWithAccount.createMeetingURL();
  }

  /** For backends that have only a single location field and no dedicated field
   * for the online meeting URL, put the URL in the location, like other clients do.
   * @see setLocationFromServer() the inverse */
  getLocationForServer(): string {
    return this.location || this.isOnline && this.onlineMeetingURL || "";
  }

  /** If the location is actually the online meeting URL,
   * move it to `onlineMeetingURL`.
   * @see getLocationForServer() for the inverse */
  setLocationFromServer(location: string | null): void {
    this.location = location || "";
    if (!this.onlineMeetingURL && this.location.startsWith("https://")) {
      this.isOnline = true;
      this.onlineMeetingURL = sanitize.url(this.location, null);
    }
    if (this.location == this.onlineMeetingURL) { // Our own backwards compat code for online meeting URL
      this.location = "";
    }
  }

  /** Call this whenever the master changes */
  generateRecurringInstances(endDate?: Date) {
    assert(this.recurrenceCase == RecurrenceCase.Master, "Only for master");
    this.instances.clear();
    this.fillRecurrences(endDate);
  }

  /** @param mustExist
   *   When the occurrence was excluded or isn't in the recurrence,
   *   throw (default), or return null. */
  getOccurrenceByDate(recurrenceStartTime: Date, mustExist = true): Event | null {
    assert(this.recurrenceCase == RecurrenceCase.Master, "Only for master");
    if (this.exclusions.find(date => date.getTime() == recurrenceStartTime.getTime())) {
      assert(!mustExist, "occurrence was already excluded");
      return null;
    }
    let event = this.exceptions.find(event => event.recurrenceStartTime.getTime() == recurrenceStartTime.getTime());
    if (event) {
      return event;
    }
    event = this.instances.find(event => event.recurrenceStartTime.getTime() == recurrenceStartTime.getTime());
    if (event) {
      return event;
    }
    if (this.recurrenceRule.getIndexOfOccurrence(recurrenceStartTime) == -1) {
      assert(!mustExist, "occurrence date not in recurrence");
      return null;
    }
    this.generateRecurringInstances(recurrenceStartTime);
    return this.instances.find(event => event.recurrenceStartTime.getTime() == recurrenceStartTime.getTime());
  }

  protected makeExclusionLocally(recurrenceStartTime: Date) {
    assert(this.recurrenceCase == RecurrenceCase.Master, "Only for master");
    if (this.exclusions.some(date => date.getTime() == recurrenceStartTime.getTime())) {
      return; // already excluded
    }
    if (this.recurrenceRule.getIndexOfOccurrence(recurrenceStartTime) == -1) {
      // Server deleted an occurrence outside our computed recurrence (faulty
      // data, or past the series end). Our rule generates no instance there,
      // so there's nothing to exclude. #1186
      return;
    }
    this.getOccurrenceByDate(recurrenceStartTime).deleteLocally().catch(this.calendar.errorCallback);
  }

  /**
   * Calculates the position of this instance in a recurring series.
   * "none" - event isn't an instance or exception
   * "only" - event is the only instance or exception remaining
   * "last" - event is the last instance, but there may be more exceptions
   * "exception" - event is an exception and there are further instances
   * "first" - event is the first instance after exclusions
   * "middle" - event is an instance, but none of the above apply
   * In particular:
   * "only" - don't delete the event, delete the master instead
   * "first" - offer to edit the whole series
   * "middle" - offer to edit the remainder of the series
   */
  get seriesStatus(): "none" | "only" | "last" | "exception" | "first" | "middle" {
    // Normally the parent of an instance would always have a
    // recurrence rule, but this might get removed during saving,
    // and would cause Svelte to crash if we didn't handle it.
    let master = this.parentEvent?.unedited ?? this.parentEvent;
    let rule = master?.recurrenceRule;
    if (!rule) {
      return "none";
    }
    if (rule.countIs(master.exclusions.length + 1)) {
      return "only";
    }
    // Not supporting "last" any more; fortunately nobody needs it
    // (it's prohibitively expensive to compute these days)
    return this.isNew ? this.recurrenceStartTime.getTime() == master.instances.first.recurrenceStartTime.getTime() ? "first" : "middle" : "exception";
  }

  /**
   * Saves the event to the server and to the database.
   */
  async save() {
    await this.saveLocally();
    await this.saveToServer();
  }

  /**
   * Saves the event locally to the database.
   */
  async saveLocally() {
    assert(this.calendar, "To save an event, it needs to be in a calendar first");
    assert(this.calendar.storage, "To save an event, the calendar needs to be saved first");
    this.calUID ??= crypto.randomUUID();
    await this.calendar.storage.saveEvent(this);

    if (this.recurrenceCase == RecurrenceCase.Master) {
      this.generateRecurringInstances();
    } else if (this.recurrenceCase == RecurrenceCase.Instance) {
      this.recurrenceCase = RecurrenceCase.Exception;
      this.parentEvent.instances.remove(this);
      this.parentEvent.exceptions.add(this);
      this.calendar.events.add(this);
    }
  }

  async prepareSaveToServer(): Promise<void> {
    await this.createOnlineMeeting();
  }

  async saveToServer(): Promise<void> {
    await this.prepareSaveToServer();
    await this.sendInvitationsDirectly();
  }

  async sendInvitationsDirectly(): Promise<void> {
    this.calUID ??= crypto.randomUUID();
    if (!this.isIncomingMeeting && this.participants.hasItems && this.hasChanged()) {
      await this.outgoingInvitation.sendInvitations();
    }
  }

  /**
   * Deletes the event on the server and from the database.
   */
  async deleteIt() {
    await this.deleteLocally();
    await this.deleteFromServer();
  }

  /**
   * Deletes the event locally from the database.
   */
  async deleteLocally() {
    assert(this.calendar, "To delete an event, it needs to be in a calendar first");
    assert(this.calendar.storage, "To delete an event, the calendar needs to be saved first");
    // this.recurrenceRule = null; is overkill for removing exceptions; the database already cascades the delete
    this.calendar.events.removeAll(this.exceptions);
    this.calendar.events.remove(this);
    if (this.dbID) {
      await this.calendar.storage.deleteEvent(this);
    }
    if (this.parentEvent) {
      this.parentEvent.instances.remove(this);
      this.parentEvent.exceptions.remove(this);
      this.parentEvent.exclusions.add(this.recurrenceStartTime);
      await this.calendar.storage.saveEvent(this.parentEvent);
    }
  }

  async deleteFromServer(): Promise<void> {
    try {
      if (!this.participants.length) {
        return;
      }
      if (this.isOutgoingMeeting) {
        await this.outgoingInvitation.sendCancellations();
      } else if (this.isIncomingMeeting) {
        await this.respondToInvitation(InvitationResponse.Decline, true, null, false);
      }
    } catch (ex) {
      this.calendar.errorCallback(ex);
    }
  }

  /** Delete multiple instances */
  async makeExclusions(exclusions: Event[]) {
    this.calendar.events.removeAll(exclusions);
    this.instances.removeAll(exclusions);
    this.exceptions.removeAll(exclusions);
    this.exclusions.addAll(exclusions.map(event => event.recurrenceStartTime));
    for (let exclusion of exclusions) {
      if (!exclusion.isNew) {
        await this.calendar.storage.deleteEvent(exclusion);
      }
    }
  }

  /**
   * Remove the event from the current calendar and
   * add it to the `newCalendar`.
   * If the Calendar Events have different implementations,
   * re-create the event in the correct Event subclass
   * for the new calendar.
   *
   * Saves the changes to disk.
   *
   * @returns the new (or same) Event object */
  async moveToCalendar(newCalendar: Calendar): Promise<Event> {
    if (this.calendar == newCalendar || !newCalendar) {
      return this;
    }
    this.calendar?.events.remove(this);
    let newEvent = newCalendar.newEvent();
    if (Object.getPrototypeOf(this) == Object.getPrototypeOf(newEvent)) {
      this.calendar = newCalendar;
      newCalendar.events.add(this);
      await this.save();
      return this;
    }
    newEvent.copyFrom(this);
    newEvent.calendar = newCalendar;
    await newEvent.adoptAttachmentsFrom(this);

    // Replace organizer with email matching the new calendar
    let organizer = newEvent.participants.find(p => p.response == InvitationResponse.Organizer);
    if (organizer) {
      let participants = new ArrayColl(newEvent.participants);
      participants.remove(organizer);
      newEvent.participants.clear(); // createMeeting checks this
      newEvent.createMeeting();
      newEvent.participants.addAll(participants);
    }

    newCalendar.events.add(newEvent);
    await newEvent.save();
    await this.deleteIt();
    return newEvent;
  }

  /**
   * This API is called by:
   * - `deleteFromServer()` to send a `Decline` when deleting an invitation event
   * - `ActiveSyncIncomingInvitation`, when responding to an invitation in the
   *   ActiveSync email, where by `this` is an `InvitationEvent`.
   *
   * This implementation is used by protocols:
   * - Personal calendar
   * - CalDAV
   * - JMAP, because we prefer to let the user control which events are added to the calendar
   * - ActiveSync, indirectly: `ActiveSyncEvent` overrides this and then calls this.
   * Not used by: EWS, OWA
   *
   * TODO Move API to @see IncomingInvitation and code to @see ICalIncomingInvitation
   */
  async respondToInvitation(response: InvitationResponseInMessage, sendReply = true, mailAccount?: MailAccount, save = true): Promise<void> {
    assert(this.isIncomingMeeting, "Only invitations can be responded to");
    const { ICalIncomingInvitation } = await import("./ICal/ICalIncomingInvitation"); // HACK to avoid circular import in `InvitationEvent`
    await ICalIncomingInvitation.respondToInvitationFromCalEvent(this, response, sendReply, mailAccount);
    if (save) { // `save == false` for deleted events and `InvitationEvent`
      await this.save();
    }
  }

  /**
   * Ensures that all recurring instances exist up to the provided date.
   * Only for recurrenceCase == Master
   *
   * TODO Call this when the user scrolls further than the default fill date.
   */
  fillRecurrences(seriesEndTime: Date = new Date(Date.now() + 1e11)) {
    assert(this.recurrenceCase == RecurrenceCase.Master, "Not a recurrence master");
    if (this.instances.hasItems || // cached
        !this.calendar) { // Not for pseudo events in messages
      // TODO Fill more, if seriesEndTime >> last.startTime
      return;
    }
    let occurrences = this.recurrenceRule.getOccurrencesByDate(seriesEndTime);
    let instances = [];
    for (let occurrence of occurrences) {
      if (this.exceptions.some(exception => exception.recurrenceStartTime.getTime() == occurrence.getTime())) {
        continue;
      }
      if (this.exclusions.some(exclusion => exclusion.getTime() == occurrence.getTime())) {
        continue;
      }
      let instance = this.calendar.newEvent(this);
      instance.recurrenceCase = RecurrenceCase.Instance;
      instance.recurrenceStartTime = occurrence;
      instance.startTime = new Date(occurrence); // Clone in case of exception
      instance.duration = this.duration;
      if (this.alarm) {
        instance.alarm = new Date(this.alarm.getTime() + instance.startTime.getTime() - this.startTime.getTime());
      }
      instances.push(instance);
    }
    this.instances.addAll(instances);
  }

  /**
   * Used when a master recurrence rule is removed or changed incompatibly.
   */
  protected clearExceptions() {
    if (this.calendar) {
      this.calendar.events.removeAll(this.exceptions);
      for (let exception of this.exceptions) {
        // Not using deleteLocally because that's for creating an exclusion
        this.calendar.storage.deleteEvent(exception)
          .catch(this.calendar.errorCallback); // TODO server? No, server will delete when it sees the rule change.
      }
    }
    this.exceptions.clear();
    this.exclusions.clear();
  }

  /**
   * Changes the current recurrence to be limited by count.
   */
  async setRecurrenceCount(count: number) {
    assert(this.recurrenceRule, "Need to have a rule to set its count");
    let seriesStartTime = this.startTime;
    let { masterDuration, timezone, frequency, interval, weekdays, week, first } = this.recurrenceRule;
    this.recurrenceRule = new RecurrenceRule({ masterDuration, timezone, seriesStartTime, count, frequency, interval, weekdays, week, first });
    await this.trimExceptionsAndExclusions(this.recurrenceRule.getOccurrenceByIndex(count - 1));
  }

  /**
   * Changes the current recurrence to be limited by end time.
   */
  async setRecurrenceEndTime(seriesEndTime: Date) {
    assert(this.recurrenceRule, "Need to have a rule to set its end time");
    let seriesStartTime = this.startTime;
    let { masterDuration, timezone, frequency, interval, weekdays, week, first } = this.recurrenceRule;
    this.recurrenceRule = new RecurrenceRule({ masterDuration, timezone, seriesStartTime, seriesEndTime, frequency, interval, weekdays, week, first });
    await this.trimExceptionsAndExclusions(seriesEndTime);
  }

  protected async trimExceptionsAndExclusions(seriesEndTime: Date) {
    this.exclusions.removeAll(this.exclusions.filterOnce(exclusion => exclusion > seriesEndTime));
    let exceptions = this.exceptions.filterOnce(exception => exception.recurrenceStartTime > seriesEndTime);
    this.exceptions.removeAll(exceptions);
    for (let exception of exceptions) {
      // not using delete because that creates exclusions
      await this.calendar.storage.deleteEvent(exception);
    }
  }

  /**
   * Deletes the event and any subsequent instances that are not exceptions.
   *
   * UI helper. Call it on an event that is not being edited, whose master is
   * not being edited either: call `cancelEditing()` on both first. Otherwise,
   * the pending UI changes of the master would be saved, too.
   * It changes the master in its own editing session, so that `save()` sees
   * the shortened series as a change and sends the update to the participants.
   */
  async truncateRecurrence() {
    let master = this.parentEvent;
    assert(master.recurrenceCase == RecurrenceCase.Master, "parentEvent must a Recurrence.Master");
    master.startEditing();
    let lastException = this.recurrenceStartTime;
    for (let exception of master.exceptions) {
      if (exception.recurrenceStartTime > lastException) {
        lastException = exception.recurrenceStartTime;
      }
    }
    master.generateRecurringInstances(lastException);
    let exclusions = master.instances.contents.filter(event => event.recurrenceStartTime> this.recurrenceStartTime && event.recurrenceStartTime < lastException);
    if (lastException > this.recurrenceStartTime) {
      // Isn't cache invalidation fun!
      exclusions.push(master.getOccurrenceByDate(this.recurrenceStartTime));
    }
    let count = master.recurrenceRule.getIndexOfOccurrence(lastException) + (lastException > this.recurrenceStartTime ? 1 : 0);
    if (master.recurrenceRule.getOccurrenceByIndex(count)) {
      await master.setRecurrenceCount(count);
    }
    if (exclusions.length) {
      await master.makeExclusions(exclusions);
    } else if (!this.isNew) {
      await this.calendar.storage.deleteEvent(this);
    }
    await master.save();
    master.finishEditing();
  }
}

export enum RecurrenceCase {
  /** Not recurring */
  Normal = "normal",
  /** Recurring Master event.
   * Contains the rules how to create the recurrence instances.
   * Not directly shown in the UI. */
  Master = "master",
  /** Recurrence Instance, generated from the master.
   * Only exists in RAM objects, not saved on server and in DB. */
  Instance = "instance",
  /** Recurrence Exception.
   * Like an instance, but at a different time or with modified properties.
   * Overrides a specific instance. */
  Exception = "exception",
}

export enum FreeBusyStatus {
  Free = "free",
  Tentative = "tentative",
  Busy = "busy",
  OutOfOffice = "out-of-office",
  WorkingElsewhere = "elsewhere",
}

export const freeBusyStatusLabels: Record<FreeBusyStatus, string> = {
  [FreeBusyStatus.Free]: gt`Free *=> Availability: Not busy at this time`,
  [FreeBusyStatus.Tentative]: gt`Tentative *=> Availability: Has a tentative appointment at this time`,
  [FreeBusyStatus.Busy]: gt`Busy *=> Availability: Not free at this time`,
  [FreeBusyStatus.OutOfOffice]: gt`Out of office`,
  [FreeBusyStatus.WorkingElsewhere]: gt`Working elsewhere`,
};
