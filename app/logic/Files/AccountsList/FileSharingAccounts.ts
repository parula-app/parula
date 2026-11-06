import type { FileSharingAccount } from '../FileSharingAccount';
import { WebDAVAccount } from '../WebDAV/WebDAVAccount';
import { NextcloudAccount } from '../Nextcloud/NextcloudAccount';
import { OpenCloudAccount } from '../OpenCloud/OpenCloudAccount';
import { JMAPFileAccount } from '../JMAP/JMAPFileAccount';
// #if [!WEBMAIL]
import { myHarddrive } from '../Harddrive/HarddriveAccount';
import { SQLFileSharingAccount } from '../SQL/SQLFileSharingAccount';
// #endif
import { setStorage } from '../Store/setStorage';
import { NotReached } from '../../util/util';
import { ArrayColl, type Collection } from 'svelte-collections';

export function newFileSharingAccountForProtocol(protocol: string): FileSharingAccount {
  let account = _newFileSharingAccountForProtocol(protocol);
  setStorage(account);
  account.errorCallback = console.error;
  return account;
}

function _newFileSharingAccountForProtocol(protocol: string): FileSharingAccount {
  if (protocol == "webdav-nextcloud") {
    return new NextcloudAccount();
  } else if (protocol == "webdav-opencloud") {
    return new OpenCloudAccount();
  } else if (protocol == "webdav") {
    return new WebDAVAccount();
  } else if (protocol == "files-jmap") {
    return new JMAPFileAccount();
  }
  throw new NotReached(`Unknown file sharing account type ${protocol}`);
}

export async function readFileSharingAccounts(): Promise<Collection<FileSharingAccount>> {
  let accounts = new ArrayColl<FileSharingAccount>();
  // #if [!WEBMAIL]
  accounts.add(myHarddrive);
  accounts.addAll(await SQLFileSharingAccount.readAll());
  // #endif
  return accounts;
}
