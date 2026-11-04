import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { JMAPEMail } from "../../../../logic/Mail/JMAP/JMAPEMail";
import { getTagByName } from "../../../../logic/Abstract/Tag";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => null } as any;

function newEMail(): JMAPEMail {
  let account = new JMAPAccount();
  let folder = account.newFolder();
  folder.id = "a";
  return folder.newEMail();
}

/** `keywords` as in an `Email/get` response from Stalwart */
function update(email: JMAPEMail, keywords: Record<string, boolean>) {
  email.fromJMAP({ id: "eaaaaab", mailboxIds: { a: true }, keywords } as any);
}

test("A tag that was removed on another device is removed here", () => {
  let email = newEMail();
  update(email, { "$seen": true, "Work": true, "private": true });
  expect(email.tags.contents.map(tag => tag.name).sort()).toEqual(["Work", "private"]);

  update(email, { "$seen": true, "private": true });

  expect(email.tags.contents.map(tag => tag.name)).toEqual(["private"]);
});

test("A keyword that the server returns in lowercase is our tag with capitals", () => {
  let tag = getTagByName("ProjectX");
  let email = newEMail();

  update(email, { "projectx": true });

  expect(email.tags.contents).toEqual([tag]);
});

test("Junk keywords and system keywords are no tags", () => {
  let email = newEMail();

  update(email, { "$seen": true, "$flagged": true, "$junk": true, "junk": true, "NonJunk": true });

  expect(email.tags.isEmpty).toBe(true);
});
