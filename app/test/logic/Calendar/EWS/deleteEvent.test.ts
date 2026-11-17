import { EWSCalendar } from "../../../../logic/Calendar/EWS/EWSCalendar";
import { expect, test } from "vitest";

const kItemID = "event-1";

/** Remembers the `DeleteItem` request */
class TestEWSAccount {
  deleteItem: any;

  async callEWS(request: any): Promise<any> {
    this.deleteItem = request.m$DeleteItem;
    return {};
  }
}

test("Deleting an event does not move it to the trash folder of the mail", async () => {
  let calendar = new EWSCalendar();
  let account = new TestEWSAccount();
  calendar.mainAccount = account as any;
  let event = calendar.newEvent();
  event.itemID = kItemID;

  await event.deleteFromServer();

  expect(account.deleteItem.m$ItemIds.t$ItemId.Id).toBe(kItemID);
  expect(account.deleteItem.DeleteType).toBe("HardDelete");
  expect(account.deleteItem.SendMeetingCancellations).toBe("SendToAllAndSaveCopy");
});
