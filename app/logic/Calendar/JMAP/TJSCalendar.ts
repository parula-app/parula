import type { TID, TInteger, TUTCDateTime } from "../../Mail/JMAP/TJMAPGeneric";

export interface TJMAPCalendarEvent extends TJSCalendarEvent {
  /** Overrides for specific recurrence instances */
  recurrenceOverrides?: Record<TLocalDateTime, TJMAPCalendarEvent>;
  id: TID;
  /** Only set if this is a server-generated recurrence instance.
   * The ID of the recurring event that this was generated from. */
  baseEventId: TID | null;
  /** Which calendars this event belongs to */
  calendarIds: Record<TID, true>;
  isDraft: boolean;
  /** Is this the authoritative source for this event?
   * true, if it controls scheduling for this event
   * false, if the event has been added as a result of an invitation from another calendar system */
  isOrigin: boolean;
  /** Only when requested */
  utcStart?: TUTCDateTime;
  utcEnd?: TUTCDateTime;
}

/**
 * JSCalendar TypeScript Definitions
 *
 * RFC 8984: JSCalendar - A JSON Representation of Calendar Data
 * @see <https://www.rfc-editor.org/info/rfc8984>
 *
 * This provides TypeScript interfaces for the JSCalendar
 * specification, enabling type-safe calendar data access.
 */

/** LocalDateTime: RFC3339 without timezone information */
type TLocalDateTime = string;
/** Duration: ISO 8601 duration format (P[n]Y[n]M[n]DT[n]H[n]M[n]S) */
type TDuration = string;
/** SignedDuration: Duration with optional +/- sign prefix */
type TSignedDuration = string;
/** TimeZoneId: IANA timezone name or custom identifier */
export type TTimeZoneID = string;
/**
 * PatchObject: Unordered set of patches using JSON Pointer paths
 * Keys are JSON Pointer paths (implicitly prefixed with /)
 */
type TPatchObject = Record<string, unknown>;

/**
 * Base interface for all JSCalendar objects
 */
interface TJSCalendarEventBase {
  "@type": "Event" | "Task" | "Group";

  // Metadata Properties (4.1)
  /** Globally unique identifier */
  uid: string;
  /** Last modification timestamp */
  updated: TUTCDateTime;
  /** Creation timestamp */
  created?: TUTCDateTime;
  /** Change sequence number (default: 0) */
  sequence?: TInteger;
  /** Relations to other JSCalendar objects */
  relatedTo?: Record<string, TJSCalendarRelation>;
  /** Product identifier that last updated this object */
  prodId?: string;
  /** iTIP method (lowercase) */
  method?: string;

  // What and Where Properties (4.2)
  /** Short summary (default: empty string) */
  title?: string;
  /** Longer text description (default: empty string) */
  description?: string;
  /** Media type of description (default: "text/plain") */
  descriptionContentType?: string;
  /** Time is not important for display (default: false) */
  showWithoutTime?: boolean;
  /** Map of location IDs to Location objects */
  locations?: Record<string, TJSCalendarLocation>;
  /** Map of virtual location IDs to VirtualLocation objects */
  virtualLocations?: Record<string, TJSCalendarVirtualLocation>;
  /** Map of link IDs to Link objects */
  links?: Record<string, TJSCalendarLink>;
  /** Language tag (RFC 5646) */
  locale?: string;
  /** Set of keywords/tags */
  keywords?: Record<string, true>;
  /** Set of structured categories (as URIs) */
  categories?: Record<string, true>;
  /** Display color (CSS color name or hex RGB) */
  color?: string;

  // Recurrence Properties (4.3)
  /** Identifies a specific occurrence of recurring object */
  recurrenceId?: TLocalDateTime;
  /** Timezone of recurrenceId (required if recurrenceId is set) */
  recurrenceIdTimeZone?: TTimeZoneID | null;
  /** Rules generating recurrence dates */
  recurrenceRule?: TJSCalendarRecurrenceRule;
  /** Overrides for specific recurrence instances */
  recurrenceOverrides?: Record<TLocalDateTime, TJSCalendarEventBase>;
  /** Mark excluded dates in recurrence */
  excluded?: boolean;

  // Sharing and Scheduling Properties (4.4)
  /** Scheduling priority (0-9) */
  priority?: TInteger;
  /** Busy status: "free" or "busy" */
  freeBusyStatus?: "free" | "busy" | string;
  /** Privacy level: "public", "private", or "secret" */
  privacy?: "public" | "private" | "secret" | string;
  /** Reply-to address */
  replyTo?: string[];
  /** Sent by identifier */
  sentBy?: string;
  /** Calendar user address of the organizer (mailto: URI), e.g. "mailto:fred@example.com" */
  organizerCalendarAddress?: string;
  /** Map of participant IDs to Participant objects */
  participants?: Record<string, TJSCalendarParticipant>;
  /** Request status (iTIP) */
  requestStatus?: string[];

  // Alerts Properties (4.5)
  /** Use default alerts (default: false) */
  useDefaultAlerts?: boolean;
  /** Map of alert IDs to Alert objects */
  alerts?: Record<string, TJSCalendarAlert>;
  // Multilingual Properties (4.6)
  /** Map of language tags to localized object patches */
  localizations?: Record<string, TPatchObject>;
  // Time Zone Properties (4.7)
  /** Default timezone for floating times */
  timeZone?: TTimeZoneID;
  /** timezone of the end time */
  endTimeZone?: TTimeZoneID;
}

/**
 * Event: Represents a scheduled amount of time on a calendar
 *
 * Media type: application/jscalendar+json;type=event
 */
export interface TJSCalendarEvent extends TJSCalendarEventBase {
  "@type": "Event";
  /** Overrides for specific recurrence instances */
  recurrenceOverrides?: Record<TLocalDateTime, TJSCalendarEvent>;
  /** Event start date/time */
  start: TLocalDateTime | TUTCDateTime;
  /** Event duration (default: "PT0S") */
  duration?: TDuration;
  /** Event status: "confirmed", "tentative", or "cancelled" */
  status?: "confirmed" | "tentative" | "cancelled" | string;
}

/**
 * Task: Represents an action item, assignment, or to-do item
 *
 * Media type: application/jscalendar+json;type=task
 */
export interface TJSCalendarTask extends TJSCalendarEventBase {
  "@type": "Task";
  /** Overrides for specific recurrence instances */
  recurrenceOverrides?: Record<TLocalDateTime, TJSCalendarTask>;
  /** Task due date/time */
  due?: TLocalDateTime | TUTCDateTime;
  /** Task start date/time */
  start?: TLocalDateTime | TUTCDateTime;
  /** Estimated duration to complete task */
  estimatedDuration?: TDuration;
  /** Completion percentage (0-100) */
  percentComplete?: TInteger;
  /** Task progress status */
  progress?: "needs-action" | "in-process" | "completed" | "failed" | "cancelled" | string;
}

/**
 * Group: A collection of Event and/or Task objects
 *
 * Media type: application/jscalendar+json;type=group
 */
interface TJSCalendarGroup extends TJSCalendarEventBase {
  "@type": "Group";
  /** Array of Event and/or Task objects in this group */
  entries: (TJSCalendarEvent | TJSCalendarTask)[];
  /** URI for retrieving group updates */
  source?: string;
}

/**
 * Relation: Defines relations between JSCalendar objects
 */
interface TJSCalendarRelation {
  "@type": "Relation";
  /** Set of relation types */
  relation?: Record<"first" | "next" | "child" | "parent" | string, true>;
}

/**
 * Location: Represents a physical location
 */
export interface TJSCalendarLocation {
  "@type": "Location";
  /** Human-readable location name */
  name?: string;
  /** Plain-text access instructions */
  description?: string;
  /** Location types from IANA registry */
  locationTypes?: Record<string, true>;
  /** Geographic coordinates as "geo:" URI */
  coordinates?: string;
  /** Links associated with this location */
  links?: Record<string, TJSCalendarLink>;
}

/**
 * VirtualLocation: Represents a virtual meeting location
 */
export interface TJSCalendarVirtualLocation {
  "@type": "VirtualLocation";
  /** Human-readable name (default: empty string) */
  name?: string;
  /** Plain-text access instructions */
  description?: string;
  /** URI for connecting to this location */
  uri: string;
  /** Supported features (audio, video, chat, etc.) */
  features?: Record<"audio" | "chat" | "feed" | "moderator" | "phone" | "screen" | "video" | string, true>;
}

/**
 * Link: Represents an external resource associated with an object
 */
export interface TJSCalendarLink {
  "@type": "Link";
  /** URI to fetch the resource */
  href: string;
  /** Media type of the resource */
  contentType?: string;
  /** Size in octets when fully decoded */
  size?: TInteger;
  /** Link relation type (IANA Link Relations) */
  rel?: string;
  /** Intended purpose of image links: "badge", "graphic", "fullsize", "thumbnail" */
  display?: "badge" | "graphic" | "fullsize" | "thumbnail" | string;
  /** Human-readable description */
  title?: string;
}

/**
 * Participant: Represents an attendee or participant
 */
export interface TJSCalendarParticipant {
  "@type": "Participant";
  /** Human-readable name */
  name?: string;
  /** Email address */
  email?: string;
  /** Calendar user address (mailto: URI) */
  calendarAddress?: string;
  /** Participant roles */
  roles?: Record<TJSCalendarParticipationRole, true>;
  /** Participation status */
  participationStatus?: TJSCalendarParticipationStatus;
  /** Whether participation is required */
  expectReply?: boolean;
  /** Sent by another party */
  sentBy?: string;
  /** Percentage of group participation */
  percentage?: TInteger;
  /** Delegated to another participant */
  delegatedTo?: string;
  /** Delegated from another participant */
  delegatedFrom?: string;
  /** Member of group */
  memberOf?: string[];
  /** Schedule agent responsible for this participant */
  scheduleAgent?: "server" | "client" | "none" | string;
  /** Custom data for this participant */
  [key: string]: unknown;
}

export type TJSCalendarParticipationRole =
  | "owner"
  | "attendee"
  | "informational"
  | "chair"
  | string;

export type TJSCalendarParticipationStatus =
  | "needs-action"
  | "accepted"
  | "declined"
  | "tentative"
  | "delegated"
  | string;

/**
 * RecurrenceRule: Defines a recurrence pattern
 * Based on RFC 5545 RRULE syntax
 */
export interface TJSCalendarRecurrenceRule {
  /** Recurrence frequency */
  frequency: TJSCalendarRecurrenceFrequency;
  /** When to stop recurring */
  until?: TLocalDateTime | TUTCDateTime;
  /** Maximum occurrences */
  count?: TInteger;
  /** Interval between occurrences (default: 1) */
  interval?: TInteger;
  /** Days of week (mo, tu, we, th, fr, sa, su) */
  byDay?: { day: string; nthOfPeriod?: TInteger }[];
  /** Days of month (1-31, or -1 to -31 for reverse) */
  byMonthDay?: TInteger[];
  /** Months (1-12) */
  byMonth?: TInteger[];
  /** Occurrences within year (1-366, or -1 to -366) */
  byYearDay?: TInteger[];
  /** Occurrences within month (1-4 or -1) */
  bySetPosition?: TInteger[];
  /** Hours of day (0-23) */
  byHour?: TInteger[];
  /** Minutes of hour (0-59) */
  byMinute?: TInteger[];
  /** Seconds of minute (0-59) */
  bySecond?: TInteger[];
  /** Weeks of year (1-53, or -1 to -53) */
  byWeekNo?: TInteger[];
  /** First day of week (mo, tu, we, th, fr, sa, su) */
  firstDayOfWeek?: string;
  /** Recurrence date/times (explicit exceptions) */
  rscale?: string;
  /** Skip rule */
  skip?: "omitted" | string;
}

export type TJSCalendarRecurrenceFrequency =
  | "yearly"
  | "monthly"
  | "weekly"
  | "daily"
  | "hourly"
  | "minutely"
  | "secondly";

/**
 * Alert: Represents a notification or alarm
 */
export interface TJSCalendarAlert {
  "@type": "Alert";
  /** When the alert should trigger */
  trigger: TJSCalendarOffsetTrigger | TJSCalendarAbsoluteTrigger;
  /** Action type: "display" or "email" */
  action?: "display" | "email" | string;
  /** Alert description/summary */
  description?: string;
  /** Recipients for email alerts */
  recipients?: string[];
  /** Relative importance */
  relatedTo?: string[];
  /** Acknowledged timestamp */
  acknowledged?: TUTCDateTime;
  /** Custom data */
  [key: string]: unknown;
}

/**
 * OffsetTrigger: Alert trigger relative to start/end time
 */
interface TJSCalendarOffsetTrigger {
  "@type": "OffsetTrigger";
  /** Time offset from reference point */
  offset: TSignedDuration;
  /** Relative to "start" or "end" (default: "start") */
  relativeTo?: "start" | "end" | string;
}

/**
 * AbsoluteTrigger: Alert trigger at absolute date/time
 */
interface TJSCalendarAbsoluteTrigger {
  "@type": "AbsoluteTrigger";
  /** Absolute trigger time */
  when: TUTCDateTime;
}

/**
 * Media type constants
 */
export const TJSCalendarMediaTypes = {
  event: "application/jscalendar+json;type=event",
  task: "application/jscalendar+json;type=task",
  group: "application/jscalendar+json;type=group",
} as const;

/**
 * Recommended property validators
 */
export interface TJSCalendarValidationOptions {
  /** Check that uids are properly formatted */
  validateUids?: boolean;
  /** Check timezone references are valid */
  validateTimeZones?: boolean;
  /** Check participant email addresses */
  validateEmails?: boolean;
  /** Check URI formats */
  validateUris?: boolean;
  /** Strict RFC 8984 compliance */
  strict?: boolean;
}
