import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import type { EWSEMail } from "../../../../logic/Mail/EWS/EWSEMail";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { InvitationMessage } from "../../../../logic/Calendar/Invitation/InvitationStatus";
import { expect, test } from "vitest";

const kItemID = "item-1";

/** An Exchange server that refuses to delete a calendar resp. task item,
 * unless the request says what to do about the attendees resp. the occurrences */
class TestEWSAccount extends EWSAccount {
  /** The attributes of the last `DeleteItem` call */
  deleteAttributes: Record<string, string | boolean>;

  async callEWS(request: any): Promise<any> {
    let deleteItem = request.m$DeleteItem;
    if (!deleteItem) {
      throw new Error("Unexpected EWS call " + JSON.stringify(request));
    }
    if (!deleteItem.SendMeetingCancellations) {
      throw new Error("SendMeetingCancellations attribute is required for Calendar items.");
    }
    if (!deleteItem.AffectedTaskOccurrences) {
      throw new Error("AffectedTaskOccurrences attribute is required for Task items.");
    }
    this.deleteAttributes = deleteItem;
    return {};
  }
}

/** An appointment that ended up in the trash folder of the mail.
 * It is not an invitation mail: it has no sender - the UI shows "unknown" -
 * and its item class is the one of a plain calendar item. */
function calendarItemInTrash(): EWSEMail {
  let account = new TestEWSAccount();
  let trash = account.newFolder();
  trash.id = "trash-1";
  trash.specialFolder = SpecialFolder.Trash;
  let email = trash.newEMail();
  email.fromXML({
    ItemId: { Id: kItemID },
    ItemClass: "IPM.Appointment",
    Subject: "new ntml test",
  });
  return email;
}

test("Delete a calendar item that lies in the mail trash folder", async () => {
  let email = calendarItemInTrash();
  expect(email.invitationMessage).toBe(InvitationMessage.None); // not a meeting mail

  await email.deleteMessageOnServer();

  let account = email.folder.account as TestEWSAccount;
  expect(account.deleteAttributes.DeleteType).toBe("HardDelete"); // it is already in the trash
  expect(email.folder.deletions.has(kItemID)).toBe(false);
});
