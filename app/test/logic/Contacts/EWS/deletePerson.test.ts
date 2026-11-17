import { EWSAddressbook } from "../../../../logic/Contacts/EWS/EWSAddressbook";
import { expect, test } from "vitest";

const kItemID = "contact-1";

/** Remembers the `DeleteItem` request */
class TestEWSAccount {
  deleteItem: any;

  async callEWS(request: any): Promise<any> {
    this.deleteItem = request.m$DeleteItem;
    return {};
  }
}

test("Deleting a contact does not move it to the trash folder of the mail", async () => {
  let addressbook = new EWSAddressbook();
  let account = new TestEWSAccount();
  addressbook.mainAccount = account as any;
  let person = addressbook.newPerson();
  person.itemID = kItemID;

  await person.deleteFromServer();

  expect(account.deleteItem.m$ItemIds.t$ItemId.Id).toBe(kItemID);
  expect(account.deleteItem.DeleteType).toBe("HardDelete");
});
