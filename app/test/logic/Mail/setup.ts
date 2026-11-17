import { kMailAccounts } from './logins';
import { MailAccount } from '../../../logic/Mail/MailAccount';
import { newAccountForProtocol } from '../../../logic/Mail/AccountsList/MailAccounts';
import { Account, AuthMethod } from '../../../logic/Abstract/Account';
import { TLSSocketType } from '../../../logic/Abstract/TCPAccount';
import { OAuth2 } from '../../../logic/Auth/OAuth2';
import { OAuth2URLs } from '../../../logic/Auth/OAuth2URLs';
import { DummyMailStorage } from '../../../logic/Mail/Store/DummyMailStorage';
import { kStandardPorts } from '../../../logic/Mail/AutoConfig/configInfo';
import { getDomainForEmailAddress } from '../../../logic/util/netUtil';
import { assert } from '../../../logic/util/util';
import { MailIdentity } from '../../../logic/Mail/MailIdentity';

export async function setupTestMailAccount(config: typeof kMailAccounts[0]): Promise<MailAccount> {
  console.log("Using account", config.username, config.hostname);
  let acc = newAccountForProtocol(config.protocol);
  acc.username = config.username;
  acc.password = config.password;
  acc.name = config.username;
  acc.emailAddress = config.username;
  acc.realname = config.username.replace("@.*", "");
  let domain = getDomainForEmailAddress(acc.username);
  acc.hostname = config.hostname ?? (config.url ? new URL(config.url).hostname : "imap." + domain);
  acc.port = kStandardPorts.find(p => p.protocol == config.protocol && p.tls == TLSSocketType.TLS)?.port ?? 443;
  acc.url = config.url ?? "https://example.com";
  acc.tls = TLSSocketType.TLS;
  acc.authMethod = config.authMethod ?? AuthMethod.Password;
  if (acc.authMethod == AuthMethod.OAuth2) {
    let urls = OAuth2URLs.find(o => o.hostnames.includes(acc.hostname ?? "") || o.domains.includes(domain));
    assert(urls, "Need OAuth2 config");
    acc.oAuth2 = new OAuth2(acc as any as Account, urls.tokenURL, urls.authURL, urls.authDoneURL, urls.scope, urls.clientID, urls.clientSecret, urls.doPKCE);
    if (config.accessToken) {
      acc.oAuth2.accessToken = config.accessToken;
    }
  }
  acc.storage = new DummyMailStorage();
  acc.contentStorage.clear();
  let identity = new MailIdentity(acc);
  identity.emailAddress = acc.emailAddress;
  identity.realname = acc.realname;
  acc.identities.add(identity);

  await acc.loginAndStartup(false);
  assert(acc.inbox, "Inbox not found");
  return acc;
}
