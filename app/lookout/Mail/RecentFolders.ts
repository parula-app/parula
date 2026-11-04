import type { Folder } from "../../logic/Mail/Folder";
import type { MailAccount } from "../../logic/Mail/MailAccount";
import { getLocalStorage } from "../../frontend/Util/LocalStorage";

export interface RecentFolderRef {
  accountID: string;
  folderID: string;
}

export class RecentFolders {
  protected readonly setting: { value: RecentFolderRef[] };

  constructor(setting: { value: RecentFolderRef[] } = getLocalStorage<RecentFolderRef[]>("lookout.mail.recentFolders", [])) {
    this.setting = setting;
  }

  add(folder: Folder) {
    const kMaxFolders = 10;
    let accountID = folder.account?.id;
    if (!accountID || !folder.id) {
      return;
    }
    let refs = (this.setting.value ?? []).filter(ref =>
      !(ref.accountID == accountID && ref.folderID == folder.id));
    refs.unshift({ accountID, folderID: folder.id });
    this.setting.value = refs.slice(0, kMaxFolders);
  }

  folders(accounts: Iterable<MailAccount>): Folder[] {
    let accountsByID = new Map<string, MailAccount>();
    for (let account of accounts) {
      accountsByID.set(account.id, account);
    }
    let folders: Folder[] = [];
    for (let ref of this.setting.value ?? []) {
      let folder = accountsByID.get(ref.accountID)?.findFolder(candidate => candidate.id == ref.folderID);
      if (folder) {
        folders.push(folder);
      }
    }
    return folders;
  }
}

export const recentFolders = new RecentFolders();
