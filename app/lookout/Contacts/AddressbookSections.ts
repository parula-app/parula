import type { Account } from "../../logic/Abstract/Account";
import type { Addressbook } from "../../logic/Contacts/Addressbook";

export class AddressbookSection {
  readonly mainAccount: Account | null;
  readonly addressbooks: Addressbook[] = [];

  constructor(mainAccount: Account | null) {
    this.mainAccount = mainAccount;
  }
}

export class AddressbookSections {
  readonly sections: AddressbookSection[];

  constructor(addressbooks: Iterable<Addressbook>) {
    let standalone = new AddressbookSection(null);
    let byAccount = new Map<Account, AddressbookSection>();
    for (let addressbook of addressbooks) {
      let mainAccount = addressbook.mainAccount;
      if (!mainAccount) {
        standalone.addressbooks.push(addressbook);
        continue;
      }
      let section = byAccount.get(mainAccount);
      if (!section) {
        section = new AddressbookSection(mainAccount);
        byAccount.set(mainAccount, section);
      }
      section.addressbooks.push(addressbook);
    }
    this.sections = [standalone, ...byAccount.values()]
      .filter(section => section.addressbooks.length > 0);
  }
}
