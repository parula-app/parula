import type { TopicAccount } from "./TopicAccount";
import { Paragraph, type PageContent } from "./PageContent";
import type { TopicLink } from "./Link/TopicLink";
import { newTopicLinkForTarget } from "./Link/TopicLinks";
import type { Person } from "../Abstract/Person";
import type { Group } from "../Abstract/Group";
import type { Message } from "../Abstract/Message";
import type { Event } from "../Calendar/Event";
import type { File } from "../Files/File";
import { convertHTMLToMarkdown } from "../util/convertHTML";
import { fileExtensionForMIMEType } from "../Files/FileType/MIMETypes";
import { Observable, notifyChangedProperty } from "../util/Observable";
import { NotReached, NotSupported, assert } from "../util/util";
import { gt } from "../../l10n/l10n";
import { ArrayColl } from "svelte-collections";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";

export class Topic extends Observable {
  id: string = crypto.randomUUID();
  account: TopicAccount;
  /** Title of the topic.
   * Shown in graph as node title, in page as page title, and
   * in linked data as tag name.
   * Also `#<name>` in text. */
  @notifyChangedProperty
  name: string;
  dbID: number;
  /** When the topic was last changed, to know whether its files are newer @see `FileTopicStorage` */
  lastMod: Date | null = null;

  parent: Topic | null = null;
  /** Sub-topics */
  readonly children = new ArrayColl<Topic>();
  /** Connections to other objects (other than child/parent), e.g. emails and contacts.
   * In LinkedData, these are the object properties. */
  readonly links = new ArrayColl<TopicLink>();

  /**
   * Structured information about the topic.
   * In LinkedData, these are the non-object properties.
   */
  readonly properties = new ArrayColl<ValueProperty>();

  /** Paragraphs and data elements in the page.
   * In the order that they appear on the page. */
  readonly content = new ArrayColl<PageContent>();

  trimEnd() {
    let p = this.content.last;
    while (p instanceof Paragraph && !p.hasContent) {
      this.content.remove(p);
      p = this.content.last;
    }
  }

  toHTML(level = 1): string {
    // Heading
    let html = `<h${level}>${this.name}</h${level}>`;

    // Text body
    for (let content of this.content) {
      if (content instanceof Paragraph) {
        if (content.hasContent) {
          html += content.html;
        }
      }
    }

    // Child topics
    level = Math.min(++level, 6);
    for (let child of this.children) {
      html += child.toHTML(level);
    }
    return html;
  }

  toFile(mimeType: string): globalThis.File {
    let html = this.toHTML();
    let fileContent: string;
    if (mimeType == "text/html") {
      fileContent = html;
    } else if (mimeType == "text/markdown") {
      fileContent = convertHTMLToMarkdown(html);
    } else {
      throw new NotReached(gt`File type ${mimeType} is not supported`);
    }
    return new globalThis.File(
      [fileContent],
      sanitize.filename(this.name + "." + fileExtensionForMIMEType(mimeType)),
      { type : mimeType });
  }


  async newChild(name: string): Promise<Topic> {
    assert(this.account, "Need account");
    let topic = new Topic();
    topic.account = this.account;
    topic.parent = this;
    this.children.add(topic);
    this.account.topics.add(topic);
    topic.name = name;
    await topic.save();
    return topic;
  }

  /** Links an email, contact, event, chat message or file to this topic */
  async addLink(target: LinkTarget): Promise<void> {
    let link = newTopicLinkForTarget(this, target);
    if (!link.targetID) {
      throw new NotSupported(gt`${link.name} has no ID that others can find, so it cannot be added to a topic`);
    }
    if (this.links.find(other => other.targetID == link.targetID)) {
      return;
    }
    this.links.add(link);
    await this.save();
  }

  async removeLink(link: TopicLink): Promise<void> {
    this.links.remove(link);
    await this.save();
  }

  /** Finds the emails, contacts etc. of the links in our accounts, as `link.target` */
  async findLinkTargets(): Promise<void> {
    await Promise.all(this.links.contents.map(async link => {
      try {
        link.target ??= await link.findTarget();
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }));
  }

  async save() {
    this.lastMod = new Date();
    await this.account.storage.saveTopic(this);
    for (let storage of this.account.contentStorage) {
      await storage.saveTopic(this);
    }
    this.notifyObservers("content");
  }

  /** Also deletes the sub-topics */
  async deleteIt() {
    // From the last, so that the others keep their position
    for (let child of this.children.contents.toReversed()) {
      await child.deleteIt();
    }
    this.parent.children.remove(this);
    this.account.topics.remove(this);
    await this.account.storage.deleteTopic(this);
    for (let storage of this.account.contentStorage) {
      await storage.deleteTopic(this);
    }
  }

  /** The sub-topics, their sub-topics etc., in the order of the page */
  get descendants(): Topic[] {
    return this.children.contents.flatMap(child => [child, ...child.descendants]);
  }

  /** 0 for the root topic, 1 for its sub-topics etc. */
  get depth(): number {
    return this.parent ? this.parent.depth + 1 : 0;
  }
}

export type LinkTarget = Topic | Person | Group | Message | Event | File;

export type LinkType = string;

export interface ValueProperty {
  name: string;
  value: string | number | boolean;
}
