// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Person, ContactEntry } from "../../../../logic/Abstract/Person";
import type { Topic } from "../../../../logic/Topic/Topic";
import { Paragraph } from "../../../../logic/Topic/PageContent";
import type { TopicAccount } from "../../../../logic/Topic/TopicAccount";
import { createRootTopic, newTopicAccountForProtocol, readTopicAccounts, setContentStorage } from "../../../../logic/Topic/TopicAccounts";
import { getDatabase } from "../../../../logic/Topic/SQL/SQLDatabase";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import sql from "../../../../../lib/rs-sqlite";
import * as fs from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";

let filesDir: string;

beforeAll(() => {
  let tempDir = mkdtempSync(path.join(tmpdir(), "topic-files-test-"));
  filesDir = path.join(tempDir, "files");
  appGlobal.me = new Person();
  appGlobal.me.name = "Fred Test";
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
    getFilesDir: () => filesDir,
    fs,
    // <copied from="desktop/backend/backend.ts">
    async listDirectoryContents(dirPath: string, withStats = true, includeHidden = false) {
      let files = [];
      for (let entry of await fs.readdir(dirPath, { withFileTypes: true })) {
        if (!includeHidden && entry.name[0] == ".") {
          continue;
        }
        let filePath = path.join(entry.parentPath, entry.name);
        files.push({ name: entry.name, path: filePath, isDirectory: entry.isDirectory(), lastMod: withStats ? (await fs.stat(filePath)).mtime : undefined });
      }
      return files;
    },
    // </copied>
  } as any;
});

let root: Topic;
beforeEach(() => {
  appGlobal.topicAccounts.clear();
  root = createRootTopic("Fred");
  root.children.clear();
  root.dbID = null;
});

afterEach(async () => {
  for (let account of appGlobal.topicAccounts.contents) {
    await account.deleteIt();
  }
});

async function newAccount(saveAsLocalFiles = true): Promise<TopicAccount> {
  let account = newTopicAccountForProtocol("topic-local");
  account.name = "Test topics";
  account.saveAsLocalFiles = saveAsLocalFiles;
  await account.save();
  root.account = account;
  account.topics.add(root);
  await root.save();
  await setContentStorage(account);
  appGlobal.topicAccounts.add(account);
  return account;
}

function accountFolder(account: TopicAccount): string {
  return path.join(filesDir, "topics", account.id);
}

/** Reads the topics from the database and the files again, like at the next app start
 * @returns the root topic */
async function readAgain(): Promise<Topic> {
  appGlobal.topicAccounts.clear();
  appGlobal.topicAccounts.addAll(await readTopicAccounts());
  return appGlobal.topicAccounts.first.topics.find(topic => !topic.parent);
}

/** Like another device, which has only the files */
async function deleteFromDatabase(account: TopicAccount) {
  await (await getDatabase()).run(sql`
    DELETE FROM topic
    WHERE accountID = ${account.dbID} AND parentID IS NOT NULL
    `);
}

/** Like another app or device that changes the file later */
async function writeLater(file: string, content: string, offsetMS = 1000) {
  await fs.writeFile(file, content);
  let time = (Date.now() + offsetMS) / 1000;
  await fs.utimes(file, time, time);
}

async function newTopic(parent: Topic, name: string, html?: string): Promise<Topic> {
  let topic = await parent.newChild(name);
  if (html) {
    let paragraph = new Paragraph(topic);
    paragraph.rawHTMLDangerous = html;
    await topic.save();
  }
  return topic;
}

test("Topics are .md and .jsonld files with the same name, sub-topics in a folder", async () => {
  let account = await newAccount();
  let project = await newTopic(root, "Project A", "<p>The <strong>plan</strong></p>");
  let marketing = await newTopic(project, "Marketing", "<p>Social media</p>");
  project.properties.add({ name: "color", value: "blue" });
  await project.save();

  let folder = accountFolder(account);
  expect(await fs.readFile(path.join(folder, "Project A.md"), "utf-8")).toContain("The **plan**");
  let json = JSON.parse(await fs.readFile(path.join(folder, "Project A.jsonld"), "utf-8"));
  expect(json["@id"]).toContain(project.id);
  expect(json.name).toBe("Project A");
  expect(await fs.readFile(path.join(folder, "Project A", "Marketing.md"), "utf-8")).toContain("Social media");
  expect(JSON.parse(await fs.readFile(path.join(folder, "Project A", "Marketing.jsonld"), "utf-8"))["@id"]).toContain(marketing.id);

  let read = await readAgain();
  let readProject = read.children.find(topic => topic.id == project.id);
  expect(readProject.name).toBe("Project A");
  expect((readProject.content.first as Paragraph).rawHTMLDangerous).toContain("<strong>plan</strong>");
  expect(readProject.properties.contents).toEqual([{ name: "color", value: "blue" }]);
  expect(readProject.children.first.id).toBe(marketing.id);
  expect(readProject.children.first.parent).toBe(readProject);
  expect(appGlobal.topics.contains(readProject.children.first)).toBe(true);
});

test("Sub-topics keep their order, also in the files", async () => {
  let account = await newAccount();
  let names = ["Zulu", "Alpha", "Mike"];
  for (let name of names) {
    await newTopic(root, name);
  }
  await root.children.find(topic => topic.name == "Alpha").deleteIt();
  await newTopic(root, "Bravo");
  let read = await readAgain();
  expect(read.children.contents.map(topic => topic.name)).toEqual(["Zulu", "Mike", "Bravo"]);

  await deleteFromDatabase(account);
  read = await readAgain();
  expect(read.children.contents.map(topic => topic.name)).toEqual(["Zulu", "Mike", "Bravo"]);
});

test("Rename and move a topic, with its sub-topics", async () => {
  let account = await newAccount();
  let project = await newTopic(root, "Project");
  let other = await newTopic(root, "Other");
  let task = await newTopic(project, "Task", "<p>Do it</p>");
  await newTopic(task, "Step", "<p>First</p>");

  project.name = "Renamed";
  await project.save();
  let folder = accountFolder(account);
  expect(await fs.readdir(folder)).not.toContain("Project");
  expect(await fs.readFile(path.join(folder, "Renamed", "Task", "Step.md"), "utf-8")).toContain("First");

  project.children.remove(task);
  task.parent = other;
  other.children.add(task);
  await task.save();
  expect(await fs.readdir(path.join(folder, "Renamed"))).not.toContain("Task.md");
  expect(await fs.readFile(path.join(folder, "Other", "Task", "Step.md"), "utf-8")).toContain("First");

  let read = await readAgain();
  let readOther = read.children.find(topic => topic.id == other.id);
  expect(readOther.children.first.name).toBe("Task");
  expect(readOther.children.first.children.first.name).toBe("Step");
  expect(read.children.find(topic => topic.id == project.id).children.isEmpty).toBe(true);
});

test("Delete a topic with its sub-topics", async () => {
  let account = await newAccount();
  let project = await newTopic(root, "Project");
  await newTopic(project, "Task");
  await newTopic(root, "Stays");
  await project.deleteIt();
  expect(await fs.readdir(accountFolder(account))).toEqual(["Stays.jsonld", "Stays.md"]);
});

test("Topics with the same name, or with characters that files can't have", async () => {
  let account = await newAccount();
  await newTopic(root, "Same", "<p>1</p>");
  await newTopic(root, "same", "<p>2</p>");
  await newTopic(root, "../../Escape: a/b", "<p>3</p>");
  await newTopic(root, "..", "<p>4</p>");
  let files = await fs.readdir(accountFolder(account));
  expect(files.length).toBe(8);
  expect(await fs.readdir(filesDir)).toEqual(["topics"]);

  await deleteFromDatabase(account);
  let read = await readAgain();
  expect(read.children.contents.map(topic => topic.name)).toEqual(["Same", "same", "../../Escape: a/b", ".."]);
});

test("A .md file made by another app is a topic", async () => {
  let account = await newAccount();
  await newTopic(root, "Ours");
  await fs.mkdir(path.join(accountFolder(account), "Ours"));
  await fs.writeFile(path.join(accountFolder(account), "Ours", "Their notes.md"), "# Heading\n\nSome *text*\n");
  let read = await readAgain();
  let theirs = read.children.first.children.first;
  expect(theirs.name).toBe("Their notes");
  expect((theirs.content.first as Paragraph).rawHTMLDangerous).toContain("<em>text</em>");

  await newTopic(theirs.parent, "Ours too");
  read = await readAgain();
  expect(read.children.first.children.contents.map(topic => topic.name)).toEqual(["Their notes", "Ours too"]);
});

test("A .md file that another app changed later wins", async () => {
  let account = await newAccount();
  let project = await newTopic(root, "Project", "<p>Old text</p>");
  project.properties.add({ name: "color", value: "blue" });
  await project.save();
  await writeLater(path.join(accountFolder(account), "Project.md"), "New *text*\n");
  let read = await readAgain();
  let readProject = read.children.find(topic => topic.id == project.id);
  expect((readProject.content.first as Paragraph).rawHTMLDangerous).toContain("<em>text</em>");
  expect(readProject.properties.contents).toEqual([{ name: "color", value: "blue" }]);

  // Now in the database
  account.saveAsLocalFiles = false;
  await account.save();
  read = await readAgain();
  expect((read.children.first.content.first as Paragraph).rawHTMLDangerous).toContain("<em>text</em>");
});

test("Files older than the database are not read, but written again", async () => {
  let account = await newAccount();
  await newTopic(root, "Project", "<p>Ours</p>");
  let file = path.join(accountFolder(account), "Project.md");
  await writeLater(file, "Theirs\n", -60000);
  let read = await readAgain();
  expect((read.children.first.content.first as Paragraph).rawHTMLDangerous).toContain("Ours");
  expect(await fs.readFile(file, "utf-8")).toContain("Ours");
});

test("A newer .jsonld file wins, if its dateModified is newer", async () => {
  let account = await newAccount();
  let project = await newTopic(root, "Project");
  let file = path.join(accountFolder(account), "Project.jsonld");
  let json = JSON.parse(await fs.readFile(file, "utf-8"));

  // e.g. an old copy from a file server
  json.name = "Old";
  json.dateModified = new Date(project.lastMod.getTime() - 60000).toISOString();
  await writeLater(file, JSON.stringify(json));
  let read = await readAgain();
  expect(read.children.first.name).toBe("Project");
  expect(JSON.parse(await fs.readFile(file, "utf-8")).name).toBe("Project");

  // e.g. from another device
  json.name = "New";
  json.dateModified = new Date(project.lastMod.getTime() + 60000).toISOString();
  await writeLater(file, JSON.stringify(json));
  read = await readAgain();
  expect(read.children.first.name).toBe("New");
});

test("Files only when the user wants them", async () => {
  let account = await newAccount(false);
  await newTopic(root, "Project", "<p>Text</p>");
  await expect(fs.access(accountFolder(account))).rejects.toThrow();

  account.saveAsLocalFiles = true;
  await account.save();
  await setContentStorage(account);
  expect(await fs.readFile(path.join(accountFolder(account), "Project.md"), "utf-8")).toContain("Text");
});

test("Links to emails etc. are in the .jsonld file", async () => {
  let account = await newAccount();
  let project = await newTopic(root, "Project");
  let person = new Person();
  person.name = "Fred Test";
  person.emailAddresses.add(new ContactEntry("fred@example.com"));
  await project.addLink(person);

  let json = JSON.parse(await fs.readFile(path.join(accountFolder(account), "Project.jsonld"), "utf-8"));
  expect(json.mentions[0]["@type"]).toBe("Person");
  expect(json.mentions[0]["@id"]).toBe("mailto:fred@example.com");

  let read = await readAgain();
  let link = read.children.first.links.first;
  expect(link.targetID).toBe("mailto:fred@example.com");
  expect(link.name).toBe("Fred Test");
  expect(link.topic).toBe(read.children.first);
  expect(appGlobal.topicLinks.contains(link)).toBe(true);
});
