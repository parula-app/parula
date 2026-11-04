import { Calendar } from "../Calendar";
import { AddonEvent } from "./AddonEvent";
import { AuthMethod } from "../../Abstract/Account";
import { AddonConnection } from "../../Addons/AddonConnection";
import { appGlobal } from "../../app";
import { Lock } from "../../util/flow/Lock";
import type { ArrayColl } from "svelte-collections";

/** A calendar whose protocol an addon implements.
 * The addon does only the server talk, with events in iCalendar format.
 * They are parsed, stored and shown like those of other protocols. */
export class AddonCalendar extends Calendar {
  readonly protocol: string;
  readonly connection = new AddonConnection(this, appGlobal.calendars);
  declare readonly events: ArrayColl<AddonEvent>;
  /** Opaque, from the addon */
  declare syncState: string | null;
  protected readonly syncLock = new Lock();

  /** @param protocol `AddonProtocol.accountProtocol()` */
  constructor(protocol: string) {
    super();
    this.protocol = protocol;
    this.authMethod = AuthMethod.Password;
  }

  newEvent(parentEvent?: AddonEvent): AddonEvent {
    return new AddonEvent(this, parentEvent);
  }

  get isLoggedIn(): boolean {
    return this.connection.isLoggedIn;
  }

  async login(interactive: boolean): Promise<void> {
    await super.login(interactive);
    await this.connection.login();
  }

  async verifyLogin(): Promise<void> {
    await this.connection.verifyLogin();
  }

  async disconnect(): Promise<void> {
    this.connection.disconnect();
  }

  /** Gets the new, changed and removed events from the addon, in chunks */
  protected async listEventsFromServer(): Promise<void> {
    let lock = await this.syncLock.lock();
    try {
      await this.connection.listChanges("listEvents", [], this.syncState, "events",
        async (events, removed, syncState) => await this.applyEventList(events, removed, syncState));
    } finally {
      lock.release();
    }
  }

  /** Stores one checked chunk from the addon */
  protected async applyEventList(events: any[], removed: unknown[], syncState: string): Promise<void> {
    const kMaxICalLength = 1024 * 1024;
    let byID = new Map<string, AddonEvent>();
    for (let event of this.events) {
      if (event.pID && !event.parentEvent) {
        byID.set(event.pID, event);
      }
    }
    for (let json of events) {
      try {
        let id = this.connection.checkID(json?.id);
        if (typeof json.ical != "string" || json.ical.length > kMaxICalLength) {
          throw new Error(`${this.name}: The addon gave no iCalendar for the event ${id}, or one larger than 1 MB`);
        }
        let existing = byID.get(id);
        let event = existing ?? this.newEvent();
        if (!event.fromAddon(id, json.ical)) {
          continue;
        }
        if (!existing) {
          this.events.add(event);
          byID.set(id, event);
        }
        await event.saveLocally();
        await event.updateExceptions(json.ical);
      } catch (ex) {
        this.dataError(ex);
      }
    }
    for (let id of removed) {
      let event = typeof id == "string" ? byID.get(id) : undefined;
      if (!event) {
        continue;
      }
      try {
        await event.deleteLocally();
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
    this.syncState = syncState;
    await this.save();
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.syncState = typeof json.syncState == "string" ? json.syncState : null;
    this.connection.fromConfigJSON(json);
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    this.connection.toConfigJSON(json);
    return json;
  }
}
