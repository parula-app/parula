import { Topic } from "../Topic";
import { Paragraph } from "../PageContent";
import type { TopicAccount, TopicAccountStorage } from "../TopicAccount";
import { convertHTMLToMarkdown, convertMarkdownToHTML } from "../../util/convertHTML";
import { Lock } from "../../util/flow/Lock";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { gt } from "../../../l10n/l10n";

/**
 * Stores the topics as files, which the user may edit, rename and move with other apps.
 * Each topic has 2 files with the same name, and its sub-topics are in a folder:
 * - `Marketing.md`: The text of the page, as Markdown
 * - `Marketing.jsonld`: The ID of the topic, other data about it, and its links to emails,
 *   contacts etc., as JSON-LD with schema.org. @see `TopicLink`
 * - `Marketing/`: The sub-topics
 *
 * The folder of the account is the root topic, without files.
 * `sync()` compares the files with the database. The more recent one wins:
 * First by the time of the files, so that we read only the files that changed, then by `dateModified` in the .jsonld file.
 *
 * Subclasses store the files, e.g. on this computer @see `LocalFileTopicStorage`
 */
export abstract class FileTopicStorage implements TopicAccountStorage {
  /** Topic -> Path of its files, relative to the folder of the account, without extension, as they are now */
  protected readonly paths = new Map<Topic, string>();
  /** Topic -> `position` in its .jsonld file, which is its index among its siblings */
  protected readonly positions = new Map<Topic, number>();
  /** A rename changes the paths of the sub-topics */
  protected readonly lock = new Lock();

  async saveAccount(account: TopicAccount): Promise<void> {
  }

  /** Keeps the files, because they are the documents of the user */
  async deleteAccount(account: TopicAccount): Promise<void> {
  }

  async saveTopic(topic: Topic): Promise<void> {
    await this.writeFiles(topic);
  }

  /** Also deletes the files of the sub-topics */
  async deleteTopic(topic: Topic): Promise<void> {
    await this.deleteFiles(topic);
  }

  /** Reads the topics that changed in the files into the database, and writes the files of the topics
   * that changed in the app. Also when the user turns on these files. */
  async sync(account: TopicAccount): Promise<void> {
    let outdated = new Set<Topic>();
    await this.syncFolder(account.topics.find(topic => !topic.parent), "", outdated);
    // After we know the paths of all files, so that a new file doesn't replace another
    for (let topic of outdated) {
      await this.writeFiles(topic);
    }
  }

  /** Reads the sub-topics of `parent` that changed in the files in its folder, and then their sub-topics.
   * A `.md` file, `.jsonld` file or folder alone is a topic as well, e.g. when made by another app.
   * @param outdated Adds the topics whose files we need to write */
  protected async syncFolder(parent: Topic, path: string, outdated: Set<Topic>): Promise<void> {
    let account = parent.account;
    let entries = await this.listFolder(path);
    /** File name -> Last modified, in ms */
    let fileTimes = new Map(entries.filter(entry => !entry.isDirectory).map(entry => [entry.name, sanitize.date(entry.lastMod).getTime()]));
    let names = new Set(entries.filter(entry => entry.isDirectory).map(entry => entry.name));
    for (let file of fileTimes.keys()) {
      for (let extension of [".md", ".jsonld"]) {
        if (file.endsWith(extension)) {
          names.add(file.slice(0, -extension.length));
        }
      }
    }
    let newTopics: { topic: Topic, position: number }[] = [];
    for (let name of names) {
      try {
        let mdTime = fileTimes.get(name + ".md") ?? 0;
        let jsonTime = fileTimes.get(name + ".jsonld") ?? 0;
        let topic = parent.children.find(child => !this.paths.has(child) && fileName(child.name) == name);
        if (topic && Math.max(mdTime, jsonTime) <= topic.lastMod?.getTime()) {
          this.paths.set(topic, path + name);
          this.positions.set(topic, parent.children.indexOf(topic));
          if (Math.min(mdTime, jsonTime) < topic.lastMod.getTime()) {
            outdated.add(topic);
          }
          continue;
        }

        let json = jsonTime ? sanitize.json(await this.readFile(path + name + ".jsonld"), {}) : {};
        if (json["@id"]) {
          topic = account.topics.find(other => "urn:uuid:" + other.id == json["@id"]);
        }
        // We write both files with the same time, so a newer .md was edited by another app
        let fileTime = mdTime > jsonTime ? mdTime : sanitize.date(json.dateModified, null)?.getTime() ?? jsonTime;
        if (topic && fileTime <= topic.lastMod?.getTime()) {
          this.paths.set(topic, path + name);
          this.positions.set(topic, sanitize.integer(json.position, -1));
          if (fileTime < topic.lastMod.getTime() || topic.parent != parent) {
            outdated.add(topic);
          }
          continue;
        }

        // Changed in the files, or new
        let isNew = !topic;
        topic ??= new Topic();
        topic.account = account;
        if (jsonTime || isNew) {
          this.fromJSONLD(topic, json, name);
        }
        topic.content.clear();
        if (mdTime) {
          let markdown = await this.readFile(path + name + ".md");
          if (markdown.trim()) {
            let paragraph = new Paragraph(topic);
            paragraph.rawHTMLDangerous = convertMarkdownToHTML(markdown);
          }
        }
        topic.lastMod = new Date(fileTime || Date.now());
        this.paths.set(topic, path + name);
        this.positions.set(topic, sanitize.integer(json.position, -1));
        if (!isNew) {
          if (topic.parent != parent) { // moved
            topic.parent.children.remove(topic);
            topic.parent = parent;
            parent.children.add(topic);
          }
          await account.storage.saveTopic(topic);
        } else {
          topic.parent = parent;
          newTopics.push({ topic, position: this.positions.get(topic) });
        }
      } catch (ex) {
        account.errorCallback(ex);
      }
    }
    // After the topics that we already have, in the order of the files
    newTopics.sort((a, b) => a.position - b.position);
    for (let { topic } of newTopics) {
      parent.children.add(topic);
      account.topics.add(topic);
      await account.storage.saveTopic(topic);
    }
    for (let child of parent.children.contents) {
      if (!this.paths.has(child)) {
        outdated.add(child);
      }
      await this.syncFolder(child, (this.paths.get(child) ?? this.newPath(child)) + "/", outdated);
    }
  }

  protected async writeFiles(topic: Topic): Promise<void> {
    if (!topic.parent) {
      return; // The root topic is the folder
    }
    let lock = await this.lock.lock();
    try {
      let path = this.newPath(topic);
      let oldPath = this.paths.get(topic);
      if (oldPath && oldPath != path) {
        await this.move(oldPath, path);
      }
      this.paths.set(topic, path);
      this.positions.set(topic, topic.parent.children.indexOf(topic));
      // The files get the time of the topic, so that `sync()` sees that they are the same
      let time = topic.lastMod ?? new Date();
      await this.writeFile(path + ".md", this.toMarkdown(topic), time);
      await this.writeFile(path + ".jsonld", JSON.stringify(this.toJSONLD(topic), null, 2) + "\n", time);
    } finally {
      lock.release();
    }
  }

  protected async deleteFiles(topic: Topic): Promise<void> {
    let lock = await this.lock.lock();
    try {
      let path = this.paths.get(topic);
      if (!path) {
        return; // no files
      }
      for (let extension of [".md", ".jsonld", ""]) {
        await this.remove(path + extension);
      }
      for (let [other, otherPath] of this.paths) {
        if (otherPath == path || otherPath.startsWith(path + "/")) {
          this.paths.delete(other);
          this.positions.delete(other);
        }
      }
    } finally {
      lock.release();
    }
    // The siblings after it moved up
    for (let sibling of topic.parent.children.contents) {
      if (this.positions.get(sibling) != topic.parent.children.indexOf(sibling)) {
        await sibling.save();
      }
    }
  }

  /** @param path relative to the folder of the account, like all paths here
   * @returns the files and folders, or none, if the folder doesn't exist yet */
  protected abstract listFolder(path: string): Promise<{ name: string, isDirectory: boolean, lastMod: Date }[]>;
  protected abstract readFile(path: string): Promise<string>;
  /** Also creates the folders. The file gets `time` as its last modification. */
  protected abstract writeFile(path: string, content: string, time: Date): Promise<void>;
  /** A file or a folder. Nothing, if it doesn't exist. Also creates the folders of `to`. */
  protected abstract rename(from: string, to: string): Promise<void>;
  /** A file, or a folder with its contents. Nothing, if it doesn't exist. */
  protected abstract remove(path: string): Promise<void>;

  protected toMarkdown(topic: Topic): string {
    let html = topic.content.contents
      .map(content => content instanceof Paragraph ? content.rawHTMLDangerous : "")
      .join("");
    let markdown = convertHTMLToMarkdown(html);
    return markdown ? markdown + "\n" : "";
  }

  protected toJSONLD(topic: Topic): any {
    return {
      "@context": "https://schema.org/",
      "@type": "CreativeWork",
      "@id": "urn:uuid:" + topic.id,
      name: topic.name,
      position: this.positions.get(topic),
      dateModified: topic.lastMod?.toISOString(),
      additionalProperty: topic.properties.contents.map(property => ({
        "@type": "PropertyValue",
        name: property.name,
        value: property.value,
      })),
    };
  }

  /** @param fileName for a topic without a name, e.g. a `.md` file made by another app */
  protected fromJSONLD(topic: Topic, json: any, fileName: string) {
    let id = sanitize.string(json["@id"], "");
    if (id.startsWith("urn:uuid:")) {
      topic.id = sanitize.alphanumdash(id.substring("urn:uuid:".length), topic.id);
    }
    topic.name = sanitize.label(json.name, fileName);
    topic.properties.clear();
    for (let property of Array.isArray(json.additionalProperty) ? json.additionalProperty : []) {
      if (["string", "number", "boolean"].includes(typeof property?.value)) {
        topic.properties.add({ name: sanitize.label(property.name), value: property.value });
      }
    }
  }

  /** @returns where the files of `topic` must be, after a rename or move */
  protected newPath(topic: Topic): string {
    let parent = topic.parent;
    let parentPath = parent.parent ? (this.paths.get(parent) ?? this.newPath(parent)) + "/" : "";
    let basePath = parentPath + fileName(topic.name);
    let path = basePath;
    // Also on file systems that ignore the case
    for (let i = 2; parent.children.find(sibling => sibling != topic && this.paths.get(sibling)?.toLowerCase() == path.toLowerCase()); i++) {
      path = `${basePath} (${i})`;
    }
    return path;
  }

  /** Renames or moves the files of the topic, and the folder with its sub-topics */
  protected async move(oldPath: string, newPath: string): Promise<void> {
    for (let extension of [".md", ".jsonld", ""]) {
      await this.rename(oldPath + extension, newPath + extension);
    }
    for (let [topic, path] of this.paths) {
      if (path.startsWith(oldPath + "/")) {
        this.paths.set(topic, newPath + path.substring(oldPath.length));
      }
    }
  }
}

/** Without the characters that file systems or other apps don't allow.
 * Without dots at the start, which would hide the file or go to the parent folder. */
function fileName(topicName: string): string {
  let name = sanitize.filename(topicName, "");
  while (name.startsWith(".") || name.endsWith(".")) {
    name = name.startsWith(".") ? name.substring(1) : name.slice(0, -1);
  }
  return name || gt`Topic`;
}
