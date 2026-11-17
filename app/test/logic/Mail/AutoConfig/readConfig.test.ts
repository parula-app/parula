// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app"; // defeats circular import
import { readConfigFromXML } from "../../../../logic/Mail/AutoConfig/readConfig";
import { errorsForServer } from "../../../../logic/util/error";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

beforeAll(() => {
  // There is no backend process here, but `IMAPAccount` needs it
  appGlobal.remoteApp ??= { createIMAPFlowConnection: () => null };
});

afterEach(() => {
  errorsForServer.clear();
  vi.restoreAllMocks();
});

/** The first <outgoingServer> has an invalid port */
const kConfigXML = `<?xml version="1.0"?>
<clientConfig version="1.1">
  <emailProvider id="example.com">
    <domain>example.com</domain>
    <displayName>Example Mail</displayName>
    <incomingServer type="imap">
      <hostname>imap.example.com</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
      <username>%EMAILADDRESS%</username>
      <authentication>password-cleartext</authentication>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>broken.example.com</hostname>
      <port>99999</port>
      <socketType>SSL</socketType>
      <username>%EMAILADDRESS%</username>
      <authentication>password-cleartext</authentication>
    </outgoingServer>
    <outgoingServer type="smtp">
      <hostname>smtp.example.com</hostname>
      <port>465</port>
      <socketType>SSL</socketType>
      <username>%EMAILADDRESS%</username>
      <authentication>password-cleartext</authentication>
    </outgoingServer>
  </emailProvider>
</clientConfig>`;

test("A broken server in the config is logged to the server, and we use the next server", () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  let configs = readConfigFromXML(kConfigXML, "example.com", "builtin");

  expect(configs.length).toBe(1);
  expect(configs.first.hostname).toBe("imap.example.com");
  expect(configs.first.outgoing.hostname).toBe("smtp.example.com");
  expect(errorsForServer.length).toBe(1);
});
