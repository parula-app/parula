import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { JMAPFolder } from "../../../../logic/Mail/JMAP/JMAPFolder";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { CreateMIME } from "../../../../logic/Mail/SMTP/CreateMIME";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import type { TJMAPMethodResponse, TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

/** Like `getMIMENodemailer()` in the backends: nodemailer leaves out the Bcc header, unless told to keep it */
appGlobal.remoteApp = {
  kyCreate: () => { throw new Error("The test should not talk to a real server") },
  getMIMENodemailer: async (mail: any, keepBcc = false) => {
    let lines = [`From: ${mail.from.address}`, `To: ${mail.to.map(to => to.address).join(", ")}`];
    if (keepBcc && mail.bcc?.length) {
      lines.push(`Bcc: ${mail.bcc.map(bcc => bcc.address).join(", ")}`);
    }
    return new TextEncoder().encode(lines.join("\r\n") + "\r\n\r\n" + mail.text + "\r\n");
  },
} as any;

function newDraft() {
  let account = new JMAPAccount();
  account.accountID = "e";
  account.emailAddress = "mail-alice@example.com";
  account.session = { capabilities: {}, accounts: {}, primaryAccounts: {} } as any as TJMAPSession;
  let uploaded: string[] = [];
  account.uploadBlob = async (blob: Buffer) => {
    uploaded.push(blob.toString());
    return { accountId: "e", blobId: "blob1", type: "message/rfc822", size: blob.length };
  };
  // Recorded from Stalwart
  account.makeCalls = async (requests: [string, Record<string, any>, string?][]) => [
    ["Email/import", { accountId: "e", oldState: "spi", newState: "spm", created: { addMessage: { id: "eaaaaab", blobId: "blob1", threadId: "b", size: 120 } } }, requests[0][2]],
  ] as TJMAPMethodResponse[];
  let drafts = account.newFolder() as JMAPFolder;
  drafts.id = "d";
  drafts.specialFolder = SpecialFolder.Drafts;
  (drafts as any).listChangedMessages = async () => new ArrayColl();
  account.rootFolders.add(drafts);
  let email = account.newEMailFrom();
  email.to.add(new PersonUID("mail-bob@example.com", "Bob"));
  email.bcc.add(new PersonUID("secret@example.com", "Secret"));
  email.text = "Hi";
  return { drafts, email, uploaded };
}

test("A saved draft keeps its Bcc recipients", async () => {
  let { drafts, email, uploaded } = newDraft();

  await drafts.addMessage(email);

  expect(uploaded.length).toBe(1);
  expect(uploaded[0]).toMatch(/^Bcc:.*secret@example\.com/m);
});

test("The MIME that is sent or encrypted has no Bcc header", async () => {
  let { email } = newDraft();

  let mime = new TextDecoder().decode(await CreateMIME.getMIME(email));

  expect(mime).not.toMatch(/^Bcc:/m);
});
