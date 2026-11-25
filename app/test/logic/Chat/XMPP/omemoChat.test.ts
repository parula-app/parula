// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { setupChatTestEnv } from "./setup";
import { XMPPAccount } from "../../../../logic/Chat/XMPP/XMPPAccount";
import { XMPP1to1Chat } from "../../../../logic/Chat/XMPP/XMPP1to1Chat";
import { Encryption } from "../../../../logic/Chat/XMPP/XMPPChat";
import { DummyChatStorage } from "../../../../logic/Chat/SQL/DummyChatStorage";
import { registerXMPPExtensions } from "../../../../logic/Chat/XMPP/XMPPStanzaExtensions";
import { createClient, type Agent } from "stanza";
import { parse } from "stanza/jxt";
import { beforeAll, describe, expect, test } from "vitest";

/** In-memory PEP, shared by both accounts (each user's bundle/devicelist) */
class FakePEPServer {
  store = new Map<string, Map<string, any[]>>();
  publish(owner: string, node: string, content: any, id: string): void {
    let nodes = this.store.get(owner) ?? new Map();
    this.store.set(owner, nodes);
    nodes.set(node, [{ id: id ?? "current", content }]);
  }
  getItems(target: string, node: string): any[] {
    return this.store.get(target)?.get(node) ?? [];
  }
}

const kAlice = "alice@localhost";
const kBob = "bob@localhost";

/** A stanza registry, to serialize an outgoing message to XML and parse it back,
 * exactly as the wire would, so the OMEMO `<encrypted>` element round-trips. */
let registry: Agent["stanzas"];
let pep: FakePEPServer;

beforeAll(async () => {
  await setupChatTestEnv();
  let client = createClient({ jid: "wire@localhost", password: "x" });
  registerXMPPExtensions(client);
  registry = client.stanzas;
});

/** Serializes an outgoing stanza to XML and parses it back into a received
 * message, with `from` set, like a real server relay. */
function overTheWire(stanza: any, from: string): any {
  let xml = registry.export("message", { ...stanza, from });
  return registry.import(parse(xml!.toString()));
}

function newAccount(jid: string, sent: any[]): XMPPAccount {
  let account = new XMPPAccount();
  account.storage = new DummyChatStorage();
  account.name = account.username = jid;
  account.jid = jid;
  account.client = {
    sessionStarted: true,
    sendMessage: (stanza: any) => { sent.push(stanza); return stanza.id ?? "id"; },
    publish: async (_t: string, node: string, content: any, id: string) => pep.publish(jid, node, content, id),
    getItems: async (target: string, node: string) => ({ items: pep.getItems(target || jid, node) }),
  } as any;
  return account;
}

describe("OMEMO end-to-end through a chat", () => {
  test("Alice OMEMO-encrypts a message that Bob's chat decrypts", async () => {
    pep = new FakePEPServer();
    let aliceSent: any[] = [];
    let bobSent: any[] = [];
    let alice = newAccount(kAlice, aliceSent);
    let bob = newAccount(kBob, bobSent);
    await alice.omemo.publishOwnKeys();
    await bob.omemo.publishOwnKeys();

    let aliceToBob = new XMPP1to1Chat(alice);
    aliceToBob.id = kBob;
    aliceToBob.contact = await alice.getRosterPerson(kBob, "Bob") as any;
    aliceToBob.encryption = Encryption.OMEMO;

    let bobToAlice = new XMPP1to1Chat(bob);
    bobToAlice.id = kAlice;
    bobToAlice.contact = await bob.getRosterPerson(kAlice, "Alice") as any;

    // Alice sends an encrypted message
    let outgoing = aliceToBob.newMessage();
    outgoing.text = "this is a secret";
    await aliceToBob.sendMessage(outgoing);

    // The stanza Alice put on the wire carries <encrypted>, not the plaintext
    let stanza = aliceSent[0];
    expect(stanza.omemo).toBeTruthy();
    expect(stanza.body).not.toContain("secret"); // only a fallback body, no plaintext
    expect(stanza.encryptionMethod?.name).toBe("OMEMO");
    let wireXML = registry.export("message", { ...stanza, from: kAlice })!.toString();
    expect(wireXML).toContain("<encrypted");
    expect(wireXML).not.toContain("this is a secret");
    // First message sets up the session, so the <key> is a prekey, spelled "true"
    expect(wireXML).toContain('prekey="true"');

    // Bob's chat receives and decrypts it
    let received = await bobToAlice.addMessage(overTheWire(stanza, kAlice));
    expect(received).toBeTruthy();
    expect(received!.text).toBe("this is a secret");
    expect(received!.encrypted).toBe(true);
    expect(received!.outgoing).toBe(false);
    // Receiving an OMEMO message turns on encryption for replies
    expect(bobToAlice.encryption).toBe(Encryption.OMEMO);

    // Bob replies, encrypted; Alice decrypts
    let reply = bobToAlice.newMessage();
    reply.text = "got it, also secret";
    await bobToAlice.sendMessage(reply);
    let aliceGot = await aliceToBob.addMessage(overTheWire(bobSent[0], kBob));
    expect(aliceGot!.text).toBe("got it, also secret");
    expect(aliceGot!.encrypted).toBe(true);
  });

  test("The unencrypted HTML and links of an OMEMO message are ignored", async () => {
    pep = new FakePEPServer();
    let aliceSent: any[] = [];
    let alice = newAccount(kAlice, aliceSent);
    let bob = newAccount(kBob, []);
    await alice.omemo.publishOwnKeys();
    await bob.omemo.publishOwnKeys();

    let aliceToBob = new XMPP1to1Chat(alice);
    aliceToBob.id = kBob;
    aliceToBob.contact = await alice.getRosterPerson(kBob, "Bob") as any;
    aliceToBob.encryption = Encryption.OMEMO;

    let bobToAlice = new XMPP1to1Chat(bob);
    bobToAlice.id = kAlice;
    bobToAlice.contact = await bob.getRosterPerson(kAlice, "Alice") as any;

    // The server adds XHTML-IM and an OOB link, which OMEMO doesn't encrypt
    let outgoing = aliceToBob.newMessage();
    outgoing.text = "meet at noon";
    await aliceToBob.sendMessage(outgoing);
    let received = await bobToAlice.addMessage(overTheWire({
      ...aliceSent[0],
      html: { body: "<p>meet at midnight</p>" },
      links: [{ url: "https://server.example/upload/midnight.png" }],
    }, kAlice));
    expect(received!.encrypted).toBe(true);
    expect(received!.html).toContain("meet at noon");
    expect(received!.html).not.toContain("midnight");
    expect(received!.attachments.hasItems).toBe(false);

    // The same for an edit
    let edit = aliceToBob.newMessage();
    edit.isEdit = outgoing.id;
    edit.text = "meet at 1 pm";
    await edit.sendEdit();
    await bobToAlice.addMessage(overTheWire({
      ...aliceSent[1],
      html: { body: "<p>meet at midnight</p>" },
    }, kAlice));
    expect(received!.html).toContain("meet at 1 pm");
    expect(received!.html).not.toContain("midnight");
  });
});
