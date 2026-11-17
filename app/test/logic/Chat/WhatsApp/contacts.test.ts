// @vitest-environment happy-dom
// happy-dom gives us FileReader, which blobToDataURL (the avatar download) uses.

// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { WhatsAppAccount } from "../../../../logic/Chat/WhatsApp/WhatsAppAccount";
import { WhatsAppContact } from "../../../../logic/Chat/WhatsApp/WhatsAppContact";
import { JID, kServerUser } from "../../../../logic/Chat/WhatsApp/Binary/JID";
import { WANode } from "../../../../logic/Chat/WhatsApp/Binary/WANode";
import { DummyChatStorage } from "../../../../logic/Chat/SQL/DummyChatStorage";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { DummyAddressbookStorage } from "../../../../logic/Contacts/SQL/DummyAddressbookStorage";
import { Person, ContactEntry } from "../../../../logic/Abstract/Person";
import { expect, test } from "vitest";

const kAliceJID = "491761111111@s.whatsapp.net";

/** A text node as the binary decoder delivers it: content is bytes, not a string. */
function textNode(tag: string, text: string): WANode {
  return new WANode(tag, {}, new TextEncoder().encode(text));
}

/** A connection stub whose sendIQ returns a canned response dispatched on the
 * request's xmlns (the only two a WhatsAppContact issues). */
function fakeConnection(responses: { picture?: WANode, usync?: WANode }): any {
  return {
    async sendIQ(node: WANode): Promise<WANode> {
      if (node.attrs.xmlns == "w:profile:picture") {
        return responses.picture ?? new WANode("iq", { type: "result" });
      }
      if (node.attrs.xmlns == "usync") {
        return responses.usync ?? new WANode("iq", { type: "result" });
      }
      throw new Error("unexpected IQ xmlns " + node.attrs.xmlns);
    },
    async sendNode() {},
  };
}

/** Make appGlobal.remoteApp.kyCreate hand back a ky whose GET yields `bytes`,
 * and record the URLs requested. */
function stubHttp(bytes: Uint8Array): { urls: string[] } {
  let urls: string[] = [];
  appGlobal.remoteApp = {
    async kyCreate() {
      return {
        async get(url: string) {
          urls.push(url);
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
      };
    },
  };
  return { urls };
}

test("pictureIQ asks for the contact's preview avatar URL", () => {
  let iq = new WhatsAppContact(JID.parse("491761111111:5@s.whatsapp.net")).pictureIQ();
  expect(iq.attrs.type).toBe("get");
  expect(iq.attrs.xmlns).toBe("w:profile:picture");
  expect(iq.attrs.to).toBe(kServerUser); // goes to the server...
  expect(iq.attrs.target).toBe(kAliceJID); // ...with the contact (device id stripped) in `target`
  let picture = iq.child("picture")!;
  expect(picture.attrs.type).toBe("preview"); // the small thumbnail for a contact list
  expect(picture.attrs.query).toBe("url");
});

test("usyncIQ asks for this contact's status + verified name", () => {
  let iq = new WhatsAppContact(JID.parse(kAliceJID)).usyncIQ();
  expect(iq.attrs.xmlns).toBe("usync");
  let usync = iq.child("usync")!;
  expect(usync.attrs.mode).toBe("query");
  expect(usync.attrs.sid).toMatch(/^[0-9a-f]{16}$/); // an 8-byte hex session id
  let query = usync.child("query")!;
  expect(query.child("status")).toBeDefined();
  expect(query.child("business")!.child("verified_name")).toBeDefined();
  expect(usync.child("list")!.children("user").map(u => u.attrs.jid)).toEqual([kAliceJID]);
});

test("fetchInfo reads status and a verified business name (which becomes the name)", async () => {
  let usync = new WANode("iq", { type: "result" }, [
    new WANode("usync", {}, [new WANode("list", {}, [
      new WANode("user", { jid: kAliceJID }, [
        new WANode("business", { name: "Joe's Pizza" }),
        textNode("status", "Open 9-5"),
      ]),
    ])]),
  ]);
  let contact = new WhatsAppContact(JID.parse(kAliceJID));
  await contact.fetchInfo(fakeConnection({ usync }));
  expect(contact.status).toBe("Open 9-5");
  expect(contact.verifiedName).toBe("Joe's Pizza");
  expect(contact.name).toBe("Joe's Pizza");
});

test("fetchInfo also reads a nested <verified_name><name>", async () => {
  let usync = new WANode("iq", { type: "result" }, [
    new WANode("usync", {}, [new WANode("list", {}, [
      new WANode("user", { jid: kAliceJID }, [new WANode("verified_name", {}, [textNode("name", "ACME Corp")])]),
    ])]),
  ]);
  let contact = new WhatsAppContact(JID.parse(kAliceJID));
  await contact.fetchInfo(fakeConnection({ usync }));
  expect(contact.verifiedName).toBe("ACME Corp");
});

test("fetchPicture resolves the URL, downloads it, and stores a data URL", async () => {
  let picture = new WANode("iq", { type: "result" },
    [new WANode("picture", { type: "preview", url: "https://pps.whatsapp.net/alice.jpg" })]);
  let http = stubHttp(new Uint8Array([1, 2, 3, 4]));
  let contact = new WhatsAppContact(JID.parse(kAliceJID));
  let dataURL = await contact.fetchPicture(fakeConnection({ picture }));
  expect(http.urls).toEqual(["https://pps.whatsapp.net/alice.jpg"]);
  expect(dataURL).toMatch(/^data:image\/jpeg;base64,/);
  expect(contact.picture).toBe(dataURL);
});

test("fetchPicture is null when the contact has no picture", async () => {
  let picture = new WANode("iq", { type: "error" }, [new WANode("error", { code: "404" })]);
  let contact = new WhatsAppContact(JID.parse(kAliceJID));
  expect(await contact.fetchPicture(fakeConnection({ picture }))).toBe(null);
  expect(contact.picture).toBe(null);
});

test("fetchPicture refuses an avatar URL off the allowlist without fetching it", async () => {
  let picture = new WANode("iq", { type: "result" },
    [new WANode("picture", { type: "preview", url: "https://internal.corp.local/alice.jpg" })]);
  let http = stubHttp(new Uint8Array([1, 2, 3, 4]));
  let contact = new WhatsAppContact(JID.parse(kAliceJID));
  await expect(contact.fetchPicture(fakeConnection({ picture }))).rejects.toThrow(/untrusted/i);
  expect(http.urls).toEqual([]); // the backend was never asked
  expect(contact.picture).toBeFalsy();
});

test("fetch never throws if the server/IQ fails", async () => {
  let contact = new WhatsAppContact(JID.parse(kAliceJID));
  await contact.fetch({ async sendIQ() { throw new Error("connection lost"); } } as any);
  expect(contact.status).toBe(null);
  expect(contact.picture).toBeFalsy(); // never set (inherited, starts undefined)
});

test("applyTo fills name/status/picture without clobbering existing data", () => {
  let contact = new WhatsAppContact(JID.parse(kAliceJID));
  contact.verifiedName = "Joe's Pizza";
  contact.status = "Open 9-5";
  contact.picture = "data:image/jpeg;base64,NEW";

  let fresh = new Person();
  fresh.name = "Joe push";
  expect(contact.applyTo(fresh)).toBe(true);
  expect(fresh.name).toBe("Joe's Pizza"); // verified name wins over the push name
  expect(fresh.notes).toBe("Open 9-5");
  expect(fresh.picture).toBe("data:image/jpeg;base64,NEW");

  let existing = new Person();
  existing.name = "Already";
  existing.notes = "my note";
  existing.picture = "data:image/png;base64,existing";
  expect(contact.applyTo(existing)).toBe(true); // only the name differs
  expect(existing.notes).toBe("my note"); // kept
  expect(existing.picture).toBe("data:image/png;base64,existing"); // kept
});

/** A WhatsApp account with an empty personal address book, both backed by no-op
 * storage (mirrors liveReceive.test.ts). */
function setupAccount(): WhatsAppAccount {
  appGlobal.addressbooks.clear();
  appGlobal.chatAccounts.clear();
  let addressbook = new Addressbook();
  addressbook.name = "Personal";
  addressbook.storage = new DummyAddressbookStorage();
  appGlobal.addressbooks.add(addressbook);
  appGlobal.personalAddressbook = addressbook;
  let account = new WhatsAppAccount();
  account.storage = new DummyChatStorage();
  account.deviceJID = JID.parse("412300000000:1@s.whatsapp.net");
  appGlobal.chatAccounts.add(account);
  appGlobal.me = new Person();
  appGlobal.me.name = "Me";
  return account;
}

test("getContact fetches the profile on first link, onto the contact, and doesn't refetch", async () => {
  let account = setupAccount();
  let picture = new WANode("iq", { type: "result" },
    [new WANode("picture", { type: "preview", url: "https://pps.whatsapp.net/a.jpg" })]);
  let usync = new WANode("iq", { type: "result" }, [
    new WANode("usync", {}, [new WANode("list", {}, [new WANode("user", { jid: kAliceJID }, [textNode("status", "Busy")])])]),
  ]);
  let iqCount = 0;
  account.connection = {
    async sendIQ(node: WANode) { iqCount++; return node.attrs.xmlns == "w:profile:picture" ? picture : usync; },
  } as any;
  stubHttp(new Uint8Array([7, 7, 7]));

  // First message creates and caches the contact, firing the (background) fetch.
  let room = await account.getOrCreateRoom(JID.parse(kAliceJID), "Alice Push");
  let contact = room.contact as WhatsAppContact;
  expect(contact.name).toBe("Alice Push"); // push name initially
  await flush();
  expect(contact.status).toBe("Busy"); // status fetched onto the contact
  expect(contact.picture).toMatch(/^data:image\/jpeg;base64,/); // avatar fetched
  let first = iqCount;
  expect(first).toBeGreaterThan(0);

  // A later message from the same (already-cached) contact must not refetch.
  await account.getOrCreateRoom(JID.parse("491761111111:9@s.whatsapp.net"), "Alice Push");
  await flush();
  expect(iqCount).toBe(first);
});

test("getContact does not fetch when offline (no connection)", async () => {
  let account = setupAccount(); // account.connection stays null
  let room = await account.getOrCreateRoom(JID.parse(kAliceJID), "Alice Push");
  await flush();
  let contact = room.contact as WhatsAppContact;
  expect(contact.status).toBeFalsy();
  expect(contact.picture).toBeFalsy();
});

test("a 'picture' notification refetches only that contact's avatar", async () => {
  let account = setupAccount();
  let newPic = new WANode("iq", { type: "result" },
    [new WANode("picture", { type: "preview", url: "https://pps.whatsapp.net/new.jpg" })]);
  let iqCount = 0;
  account.connection = { async sendIQ() { iqCount++; return newPic; }, async sendNode() {} } as any;
  stubHttp(new Uint8Array([5, 5, 5]));

  // A contact we already have a chat with, with an old avatar.
  let room = await account.getOrCreateRoom(JID.parse(kAliceJID), "Alice");
  await flush();
  let contact = room.contact as WhatsAppContact;
  contact.picture = "data:image/jpeg;base64,OLD";
  iqCount = 0; // ignore the initial getContact fetch

  await (account as any).onNotification(
    new WANode("notification", { type: "picture", from: "491761111111:7@s.whatsapp.net", id: "n1" }));
  await flush();
  expect(iqCount).toBe(1); // one picture IQ, just for this contact
  expect(contact.picture).toMatch(/^data:image\/jpeg;base64,/);
  expect(contact.picture).not.toBe("data:image/jpeg;base64,OLD"); // replaced with the new avatar
});

/** Lets the fire-and-forget contact fetch settle before we assert on its
 * effects. A real (macrotask) delay, because the avatar's blobToDataURL resolves
 * on a FileReader `onloadend` callback, not a microtask. */
async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 20));
}
