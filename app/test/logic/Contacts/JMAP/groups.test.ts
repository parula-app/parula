// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPAddressbook } from "../../../../logic/Contacts/JMAP/JMAPAddressbook";
import type { JMAPGroup } from "../../../../logic/Contacts/JMAP/JMAPGroup";
import type { TJMAPContact } from "../../../../logic/Contacts/JMAP/TJSContact";
import { afterEach, beforeAll, expect, test } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a real server"); },
  } as any;
});

afterEach(() => {
  appGlobal.addressbooks.clear();
});

const kMember1 = "urn:uuid:b08d2510-928c-4ea5-bf94-84f283cfc626";
const kMember2 = "urn:uuid:ab2d1e15-d299-4fc2-8866-8914903636fc";
const kUnknown = "urn:uuid:00000000-0000-4000-8000-000000000000";

/** As Stalwart returns two vCards and a vCard with `KIND:group` and three `MEMBER`s */
function serverCards(): TJMAPContact[] {
  return [
    { "@type": "Card", version: "1.0", uid: kMember1, name: { full: "Member One" }, emails: { k1: { address: "member.one@example.net" } }, id: "da", addressBookIds: { b: true } },
    { "@type": "Card", version: "1.0", uid: kMember2, name: { full: "Member Two" }, emails: { k1: { address: "member.two@example.net" } }, id: "db", addressBookIds: { b: true } },
    {
      "@type": "Card", version: "1.0", kind: "group", uid: "urn:uuid:b87ce496-b2ed-49c3-84c2-aed531f4c1f8",
      name: { full: "Group Probe" },
      members: { [kMember1]: true, [kMember2]: true, [kUnknown]: true },
      id: "dd", addressBookIds: { b: true },
    },
  ] as any as TJMAPContact[];
}

function setup() {
  let account = new JMAPAccount();
  account.accountID = "a";
  account.login = async () => {};
  let addressbook = new JMAPAddressbook();
  addressbook.initFromMainAccount(account);
  addressbook.jmapID = "b";
  addressbook.storage = { savePerson: async () => {}, saveGroup: async () => {}, deleteGroup: async () => {}, saveAddressbook: async () => {} } as any;
  addressbook.readContactsFromDB = async () => {};
  addressbook.errorCallback = ex => { throw ex; };
  appGlobal.addressbooks.add(addressbook);
  let sent: [string, any][] = [];
  account.makeCombinedCall = async () => ({
    persons: { accountId: "a", state: "s1", list: serverCards(), notFound: [] },
  });
  account.makeSingleCall = async (method: string, args: any) => {
    sent.push([method, args]);
    return args.create
      ? { accountId: "a", created: { [Object.keys(args.create)[0]]: { id: "newGroupID" } } }
      : { accountId: "a", updated: { dd: null } };
  };
  return { account, addressbook, sent };
}

test("A group from another client is a group with its members, not a person", async () => {
  let { addressbook } = setup();
  await addressbook.listContacts();
  expect(addressbook.persons.contents.map(p => p.name).sort()).toEqual(["Member One", "Member Two"]);
  expect(addressbook.groups.contents.map(g => g.name)).toEqual(["Group Probe"]);
  expect(addressbook.groups.first.participants.contents.map(p => p.name).sort()).toEqual(["Member One", "Member Two"]);
});

test("Removing a member keeps the members that we can't see", async () => {
  let { addressbook, sent } = setup();
  await addressbook.listContacts();
  let group = addressbook.groups.first as JMAPGroup;
  group.participants.remove(addressbook.persons.find(p => p.name == "Member One"));
  await group.saveToServer();

  // The members on the server after our update, sent as a whole or as patch paths
  let members = { ...serverCards()[2].members };
  for (let [method, args] of sent.filter(([method]) => method == "ContactCard/set")) {
    let patch = args.update?.dd ?? {};
    if (patch.members) {
      members = { ...patch.members };
    }
    for (let [path, value] of Object.entries(patch)) {
      if (path.startsWith("members/")) {
        let uid = path.slice("members/".length).replaceAll("~1", "/").replaceAll("~0", "~");
        value ? members[uid] = true : delete members[uid];
      }
    }
  }
  expect(Object.keys(members).sort()).toEqual([kUnknown, kMember2].sort());
});

test("A new group", async () => {
  let { addressbook, sent } = setup();
  await addressbook.listContacts();
  let group = addressbook.newGroup();
  group.name = "New Group";
  group.participants.add(addressbook.persons.first);
  addressbook.groups.add(group);
  await group.saveToServer();
  let card = sent[0][1].create[group.id];
  expect(card.kind).toBe("group");
  expect(card.name.full).toBe("New Group");
  expect(card.members).toEqual({ [kMember1]: true });
  expect(card.addressBookIds).toEqual({ b: true });
  expect(card.uid).toMatch(/^urn:uuid:/);
  expect(group.jmapID).toBe("newGroupID");
});

test("A group name with only components, one of them broken", async () => {
  let { addressbook } = setup();
  let group = addressbook.newGroup();
  group.fromJMAP({
    "@type": "Card", version: "1.0", kind: "group", uid: "urn:uuid:5a1f0e3c-8d2b-4c6a-9e7f-0b1c2d3e4f5a",
    name: { components: [{ kind: "given", value: "Choir" }, { kind: "surname", value: null }, { kind: "credential", value: "Tenors" }] },
    id: "de", addressBookIds: { b: true },
  } as any as TJMAPContact);
  expect(group.name).toContain("Choir");
  expect(group.name).toContain("Tenors");
  expect(group.name).not.toMatch(/null|undefined/);
});
