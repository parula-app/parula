import type { Topic, LinkTarget } from "../Topic";
import { Observable } from "../../util/Observable";
import { AbstractFunction } from "../../util/util";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

/**
 * A link from a topic to an email, contact, event, chat message or file.
 * In the JSON-LD of the topic, it's in `mentions`.
 *
 * The ID of the target is the same for all users, so that a shared topic works for everybody:
 * Each reader finds the target in their own accounts.
 * The snapshot of the target, e.g. the subject and date of an email, shows the link
 * while the target is not found, e.g. not downloaded yet, or the reader has no access to it.
 */
export class TopicLink extends Observable {
  readonly topic: Topic;
  readonly type: TopicLinkType;
  /** The class of the targets, e.g. `EMail` */
  static readonly targetClass: Function;
  /** The JSON-LD property with the `targetID`, e.g. "@id" */
  protected readonly idProperty: string;
  /** The JSON-LD property with the `date`, e.g. "dateSent" */
  protected readonly dateProperty: string;
  /** The same for all users, e.g. `mid:` and the Message-ID of an email.
   * null, if the target has no such ID, and can't be linked. */
  targetID: string | null = null;
  /** Snapshot: The title of the target, e.g. the subject of an email */
  name = "";
  /** Snapshot: E.g. when the email was sent, or when the event starts */
  date: Date | null = null;
  /** The target in our accounts, if `findTarget()` found it */
  target: LinkTarget | null = null;

  constructor(topic: Topic) {
    super();
    this.topic = topic;
  }

  /** Takes the ID and the snapshot from the target */
  setTarget(target: LinkTarget) {
    this.target = target;
  }

  /** Finds the target in our accounts.
   * @returns null, if not found */
  async findTarget(): Promise<LinkTarget | null> {
    throw new AbstractFunction();
  }

  toJSONLD(): any {
    return {
      "@type": this.type,
      [this.idProperty]: this.targetID,
      name: this.name || undefined,
      [this.dateProperty]: this.date?.toISOString(),
    };
  }

  fromJSONLD(json: any) {
    this.targetID = sanitize.nonemptystring(json[this.idProperty]);
    this.name = sanitize.label(json.name, "");
    this.date = sanitize.date(json[this.dateProperty], null);
  }
}

/** The schema.org types of the targets that we support */
export enum TopicLinkType {
  EMail = "EmailMessage",
  Person = "Person",
  Event = "Event",
  ChatMessage = "Message",
  File = "DigitalDocument",
}
