// app first, to resolve the import cycle around Addons
import { appGlobal } from "../../../../logic/app";
import type { Addon } from "../../../../logic/Addons/Addon";
import { AddonProtocol } from "../../../../logic/Addons/AddonProtocols";
import type { ContactData, ContactsProtocol } from "../../../../logic/Addons/Sandbox/MustangAPI";
import { AddonAddressbook } from "../../../../logic/Contacts/Addon/AddonAddressbook";
import type { AddonPerson } from "../../../../logic/Contacts/Addon/AddonPerson";
import { newAddressbookForProtocol } from "../../../../logic/Contacts/AccountsList/Addressbooks";
import { SQLAddressbook } from "../../../../logic/Contacts/SQL/SQLAddressbook";
import { getDatabase } from "../../../../logic/Contacts/SQL/SQLDatabase";
import { ChangeLog, FakeProtocolServer, newProtocolAddon, setUpBackend } from "../../Mail/Addon/protocolSandbox";
import sql from "../../../../../lib/rs-sqlite";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

// The real sandbox needs a browser
vi.mock("../../../../logic/Addons/AddonSandbox", async () => ({
  AddonSandbox: (await import("../../Mail/Addon/protocolSandbox")).ProtocolSandbox,
}));

function vcard(uid: string, name: string, lines: string[] = []): string {
  return ["BEGIN:VCARD", "VERSION:4.0", `UID:${uid}`, `FN:${name}`, ...lines, "END:VCARD"].join("\r\n");
}

/** A contacts server, as the addon sees it */
class FakeContactsServer extends FakeProtocolServer {
  contacts = new ChangeLog<ContactData>();
  saved = new Map<string, string>();

  addContacts(count: number, first = 0): void {
    for (let i = first; i < first + count; i++) {
      this.contacts.add({ id: "c" + i, vcard: vcard("uid" + i, "Person " + i, [`EMAIL:person${i}@example.com`, "X-UNKNOWN-TO-APP:keep me"]) });
    }
  }

  contactsProtocol(): ContactsProtocol {
    return this.protocol({
      listContacts: async (_account, syncState) => this.contacts.list("contacts", syncState),
      saveContact: async (_account, id, vcard) => {
        id ??= "new-" + (this.saved.size + 1);
        this.saved.set(id, vcard);
        return id;
      },
      deleteContact: async () => {},
    } as Partial<ContactsProtocol>) as ContactsProtocol;
  }
}

beforeAll(() => {
  setUpBackend();
});

let running: Addon[] = [];

afterEach(async () => {
  for (let addon of running) {
    await addon.disable();
    appGlobal.addons.installed.remove(addon);
  }
  running = [];
  appGlobal.addressbooks.clear();
});

async function newAddressbook(server: FakeContactsServer, name = "Fake Contacts"): Promise<AddonAddressbook> {
  let addon = newProtocolAddon(name, ["test"], mustang => mustang.protocols.register("test", server.contactsProtocol()), "contacts");
  running.push(addon);
  await addon.enable();
  let addressbook = newAddressbookForProtocol(AddonProtocol.accountProtocol(addon.id, "test")) as AddonAddressbook;
  addressbook.name = "Test";
  addressbook.username = "me";
  addressbook.password = "secret";
  await addressbook.save();
  appGlobal.addressbooks.add(addressbook);
  await addressbook.login(false);
  return addressbook;
}

async function storedPersons(addressbook: AddonAddressbook): Promise<any[]> {
  return await (await getDatabase()).all(sql`SELECT name, json FROM person WHERE addressbookID = ${addressbook.dbID}`) as any[];
}

function personOf(addressbook: AddonAddressbook, id: string): AddonPerson {
  return addressbook.persons.find(person => person.serverID == id);
}

describe("Round trip", () => {
  test("Syncs the contacts in chunks, parses and stores them, and continues at the stored sync state", async () => {
    let server = new FakeContactsServer();
    server.addContacts(1500);
    let addressbook = await newAddressbook(server);
    expect(addressbook).toBeInstanceOf(AddonAddressbook);

    await addressbook.listContacts();

    expect(server.callsOf("listContacts").length).toBe(2);
    let person = personOf(addressbook, "c7");
    expect(person.name).toBe("Person 7");
    expect(person.emailAddresses.first.value).toBe("person7@example.com");
    expect((await storedPersons(addressbook)).length).toBe(1500);

    // Restart
    let addressbooks = await SQLAddressbook.readAll();
    let restarted = addressbooks.find(loaded => loaded.id == addressbook.id) as AddonAddressbook;
    expect(restarted).toBeInstanceOf(AddonAddressbook);
    expect(restarted.syncState).toBe(addressbook.syncState);
    appGlobal.addressbooks.remove(addressbook);
    appGlobal.addressbooks.add(restarted);
    server.calls = [];
    server.addContacts(1, 2000);
    server.contacts.add({ id: "c0", vcard: vcard("uid0", "Person 0, changed") });
    server.contacts.remove("c1");

    await restarted.login(false);
    await restarted.listContacts();

    expect(server.callsOf("listContacts")[0][1]).toBe(addressbook.syncState);
    expect(personOf(restarted, "c0").name).toBe("Person 0, changed");
    expect(personOf(restarted, "c1")).toBeUndefined();
    expect(personOf(restarted, "c2000")).toBeTruthy();
    expect(personOf(restarted, "c2").serverID).toBe("c2");
    let stored = await storedPersons(restarted);
    expect(stored.length).toBe(1500);
    expect(stored.some(row => row.name == "Person 0, changed")).toBe(true);
  }, 60000);

  test("New, changed and deleted contacts go to the addon as vCard, and unknown properties stay", async () => {
    let server = new FakeContactsServer();
    server.addContacts(1);
    let addressbook = await newAddressbook(server);
    await addressbook.listContacts();

    let person = addressbook.newPerson();
    person.name = "Carol";
    await person.save();
    let [account, id, sent] = server.callsOf("saveContact")[0];
    expect(account.id).toBe(addressbook.id);
    expect(id).toBeNull();
    expect(sent).toContain("FN:Carol");
    expect(person.serverID).toBe("new-1");

    let known = personOf(addressbook, "c0");
    known.name = "Person 0, renamed";
    await known.save();
    let [, knownID, changed] = server.callsOf("saveContact")[1];
    expect(knownID).toBe("c0");
    expect(changed).toContain("FN:Person 0\\, renamed");
    expect(changed).toContain("X-UNKNOWN-TO-APP:keep me");

    await known.deleteIt();
    expect(server.callsOf("deleteContact")[0][1]).toBe("c0");
    expect((await storedPersons(addressbook)).map(row => row.name)).toEqual(["Carol"]);
  });
});

describe("Checks of the data from the addon", () => {
  test("Control characters, pictures from the internet, wrong types and too large contacts don't reach the app as they are", async () => {
    let server = new FakeContactsServer();
    server.contacts.add({ id: "evil", vcard: vcard("evil-uid", "Mallory ‮evil‬\u0007", ["PHOTO;VALUE=uri:https://tracker.example.com/x.png"]) });
    server.contacts.add({ id: "photo", vcard: vcard("photo-uid", "With photo", ["PHOTO;VALUE=uri:data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="]) });
    server.contacts.add({ id: "huge", vcard: vcard("huge-uid", "x".repeat(1024 * 1024)) });
    server.contacts.add({ id: "number", vcard: 42 as any });
    server.contacts.add({ id: { x: 1 } as any, vcard: vcard("wrong-id", "Wrong type of ID") });
    let addressbook = await newAddressbook(server);

    await addressbook.listContacts();

    let evil = personOf(addressbook, "evil");
    expect(evil.name).toBe("Mallory  evil");
    expect(evil.picture).toBeNull();
    expect(personOf(addressbook, "photo").picture).toMatch(/^data:image\/gif;base64,/);
    expect(addressbook.persons.contents.map(person => person.serverID).sort()).toEqual(["evil", "photo"]);
    expect(addressbook.dataErrors.hasItems).toBe(true);
  });

  test("Too many contacts per call, a sync state over 10 KB, and a sync without progress are stopped", async () => {
    let server = new FakeContactsServer();
    server.contacts.chunkSize = 1001;
    server.addContacts(1001);
    let addressbook = await newAddressbook(server);
    await expect(addressbook.listContacts()).rejects.toThrow(/more than 1000/);
    expect(addressbook.persons.isEmpty).toBe(true);

    let bigState = new FakeContactsServer();
    let bigStateAddressbook = await newAddressbook(bigState, "Big state");
    (bigState as any).contacts.list = () => ({ contacts: [], syncState: "s".repeat(10 * 1024 + 1) });
    await expect(bigStateAddressbook.listContacts()).rejects.toThrow(/10 KB/);

    let stuck = new FakeContactsServer();
    stuck.contacts.isStuck = true;
    let stuckAddressbook = await newAddressbook(stuck, "Stuck");
    let errors: Error[] = [];
    stuckAddressbook.errorCallback = ex => errors.push(ex);
    await stuckAddressbook.listContacts();
    expect(errors.some(ex => ex.message.includes("keeps reporting more"))).toBe(true);
    expect(stuck.callsOf("listContacts").length).toBeLessThan(5);
  });
});
