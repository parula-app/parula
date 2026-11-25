// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import type { OWAFolder } from "../../../../logic/Mail/OWA/OWAFolder";
import { Attachment } from "../../../../logic/Abstract/Attachment";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { expect, test } from "vitest";

/** An Exchange server. With attachments, `send()` first creates the email in Drafts
 * (`CreateItem` `SaveOnly`), adds the attachments, and then sends it (`UpdateItem` `SendAndSaveCopy`).
 * @param refuseSend The server refuses to send the email, e.g. because it is too large */
class TestOWAAccount extends OWAAccount {
  inDrafts = new Set<string>();
  refuseSend = false;

  async callOWA(request: any): Promise<any> {
    let body = request.Body;
    if (request.action == "CreateItem") {
      expect(body.MessageDisposition).toBe("SaveOnly");
      this.inDrafts.add("draft-1");
      return { ResponseClass: "Success", Items: [{ ItemId: { Id: "draft-1" } }] };
    }
    if (request.action == "CreateAttachment") {
      return { ResponseClass: "Success", Attachments: [{ AttachmentId: { Id: "att-1" } }] };
    }
    if (request.action == "UpdateItem") {
      if (this.refuseSend) {
        throw new Error("The message exceeds the maximum supported size.");
      }
      this.inDrafts.delete(body.ItemChanges?.[0]?.ItemId?.Id ?? "draft-1");
      return { ResponseClass: "Success" };
    }
    if (request.action == "DeleteItem") {
      this.inDrafts.delete(body.ItemIds[0].Id);
      return { ResponseClass: "Success" };
    }
    throw new Error("Unexpected OWA call " + request.action);
  }
}

function setUp(refuseSend: boolean) {
  appGlobal.remoteApp ??= { OWA: {} } as any;
  let account = new TestOWAAccount();
  account.username = "alice@example.com";
  account.emailAddress = account.username;
  account.refuseSend = refuseSend;
  let sent = account.newFolder() as OWAFolder;
  sent.id = "sent-1";
  account.rootFolders.add(sent);
  let email = sent.newEMail();
  email.folder = sent;
  email.from = new PersonUID("alice@example.com", "Alice");
  email.to.add(new PersonUID("bob@example.com", "Bob"));
  email.subject = "Report";
  email.text = "The report";
  let attachment = new Attachment();
  attachment.filename = "report.txt";
  attachment.mimeType = "text/plain";
  attachment.content = new File(["The numbers"], "report.txt", { type: "text/plain" });
  email.attachments.add(attachment);
  return { account, email };
}

test("A send that the server refuses leaves no extra copy in Drafts", async () => {
  let { account, email } = setUp(true);

  await expect(account.send(email)).rejects.toThrow("maximum supported size");

  expect(account.inDrafts.size).toBe(0);
});

test("A successful send with attachments leaves no copy in Drafts", async () => {
  let { account, email } = setUp(false);

  await account.send(email);

  expect(account.inDrafts.size).toBe(0);
});
