// app first, to resolve the import cycle around Addons
import { appGlobal } from "../../../../logic/app";
import { Addon } from "../../../../logic/Addons/Addon";
import { AddonManifest } from "../../../../logic/Addons/AddonManifest";
import { AddonProtocol, addonProtocols } from "../../../../logic/Addons/AddonProtocols";
import { AddonMailAccount } from "../../../../logic/Mail/Addon/AddonMailAccount";
import type { AddonFolder } from "../../../../logic/Mail/Addon/AddonFolder";
import { newAccountForProtocol } from "../../../../logic/Mail/AccountsList/MailAccounts";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { AddonBuilder } from "../../../../../addons/examples/build";
import { JSONMailServer } from "../../../../../addons/examples/json-mail/server/JSONMailServer";
import { ProtocolSandbox, setUpBackend, waitFor } from "./protocolSandbox";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MapColl } from "svelte-collections";
import { beforeAll, expect, test, vi } from "vitest";

// The real sandbox needs a browser
vi.mock("../../../../logic/Addons/AddonSandbox", async () => ({
  AddonSandbox: (await import("./protocolSandbox")).ProtocolSandbox,
}));

const kDir = fileURLToPath(new URL("../../../../../addons/examples/json-mail/", import.meta.url));

let manifest: AddonManifest;
let mainCode: string;

beforeAll(async () => {
  setUpBackend();
  let files = new MapColl<string, Uint8Array>();
  files.set("package.json", await readFile(kDir + "package.json"));
  files.set("icons/json-mail.svg", await readFile(kDir + "icons/json-mail.svg"));
  for (let [file, contents] of await new AddonBuilder(kDir).build(false)) {
    files.set(file, contents);
  }
  manifest = AddonManifest.fromJSON(JSON.parse(new TextDecoder().decode(files.get("package.json"))), files);
  mainCode = new TextDecoder().decode(files.get(manifest.main));
}, 30000);

test("json-mail has a valid manifest: one mail protocol with a setup page, and only its declared host", () => {
  expect(manifest.protocols.length).toBe(1);
  expect(manifest.protocols.first).toMatchObject({ id: "json", type: "mail" });
  expect(manifest.permissions.isEmpty).toBe(true);
  expect(manifest.hosts.contents).toEqual(["https://json-mail.example.com"]);
});

test("json-mail: setup, sync, read, flags, delete, folders, send and push, with its JSON server", async () => {
  let server = new JSONMailServer();
  server.users.set("me", "secret");
  server.addFolder("inbox", "Inbox", "inbox");
  server.addFolder("trash", "Trash", "trash");
  server.addMessage("inbox", { subject: "Welcome", from: "alice@example.com", text: "Hello from the JSON server" });
  server.addMessage("inbox", { subject: "Second", from: "bob@example.com", flags: { seen: true } });
  let poll: () => void;
  let addon = new Addon(appGlobal.addons, manifest, { deleteAll: async () => {} } as any);
  addon.grantedPermissions.addAll(manifest.requestedPermissions);
  addon.isEnabled = false;
  appGlobal.addons.installed.add(addon);
  ProtocolSandbox.mainCode.set(addon.id, mustang =>
    new Function("mustang", "fetch", "setInterval", mainCode)(mustang, (input, init) => server.fetch(input, init), callback => poll = callback));
  await addon.enable();
  let protocol = addonProtocols.find(protocol => protocol.addon == addon);
  expect(protocol.protocol).toBe(AddonProtocol.accountProtocol(addon.id, "json"));

  // Setup: what the user entered on the first page, then the addon's setup page
  let account = newAccountForProtocol(protocol.protocol) as AddonMailAccount;
  account.emailAddress = "me@example.com";
  account.password = "wrong";
  let setupFrame = await (addon.sandbox as any as ProtocolSandbox).connect();
  setupFrame.client.mustang.protocols.setupAccount({ name: "JSON Mail me", username: "me", serverURL: "https://json-mail.example.com" });
  await setupFrame.client.roundTrip();
  account.connection.fromAddonSetup(protocol.protocols.setupOf(setupFrame.bridge));
  await expect(account.verifyLogin()).rejects.toThrow("Wrong username or password");
  account.password = "secret";
  await account.verifyLogin();
  await account.save();
  appGlobal.emailAccounts.add(account);

  await account.loginAndStartup(false);

  let inbox = account.inbox as AddonFolder;
  expect(inbox.id).toBe("inbox");
  expect(account.getSpecialFolder(SpecialFolder.Trash).id).toBe("trash");
  expect(inbox.messages.contents.map(email => email.subject).sort()).toEqual(["Second", "Welcome"]);
  let welcome = inbox.messages.find(email => email.subject == "Welcome");
  let second = inbox.messages.find(email => email.subject == "Second");
  expect(welcome.isRead).toBe(false);
  expect(second.isRead).toBe(true);
  expect(welcome.downloadComplete).toBe(true);
  expect(welcome.text).toContain("Hello from the JSON server");
  expect(welcome.from.emailAddress).toBe("alice@example.com");

  await welcome.markRead();
  expect(server.folders.get("inbox").messages.get(welcome.pID as string).flags.seen).toBe(true);

  await second.deleteMessage();
  expect(server.folders.get("inbox").messages.has(second.pID as string)).toBe(false);
  expect(server.folders.get("trash").messages.has(second.pID as string)).toBe(true);

  let projects = await inbox.createSubFolder("Projects");
  expect(server.folders.get(projects.id).parentID).toBe("inbox");
  await projects.rename("Old projects");
  expect(server.folders.get(projects.id).name).toBe("Old projects");
  await projects.deleteIt();
  expect(server.folders.has(projects.id)).toBe(false);

  let mail = account.newEMailFrom();
  mail.subject = "Reply";
  mail.text = "Thanks";
  mail.to.add(new PersonUID("alice@example.com", "Alice"));
  mail.bcc.add(new PersonUID("hidden@example.com", "Hidden"));
  await account.send(mail);
  expect(server.sent.length).toBe(1);
  expect(server.sent[0].from).toBe("me@example.com");
  expect(server.sent[0].recipients.sort()).toEqual(["alice@example.com", "hidden@example.com"]);
  expect(new TextDecoder().decode(server.sent[0].mime)).toContain("Subject: Reply");

  // The addon asks the server every few minutes, and tells the app
  server.addMessage("inbox", { subject: "Pushed", from: "carol@example.com" });
  poll();
  await waitFor(() => inbox.messages.some(email => email.subject == "Pushed"));
});
