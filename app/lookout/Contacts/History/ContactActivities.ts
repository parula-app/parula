import type { Person } from "../../../logic/Abstract/Person";
import { EMail } from "../../../logic/Mail/EMail";
import { Event } from "../../../logic/Calendar/Event";
import { File } from "../../../logic/Files/File";
import { searchLog, type LogEntry } from "../../../logic/Contacts/History/History";
import type { Collection } from "svelte-collections";

export enum ActivityKind {
  All = "all",
  Messages = "messages",
  Files = "files",
  Meetings = "meetings",
}

export class ContactActivities {
  static readonly kFirstLimit = 200;
  static readonly kMoreLimit = 1000;
  readonly person: Person;
  readonly limit: number;
  readonly all: Collection<LogEntry>;

  constructor(person: Person, limit = ContactActivities.kFirstLimit) {
    this.person = person;
    this.limit = limit;
    this.all = searchLog(person, limit);
  }

  of(kind: ActivityKind): Collection<LogEntry> {
    if (kind == ActivityKind.All) {
      return this.all;
    }
    return this.all.filterObservable(entry => ContactActivities.kindOf(entry) == kind);
  }

  more(): ContactActivities {
    let limit = this.limit == ContactActivities.kFirstLimit ? ContactActivities.kMoreLimit : this.limit + ContactActivities.kMoreLimit;
    return new ContactActivities(this.person, limit);
  }

  static kindOf(entry: LogEntry): ActivityKind | null {
    if (entry instanceof EMail) {
      return ActivityKind.Messages;
    }
    if (entry instanceof File) {
      return ActivityKind.Files;
    }
    if (entry instanceof Event) {
      return ActivityKind.Meetings;
    }
    return null;
  }

  static timeOf(entry: LogEntry): Date | null {
    if (entry instanceof EMail) {
      return entry.sent ?? entry.received ?? null;
    }
    if (entry instanceof File) {
      return entry.lastMod ?? null;
    }
    if (entry instanceof Event) {
      return entry.startTime ?? null;
    }
    return null;
  }
}
