// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { SpecialFolder } from "../../../logic/Mail/Folder";
import { MessageActions } from "../../Mail/MessageActions";
import { expect, test } from "vitest";

/** What `treatSpam()` was called with */
let done: string[] = [];

// Plain objects with the properties that the junk actions use
function newMessage(subject: string, isSpam = false, specialFolder = SpecialFolder.Inbox): any {
  return {
    subject, isSpam,
    folder: { specialFolder },
    treatSpam: async (spam = true) => { done.push(`${subject} junk ${spam}`) },
  };
}

test("Junk toggles: Not Junk only if all messages are junk", async () => {
  let normal = newMessage("Normal");
  let junk = newMessage("Junk", true);
  let inJunkFolder = newMessage("In Junk folder", false, SpecialFolder.Spam);

  done = [];
  await MessageActions.toggleJunk([normal]);
  expect(done).toEqual(["Normal junk true"]);

  done = [];
  await MessageActions.toggleJunk([junk, inJunkFolder]);
  expect(done).toEqual(["Junk junk false", "In Junk folder junk false"]);

  done = [];
  await MessageActions.toggleJunk([junk, normal]);
  expect(done).toEqual(["Junk junk true", "Normal junk true"]);

  done = [];
  await MessageActions.toggleJunk([]);
  expect(done).toEqual([]);
});
