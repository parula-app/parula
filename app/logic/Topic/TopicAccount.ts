import type { Topic } from "./Topic";
import type { FileTopicStorage } from "./File/FileTopicStorage";
import { Account } from "../Abstract/Account";
import { appGlobal } from "../app";
import { notifyChangedProperty } from "../util/Observable";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { ArrayColl } from "svelte-collections";

export class TopicAccount extends Account {
  readonly protocol: string = "topic-local";
  /** The database, with all topics. Reads them. */
  storage: TopicAccountStorage | null = null;
  /** Also store the topics as files, e.g. on this computer. They sync with `storage`. @see `FileTopicStorage` */
  readonly contentStorage = new ArrayColl<FileTopicStorage>();
  /** Also save the topics as Markdown files on this computer, for other apps @see `LocalFileTopicStorage` */
  @notifyChangedProperty
  saveAsLocalFiles = true;

  readonly topics = new ArrayColl<Topic>();

  async save(): Promise<void> {
    await super.save();
    await this.storage?.saveAccount(this);
  }

  async deleteIt(): Promise<void> {
    await super.deleteIt();
    await this.storage?.deleteAccount(this);
    appGlobal.topicAccounts.remove(this);
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.saveAsLocalFiles = sanitize.boolean(json.saveAsLocalFiles, true);
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.saveAsLocalFiles = this.saveAsLocalFiles;
    return json;
  }
}

export interface TopicAccountStorage {
  saveAccount(account: TopicAccount): Promise<void>;
  deleteAccount(account: TopicAccount): Promise<void>;
  saveTopic(topic: Topic): Promise<void>;
  deleteTopic(topic: Topic): Promise<void>;
}
