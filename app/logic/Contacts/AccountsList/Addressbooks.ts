import { Addressbook } from '../Addressbook';
import { AddonAddressbook } from '../Addon/AddonAddressbook';
// #if [!WEBMAIL || WEBMAIL=JMAP]
import { JMAPAddressbook } from '../JMAP/JMAPAddressbook';
// #endif
// #if [!WEBMAIL && PROPRIETARY]
import { EWSAddressbook } from '../EWS/EWSAddressbook';
import { OWAAddressbook } from '../OWA/OWAAddressbook';
import { ActiveSyncAddressbook } from '../ActiveSync/ActiveSyncAddressbook';
// #endif
// #if [!WEBMAIL]
import { CardDAVAddressbook } from '../CardDAV/CardDAVAddressbook';
import { SQLAddressbookStorage } from '../SQL/SQLAddressbookStorage';
// #else
import { DummyAddressbookStorage } from '../SQL/DummyAddressbookStorage';
// #endif
import { NotReached } from '../../util/util';
import type { Collection } from 'svelte-collections';
import { gt } from '../../../l10n/l10n';

export function newAddressbookForProtocol(protocol: string): Addressbook {
  let ab = _newAddressbookForProtocol(protocol);
  // #if [!WEBMAIL]
  ab.storage = new SQLAddressbookStorage();
   // #else
  ab.storage = new DummyAddressbookStorage();
  // #endif
  return ab;
}

function _newAddressbookForProtocol(protocol: string): Addressbook {
  if (protocol.startsWith("addon-")) {
    return new AddonAddressbook(protocol);
  }
  if (protocol == "addressbook-local") {
    return new Addressbook();
  }
  // #if [!WEBMAIL || WEBMAIL=JMAP]
  if (protocol == "addressbook-jmap") {
    return new JMAPAddressbook();
  }
  // #endif
  // #if [!WEBMAIL]
  if (protocol == "carddav") {
    return new CardDAVAddressbook();
  }
  // #endif
  // #if [(!WEBMAIL || WEBMAIL=EWS) && PROPRIETARY]
  if (protocol == "addressbook-ews") {
    return new EWSAddressbook();
  }
  // #endif
  // #if [!WEBMAIL && PROPRIETARY]
  if (protocol == "addressbook-owa") {
    return new OWAAddressbook();
  } else if (protocol == "addressbook-activesync") {
    return new ActiveSyncAddressbook();
  }
  // #endif
  throw new NotReached(`Unknown addressbook type ${protocol}`);
}

// #if [!WEBMAIL]
export async function readAddressbooks(): Promise<Collection<Addressbook>> {
  let addressbooks = await SQLAddressbookStorage.readAddressbooks();
  if (addressbooks.isEmpty) {
    addressbooks.add(await createPersonalAddressbook());
    addressbooks.add(await createCollectedAddressbook());
  }
  return addressbooks;
}
// #endif

export async function createPersonalAddressbook(): Promise<Addressbook> {
  console.log("Creating personal address book");
  let personal = newAddressbookForProtocol("addressbook-local");
  personal.name = gt`Personal addressbook`;
  await personal.save();
  return personal;
}

export async function createCollectedAddressbook(): Promise<Addressbook> {
  let collected = newAddressbookForProtocol("addressbook-local");
  collected.name = gt`Collected contacts`;
  await collected.save();
  return collected;
}
