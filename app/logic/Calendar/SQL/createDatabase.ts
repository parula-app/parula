import sql from "../../../../lib/rs-sqlite/index";

/** Separate from the schema below, so that the migration for
 * pre-existing databases can create the same table. */
export const eventAttachmentSchema = sql`
  --- Files that the organizer attached to the event
  CREATE TABLE "eventAttachment" (
    "id" INTEGER PRIMARY KEY,
    "eventID" INTEGER not null,
    -- filename with extension, as given by the organizer
    "filename" TEXT not null,
    -- filename and path where the attachment is stored on the user's local disk, after download
    -- path is relative to app root directory
    "filepathLocal" TEXT default null,
    "mimeType" TEXT not null,
    -- file size in bytes. null, if not yet downloaded
    "size" INTEGER default null,
    -- Protocol-specific ID of the attachment on the server, e.g. the EWS AttachmentId
    "pID" TEXT default null,
    -- Additional data
    "json" TEXT default null,
    UNIQUE("eventID", "filename"),
    FOREIGN KEY (eventID)
      REFERENCES event (ID)
      ON DELETE CASCADE
  );
`;

/** Separate from the schema below, so that the migration for
 * pre-existing databases can create the same index. */
export const eventPIDIndex = sql`
  CREATE UNIQUE INDEX index_event_pID ON event (calendarID, pID);
`;

export const calendarDatabaseSchema = sql`
  CREATE TABLE "calendar" (
    "id" INTEGER PRIMARY KEY,
    "idStr" TEXT not null UNIQUE,
    "protocol" TEXT not null
  );

  --- Meetings scheduled at a specific date/time
  CREATE TABLE "event" (
    "id" INTEGER PRIMARY KEY,
    "calendarID" INTEGER default null,
    -- iCal UID for a meeting
    "calUID" TEXT default null,
    -- Protocol-specific ID
    "pID" TEXT default null,
    -- Summary or subject of the event
    -- Plaintext
    "title" TEXT not null,
    -- Meeting agenda, reasons for the meeting etc.
    -- As HTML fragment, only the part inside HTML body
    "descriptionHTML" TEXT default null,
    -- Plaintext version of the description. Content MUST semantically match the HTML version.
    "descriptionText" TEXT default null,
    -- ISO-8601 datetime when the meeting starts/ends
    -- If start time is null, it's a task
    "startTime" TEXT default null,
    "endTime" TEXT default null,
    -- Timezone, as 3/4-letter abbreviation
    "startTimeTZ" TEXT default null,
    "endTimeTZ" TEXT default null,
    -- Ignore the time component, use only the day component. Event starts at 0:00 and ends 23:59.
    "allDay" BOOLEAN default false,
    -- Webpage where to join the video conference.
    -- Used internally to determine the video conference protocol and meeting ID to be used.
    "onlineMeetingURL" TEXT default null,
    -- Conference zoom, street address etc.
    "physicalLocation" TEXT default null,
    -- If physical location is set, optionally contains the GPS coordinates of it
    -- e.g. "48.85299;2.36885"
    "gps" TEXT default null,
    -- ISO-8601 datetime when to remind the user
    "alarm" TEXT default null,
    -- Who scheduled the meeting.
    -- If our user scheduled the event with other participants (see table "eventParticipant"),
    -- this is set to our user's email address that was used to send the invitation.
    -- Format: "Real Name <emailaddress@example.com>"
    -- If null, it's a private event of our user, not including other people.
    "organizer" TEXT default null,
    -- Whether the user responded to a meeting
    -- 0 = Unknown
    -- 1 = User is the organiser of the meeting
    -- 2 = User tentatively accepted the meeting
    -- 3 = User accepted the meeting
    -- 4 = User declined the meeting
    -- 5 = User has not yet responded
    responseToOrganizer INTEGER default 0,
    -- Background color for this event, set by the user specifically for this event.
    -- Format: HTML hex code without "#"
    -- Optional. If null, the background color will be determined by the calendar.
    "color" TEXT default null,
    -- 0 = Event. Not a task.
    -- 1 = task without start and end time. Start and end time are dummy values.
    -- 2 = task with due time (= end time), but without start time
    -- 3 = task with start time and due time
    "task" INTEGER default null,
    -- If this is a recurring (repeating) meeting and this is the master, contains the RRule.
    -- For non-repeating events, this is null. For recurring instances, this is null and "recurrenceMaster" is set.
    -- Format: iCalendar RRule
    "recurrenceRule" TEXT default null,
    -- If this is an instance of a recurring meeting (not the master),
    -- this is the event ID of the master.
    "recurrenceMasterEventID" INTEGER default null,
    -- If this is an instance of a recurring meeting (not the master),
    -- this is the instance's original start time.
    -- The "startTime" may contain a modified time as an exception.
    -- This allows us to work out the instance index of an exception,
    -- even if its actual start time has been modified.
    "recurrenceStartTime" TEXT default null,
    -- If this is an instance of a recurring meeting (not the master),
    -- and this instance does not follow the normal pattern set by the master,
    -- but is changed in some way, e.g. exceptionally on a different day or time,
    -- then this is true. This means that the information in this event cannot
    -- be completely derived from the recurrence master and is therefore unique data.
    "recurrenceIsException" BOOLEAN default false,
    -- A string that changes when the event
    "changeStamp" TEXT default null,
    -- Original event file, as received over the wire.
    -- When modifying the event, after updating the fields in this DB table,
    -- read this source, modify *only* the changed or supported fields, and keep
    -- all unsupported fields as-is, then write back the file. This avoids that
    -- we delete unsupported fields in the original file format.
    "source" TEXT default null,
    -- Format of the "source"
    -- As MIME type, e.g. "text/calendar" for iCalendar as defined by RFC 9253
    "sourceMimetype" TEXT default null,
    -- Additional data
    "json" TEXT default null,
    FOREIGN KEY (calendarID)
      REFERENCES calendar (id)
      ON DELETE CASCADE,
    FOREIGN KEY (recurrenceMasterEventID)
      REFERENCES event (id)
      ON DELETE CASCADE
  );
  --- The server gives each event exactly one ID, so an event that we already have
  --- must be updated, not added again. NULL for events that are only local.
  $${eventPIDIndex}

  --- Used to keep track of deleted occurrences
  CREATE TABLE "eventExclusion" (
    "recurrenceMasterEventID" INTEGER,
    "recurrenceIndex" INTEGER,
    FOREIGN KEY (recurrenceMasterEventID)
      REFERENCES event (id)
      ON DELETE CASCADE
  );
  CREATE INDEX index_exclusion_eventID ON eventExclusion (recurrenceMasterEventID);

  --- Who will attent the event, not including our user
  CREATE TABLE "eventParticipant" (
    "eventID" INTEGER not null,
    "emailAddress" TEXT not null,
    "name" TEXT,
    -- 0 = unknown
    -- 1 = organizer
    -- 2 = tentative
    -- 3 = accepted
    -- 4 = rejected
    -- 5 = not responded
    "confirmed" INTEGER default 0,
    -- Additional data
    "json" TEXT default null,
    FOREIGN KEY (eventID)
      REFERENCES event (id)
      ON DELETE CASCADE
  );
  CREATE INDEX index_groupMember_eventID ON eventParticipant (eventID);

  $${eventAttachmentSchema}
`;
