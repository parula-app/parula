// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { Folder, SpecialFolder } from "../../../../logic/Mail/Folder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";

export class RulesTestAccount {
  static create(name: string, folderNames: string[]): MailAccount {
    appGlobal.remoteApp = {} as any;
    let account = new MailAccount();
    account.name = name;
    account.emailAddress = `${name}@example.com`;
    account.storage = new DummyMailStorage();
    for (let folderName of folderNames) {
      let folder = new Folder(account);
      folder.name = folderName;
      folder.id = `${name}-${folderName}`;
      if (folderName == "Inbox") {
        folder.specialFolder = SpecialFolder.Inbox;
      }
      account.rootFolders.add(folder);
    }
    return account;
  }

  static folder(account: MailAccount, name: string): Folder {
    return account.findFolder(folder => folder.name == name);
  }
}
