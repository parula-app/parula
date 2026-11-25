import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { appGlobal } from "../../app";
import { getConfigDir } from "../../util/backend-wrapper";
import { assert } from "../../util/util";
import type { MailAccount } from "../MailAccount";
import { readConfigFromXML } from "./readConfig";
import { SetupInfo, type SetupInstruction } from "./SetupInfo";
import type { ArrayColl } from "svelte-collections";

/** Hardcoded, or on the hardisk in the user directory */
export async function localConfig(domain: string): Promise<ArrayColl<MailAccount>> {
  try {
    return builtinConfig(domain);
  } catch (ex) {
  }
  try {
    return await harddiskConfig(domain);
  } catch (ex) {
    throw new Error("Expected: No local config found");
  }
}

/** Hardcoded configs in the `kBuiltinConfigs` array below */
export function builtinConfig(domain: string): ArrayColl<MailAccount> {
  let local = kBuiltinConfigs.find(c => c.domains.includes(domain));
  assert(local, "Expected: No built-in config found");
  let configs = readConfigFromXML(local.xml, domain, "builtin");
  for (let config of configs) {
    config.setup ??= new SetupInfo();
    config.setup.instructions = local.instructions;
  }
  return configs;
}

const kBuiltinConfigs = [
  {
    // ISPDB has only password auth, but iCloud now supports OAuth2 for IMAP and SMTP
    domains: ["icloud.com", "me.com", "mac.com"],
    xml: `<clientConfig version="1.1">
  <emailProvider id="me.com">
    <domain>icloud.com</domain>
    <domain>me.com</domain>
    <domain>mac.com</domain>
    <displayName>Apple iCloud</displayName>
    <displayShortName>iCloud</displayShortName>
    <incomingServer type="imap">
      <hostname>imap.mail.me.com</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
      <username>%EMAILADDRESS%</username>
      <authentication>OAuth2</authentication>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>smtp.mail.me.com</hostname>
      <port>587</port>
      <socketType>STARTTLS</socketType>
      <username>%EMAILADDRESS%</username>
      <authentication>OAuth2</authentication>
    </outgoingServer>
  </emailProvider>
</clientConfig>
`,
    instructions: null as SetupInstruction[] | null,
  },
];

/**
 * Configs on the local local disk (optional, for admin testing)
 * - Linux: /home/USER/.mustang/isp/<emaildomain>.xml
 * - Windows: C:\Users\USER\AppData\Mustang\isp\<emaildomain>.xml
 * - Mac OS: /Users/USER/Library/Application Support/Mustang/isp/<emaildomain>.xml
 * (Or Parula or MustangDev instead of Mustang, of course)
 */
export async function harddiskConfig(domain: string): Promise<ArrayColl<MailAccount>> {
  if (appGlobal.isMobile) {
    throw new Error("Expected: No local config on mobile devices");
  }

  try {
    let filename = `${await getConfigDir()}/isp/${sanitize.filename(domain)}.xml`;
    console.log("checking file", filename);
    let arrayBuffer = await appGlobal.remoteApp.readFile(filename);
    let string = new TextDecoder().decode(arrayBuffer);
    return readConfigFromXML(string, domain, "harddisk");
  } catch (ex) {
    throw new Error("Expected: No config on local disk found");
  }
}
