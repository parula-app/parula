// app first, to resolve the import cycle around Addons
import { appGlobal } from "../../../logic/app";
import { AddonProtocol } from "../../../logic/Addons/AddonProtocols";
import type { Account } from "../../../logic/Abstract/Account";
import type { Protocol } from "../../../logic/Addons/Sandbox/MustangAPI";
import { newChatAccountForProtocol } from "../../../logic/Chat/AccountsList/ChatAccounts";
import { newCalendarForProtocol } from "../../../logic/Calendar/AccountsList/Calendars";
import { newAddressbookForProtocol } from "../../../logic/Contacts/AccountsList/Addressbooks";
import { newFileSharingAccountForProtocol } from "../../../logic/Files/AccountsList/FileSharingAccounts";
import { FakeProtocolServer, newProtocolAddon, setUpBackend, waitFor } from "../Mail/Addon/protocolSandbox";
import type { ArrayColl } from "svelte-collections";
import { beforeAll, expect, test, vi } from "vitest";

// The real sandbox needs a browser
vi.mock("../../../logic/Addons/AddonSandbox", async () => ({
  AddonSandbox: (await import("../Mail/Addon/protocolSandbox")).ProtocolSandbox,
}));

beforeAll(() => {
  setUpBackend();
});

const apps: { type: string, newAccount: (protocol: string) => Account, accounts: () => ArrayColl<Account>, operations: object }[] = [
  { type: "chat", newAccount: newChatAccountForProtocol, accounts: () => appGlobal.chatAccounts, operations: { listRooms: async () => [] } },
  { type: "calendar", newAccount: newCalendarForProtocol, accounts: () => appGlobal.calendars, operations: { listEvents: async () => ({ events: [], syncState: "1" }) } },
  { type: "contacts", newAccount: newAddressbookForProtocol, accounts: () => appGlobal.addressbooks, operations: { listContacts: async () => ({ contacts: [], syncState: "1" }) } },
  { type: "files", newAccount: newFileSharingAccountForProtocol, accounts: () => appGlobal.fileSharingAccounts, operations: { listDirectory: async () => [] } },
];

test.each(apps)("A $type account is offline while its addon is disabled, connects again when it's enabled, and only login() gets the password", async ({ type, newAccount, accounts, operations }) => {
  let server = new FakeProtocolServer();
  let addon = newProtocolAddon("Fake " + type, ["test"], mustang => mustang.protocols.register("test", server.protocol(operations) as Protocol), type);
  await addon.enable();
  let account = newAccount(AddonProtocol.accountProtocol(addon.id, "test"));
  account.name = "Test";
  account.password = "secret";
  await account.save();
  accounts().add(account);
  await account.loginAndStartup(false);
  expect(account.isLoggedIn).toBe(true);

  await addon.disable();
  expect(account.isLoggedIn).toBe(false);
  expect(account.fatalError.message).toContain(addon.name);
  await expect(account.login(false)).rejects.toThrow(addon.name);

  server.calls = [];
  await addon.enable();
  await waitFor(() => account.isLoggedIn);
  expect(server.callsOf("login").length).toBe(1);
  expect(account.fatalError).toBeNull();
  await waitFor(() => server.calls.length > 1);
  expect(JSON.stringify(server.calls.filter(call => call.operation != "login"))).not.toContain("secret");

  await addon.uninstall();
  accounts().clear();
});
