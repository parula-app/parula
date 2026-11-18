import { ChatAccount } from '../ChatAccount';
import { XMPPAccount } from '../XMPP/XMPPAccount';
// #if [!WEBMAIL && PROPRIETARY]
import { GraphChatAccount } from '../Graph/GraphChatAccount';
// #endif
// #if [!WEBMAIL]
import { MatrixAccount } from '../Matrix/MatrixAccount';
import { WhatsAppAccount } from '../WhatsApp/WhatsAppAccount';
import { SignalAccount } from '../Signal/SignalAccount';
import { WireAccount } from '../Wire/WireAccount';
import { SQLChatStorage } from '../SQL/SQLChatStorage';
import { SQLSearchChat } from '../SQL/SQLSearchChat';
// #else
import { DummyChatStorage } from '../SQL/DummyChatStorage';
// #endif
import { SearchChat } from '../SearchChat';
import { NotReached } from '../../util/util';
import type { Collection } from 'svelte-collections';

export function newChatAccountForProtocol(protocol: string): ChatAccount {
  let acc = _newChatAccountForProtocol(protocol);
  // #if [!WEBMAIL]
  acc.storage = new SQLChatStorage();
  // #else
  acc.storage = new DummyChatStorage();
  // #endif
  return acc;
}

function _newChatAccountForProtocol(protocol: string): ChatAccount {
  if (protocol == "xmpp") {
    return new XMPPAccount() as any as ChatAccount;
  }
  // #if [!WEBMAIL]
  if (protocol == "matrix") {
    return new MatrixAccount() as any as ChatAccount;
  } else if (protocol == "whatsapp") {
    return new WhatsAppAccount() as any as ChatAccount;
  } else if (protocol == "signal") {
    return new SignalAccount() as any as ChatAccount;
  } else if (protocol == "wire") {
    return new WireAccount() as any as ChatAccount;
  } else if (protocol == "chat") {
    return new ChatAccount() as any as ChatAccount;
  }
  // #endif
  // #if [!WEBMAIL && PROPRIETARY]
  if (protocol == "chat-graph") {
    return new GraphChatAccount();
  }
  // #endif
  throw new NotReached(`Unsupported chat account type ${protocol}`);
}

// #if [!WEBMAIL]
export async function readChatAccounts(): Promise<Collection<ChatAccount>> {
  return await SQLChatStorage.readChatAccounts();
}
// #endif

export function newSearchChat(): SearchChat {
  // #if [!WEBMAIL]
  return new SQLSearchChat();
  // #else
  return new SearchChat();
  // #endif
}
