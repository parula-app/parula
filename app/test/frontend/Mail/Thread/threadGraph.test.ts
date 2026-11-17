// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { Folder, SpecialFolder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { findOrCreatePersonUID } from "../../../../logic/Abstract/PersonUID";
import { ThreadNode } from "../../../../frontend/Mail/Thread/ThreadNode";
import { computeLayout, type NodeLayout } from "../../../../frontend/Mail/Thread/GraphLayout";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

function newTestFolder(): Folder {
  appGlobal.remoteApp = {} as any;
  let account = new MailAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.storage = new DummyMailStorage();
  let folder = new Folder(account);
  folder.name = "INBOX";
  folder.id = "INBOX";
  folder.specialFolder = SpecialFolder.Inbox;
  account.rootFolders.add(folder);
  return folder;
}

/** @param minute Later msgs have a higher minute */
function newTestMail(folder: Folder, messageID: string, inReplyTo: string | null, minute: number, from = "alice@example.com"): EMail {
  let email = folder.newEMail();
  email.messageID = messageID;
  email.inReplyTo = inReplyTo;
  email.subject = "Decision";
  email.sent = new Date(2026, 8, 1, 12, minute);
  email.received = email.sent;
  email.from = findOrCreatePersonUID(from, from.split("@")[0]);
  email.contact = email.from;
  email.isRead = true;
  folder.messages.add(email);
  return email;
}

test("builds the reply tree from In-Reply-To", () => {
  let folder = newTestFolder();
  let start = newTestMail(folder, "1@example.com", null, 0);
  let firstReply = newTestMail(folder, "2@example.com", "1@example.com", 1);
  let secondReply = newTestMail(folder, "3@example.com", "1@example.com", 2);
  let deepReply = newTestMail(folder, "4@example.com", "2@example.com", 3);

  // deliberately out of order, to check the sorting by date
  let nodes = ThreadNode.buildTree(new ArrayColl([deepReply, secondReply, start, firstReply]), null);

  expect(nodes.map(node => node.message)).toEqual([start, firstReply, secondReply, deepReply]);
  let root = nodes[0];
  expect(root.message).toBe(start);
  expect(root.children.contents.map((node: any) => node.message)).toEqual([firstReply, secondReply]);
  expect(nodes[1].children.contents.map((node: any) => node.message)).toEqual([deepReply]);
});

test("shows msgs whose parent we don't have as replies to the thread starter", () => {
  let folder = newTestFolder();
  let start = newTestMail(folder, "1@example.com", null, 0);
  let orphan = newTestMail(folder, "2@example.com", "never-downloaded@example.com", 1);

  let nodes = ThreadNode.buildTree(new ArrayColl([start, orphan]), null);

  expect(nodes[0].message).toBe(start);
  expect(nodes[0].children.contents.map((node: any) => node.message)).toEqual([orphan]);
});

test("msgs that name each other in In-Reply-To do not form a cycle", () => {
  let folder = newTestFolder();
  let first = newTestMail(folder, "1@example.com", "2@example.com", 0);
  let second = newTestMail(folder, "2@example.com", "1@example.com", 1);

  let nodes = ThreadNode.buildTree(new ArrayColl([first, second]), null);

  expect(nodes[0].message).toBe(first);
  expect(nodes[0].children.contents.map((node: any) => node.message)).toEqual([second]);
  expect(nodes[1].children.isEmpty).toBe(true);
  expect(countMessages(computeLayout(nodes[0]).positions)).toBe(2);
});

test("unread msgs are marked, and the msg being read is focused", () => {
  let folder = newTestFolder();
  let start = newTestMail(folder, "1@example.com", null, 0);
  let reply = newTestMail(folder, "2@example.com", "1@example.com", 1);
  reply.isRead = false;
  reply.isStarred = true;

  let nodes = ThreadNode.buildTree(new ArrayColl([start, reply]), start);

  expect(nodes[0].isFocus).toBe(true);
  expect(nodes[0].isBold).toBe(false);
  expect(nodes[1].isFocus).toBe(false);
  expect(nodes[1].isBold).toBe(true);
  expect(nodes[1].isStarred).toBe(true);
  expect(nodes[1].name).toContain("unread");
  // The color identifies the person, so 2 msgs from the same person look the same
  expect(nodes[0].color).toBe(nodes[1].color);
});

test("the last reply continues below its parent, the others are indented", () => {
  let folder = newTestFolder();
  let start = newTestMail(folder, "1@example.com", null, 0);
  newTestMail(folder, "2@example.com", "1@example.com", 1);
  newTestMail(folder, "3@example.com", "1@example.com", 2);

  let nodes = ThreadNode.buildTree(folder.messages, null);
  let { positions } = computeLayout(nodes[0]);

  expect(positions.map(p => [p.col, p.row])).toEqual([[0, 0], [1, 1], [0, 2]]);
  expect(positions[0].node.message).toBe(start);
});

test("every msg gets a spot of its own, however the thread branches", () => {
  let folder = newTestFolder();
  newTestMail(folder, "1@example.com", null, 0);
  // Each msg gets 3 replies, 5 levels deep
  let parents = ["1@example.com"];
  for (let level = 0; level < 5; level++) {
    let children: string[] = [];
    for (let parent of parents) {
      for (let i = 0; i < 3; i++) {
        let messageID = `${parent}-${i}@example.com`;
        newTestMail(folder, messageID, parent, folder.messages.length);
        children.push(messageID);
      }
    }
    parents = children;
  }

  let nodes = ThreadNode.buildTree(folder.messages, null);
  let { positions, width } = computeLayout(nodes[0]);

  let spots = new Set(positions.map(p => p.col + "," + p.row));
  expect(spots.size).toBe(positions.length);
  // Deeply nested replies are folded into a "+20", so that the bar stays narrow
  expect(countMessages(positions)).toBe(folder.messages.length);
  expect(positions.length).toBeLessThan(folder.messages.length);
  expect(Math.max(...positions.map(p => p.col))).toBe(3);
  expect(width).toBeLessThan(200);
});

test("on mobile, the discussion runs to the right and replies are indented downwards", () => {
  let folder = newTestFolder();
  newTestMail(folder, "1@example.com", null, 0);
  newTestMail(folder, "2@example.com", "1@example.com", 1);
  newTestMail(folder, "3@example.com", "1@example.com", 2);

  let nodes = ThreadNode.buildTree(folder.messages, null);
  let vertical = computeLayout(nodes[0], false);
  let horizontal = computeLayout(nodes[0], true);

  expect(horizontal.width).toBe(vertical.height);
  expect(horizontal.height).toBe(vertical.width);
  expect(horizontal.positions.map(p => [p.x, p.y]))
    .toEqual(vertical.positions.map(p => [p.y, p.x]));
});

/** Msgs shown in the graph, plus those folded into a "+20" */
function countMessages(positions: NodeLayout[]): number {
  return positions.length + positions.reduce((sum, p) => sum + p.hiddenReplies, 0);
}
