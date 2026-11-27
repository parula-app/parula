import { MailAccount } from '../MailAccount';
// #if [!WEBMAIL || WEBMAIL=JMAP]
import { JMAPAccount } from '../JMAP/JMAPAccount';
// #endif
// #if [(!WEBMAIL || WEBMAIL=EWS) && PROPRIETARY]
import { EWSAccount } from '../EWS/EWSAccount';
// #endif
// #if [!WEBMAIL]
import { IMAPAccount } from '../IMAP/IMAPAccount';
import { POP3Account } from '../POP3/POP3Account';
import { SMTPAccount } from '../SMTP/SMTPAccount';
import { SQLMailStorage } from '../SQL/SQLMailStorage';
// #endif
// #if [!WEBMAIL && PROPRIETARY]
import { OWAAccount } from '../OWA/OWAAccount';
import { ActiveSyncAccount } from '../ActiveSync/ActiveSyncAccount';
import { GraphAccount } from '../Graph/GraphAccount';
// #endif
import { AddonMailAccount } from '../Addon/AddonMailAccount';
import { AddonProtocol, addonProtocols } from '../../Addons/AddonProtocols';
import { appGlobal } from '../../app';
import { setStorage } from '../Store/setStorage';
import { dataProcessorsHookup } from '../SML/DataProcessors';
import { encryptionProcessorsHookup } from '../Encryption/Processors';
import { NotReached, NotSupported } from '../../util/util';
import { gt } from '../../../l10n/l10n';
import type { Collection } from 'svelte-collections';

export function newAccountForProtocol(protocol: string): MailAccount {
  let acc = _newAccountForProtocol(protocol);
  setStorage(acc);
  return acc;
}

function _newAccountForProtocol(protocol: string): MailAccount {
  if (protocol.startsWith("addon-")) {
    return new AddonMailAccount(protocol);
  }
  // #if [!WEBMAIL || WEBMAIL=JMAP]
  if (protocol == "jmap") {
    return new JMAPAccount();
  }
  // #endif
  // #if [(!WEBMAIL || WEBMAIL=EWS) && PROPRIETARY]
  if (protocol == "ews") {
    return new EWSAccount();
  }
  // #endif
  // #if [!WEBMAIL]
  if (protocol == "imap") {
    return new IMAPAccount();
  } else if (protocol == "pop3") {
    return new POP3Account();
  } else if (protocol == "smtp") {
    return new SMTPAccount();
  }
  // #endif
  // #if [!WEBMAIL && PROPRIETARY]
  if (protocol == "owa") {
    if (/*appGlobal.isMobile*/ false) {
      throw new NotSupported("OWA is not supported on mobile");
    }
    return new OWAAccount();
  } else if (protocol == "activesync") {
    return new ActiveSyncAccount();
  } else if (protocol == "graph") {
    return new GraphAccount();
  }
  // #endif
  if (protocol == "mail") {
    return new MailAccount();
  }
  throw new NotReached(`Unknown account type ${protocol}`);
  // #endif
}

// #if [!WEBMAIL]
export async function readMailAccounts(): Promise<Collection<MailAccount>> {
  return await SQLMailStorage.readMailAccounts();
}
// #endif

const kProtocolLabel: Record<string, string> = {
  // Displayed to user, but do not translate (technical term)
  "imap": "IMAP",
  "pop3": "POP3",
  "smtp": "SMTP",
  "ews": "EWS",
  "owa": "OWA",
  "activesync": "ActiveSync",
  "graph": "MS Graph (beta)",
  "jmap": "JMAP (alpha)",
}

/** Including the mail protocols of running addons */
export function listMailProtocols(): string[] {
  return Object.keys(kProtocolLabel).filter(p => p != "smtp" &&
    (/*!appGlobal.isMobile*/ true || p != "owa"))
    .concat(addonProtocols.contents.filter(protocol => protocol.type == "mail").map(protocol => protocol.protocol));
}

export function labelForMailProtocol(protocol: string): string {
  if (protocol.startsWith("addon-")) {
    for (let addon of appGlobal.addons.installed) {
      let contribution = addon.manifest.protocols.find(contribution =>
        AddonProtocol.accountProtocol(addon.id, contribution.id) == protocol);
      if (contribution) {
        return contribution.label;
      }
    }
    return gt`Addon`;
  }
  return kProtocolLabel[protocol] ?? protocol.toUpperCase();
}

// TODO Find better spot to call this
dataProcessorsHookup();
encryptionProcessorsHookup();
