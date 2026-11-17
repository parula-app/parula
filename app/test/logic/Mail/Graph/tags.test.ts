// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { GraphAccount } from "../../../../logic/Mail/Graph/GraphAccount";
import { GraphFolder } from "../../../../logic/Mail/Graph/GraphFolder";
import { GraphEMail } from "../../../../logic/Mail/Graph/GraphEMail";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => null } as any;

function newEMail(): GraphEMail {
  let folder = new GraphFolder(new GraphAccount());
  folder.id = "inbox-1";
  return new GraphEMail(folder);
}

/** `categories` as in a `message` from the delta query */
function update(email: GraphEMail, categories: string[]) {
  email.setFlagsLocal({ id: "msg-1", isRead: true, categories } as any);
}

test("The categories of a message become its tags", () => {
  let email = newEMail();

  update(email, ["Work", "Private"]);

  expect(email.tags.contents.map(tag => tag.name).sort()).toEqual(["Private", "Work"]);
});

test("A category that was removed on another device is removed here", () => {
  let email = newEMail();
  update(email, ["Work", "Private"]);

  update(email, ["Private"]);

  expect(email.tags.contents.map(tag => tag.name)).toEqual(["Private"]);
});

test("A message without categories in the response keeps its tags", () => {
  let email = newEMail();
  update(email, ["Work"]);

  email.setFlagsLocal({ id: "msg-1", isRead: true } as any);

  expect(email.tags.contents.map(tag => tag.name)).toEqual(["Work"]);
});
