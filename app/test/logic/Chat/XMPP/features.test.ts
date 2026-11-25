// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { setupChatTestEnv } from "./setup";
import { XMPPAccount } from "../../../../logic/Chat/XMPP/XMPPAccount";
import { XMPP1to1Chat } from "../../../../logic/Chat/XMPP/XMPP1to1Chat";
import { XMPPGroupChat } from "../../../../logic/Chat/XMPP/XMPPGroupChat";
import { DummyChatStorage } from "../../../../logic/Chat/SQL/DummyChatStorage";
import { DeliveryStatus } from "../../../../logic/Chat/ChatMessage";
import { XMPPChatMessage } from "../../../../logic/Chat/XMPP/XMPPChatMessage";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

const kMe = "me@localhost";
const kAlice = "alice@localhost";
const kRoom = "fans@conference.localhost";

let account: XMPPAccount;
let chat: XMPP1to1Chat;
let sent: any[];

beforeAll(async () => {
  await setupChatTestEnv();
});

beforeEach(async () => {
  sent = [];
  account = new XMPPAccount();
  account.storage = new DummyChatStorage();
  account.name = account.username = kMe;
  account.jid = kMe;
  account.client = {
    sessionStarted: true,
    sendMessage: (stanza: any) => { sent.push(stanza); return stanza.id ?? "generated"; },
  } as any;
  let alice = account.getPersonUID(kAlice, "Alice");
  chat = new XMPP1to1Chat(account);
  chat.id = kAlice;
  chat.contact = alice;
  account.rooms.set(chat.contact, chat);
});

/** Simulate an incoming stanza */
function incoming(fields: any) {
  return chat.addMessage({ from: kAlice, ...fields } as any);
}

describe("XMPP message features — receiving", () => {
  test("a reaction is applied to the target message", async () => {
    await incoming({ id: "m1", body: "Hello" });
    await incoming({ reactions: { id: "m1", emojis: ["👍"] } });
    let m1 = chat.messages.find(m => m.id == "m1");
    expect(m1.reactions.get(chat.contact as any)).toBe("👍");
    // Updating the set replaces it; empty removes it
    await incoming({ reactions: { id: "m1", emojis: ["🎉", "❤️"] } });
    expect(m1.reactions.get(chat.contact as any)).toBe("🎉❤️");
    await incoming({ reactions: { id: "m1", emojis: [] } });
    expect(m1.reactions.get(chat.contact as any)).toBeUndefined();
  });

  test("a correction edits the original message", async () => {
    await incoming({ id: "m2", body: "teh cat" });
    let result = await incoming({ id: "c1", body: "the cat", replace: "m2" });
    expect(result).toBeNull(); // a correction is not a new message
    let m2 = chat.messages.find(m => m.id == "m2") as XMPPChatMessage;
    expect(m2.text).toBe("the cat");
    expect(m2.edited).toBe(true);
    expect(chat.messages.length).toBe(1); // no extra message added
  });

  test("a retraction marks the message as deleted", async () => {
    await incoming({ id: "m3", body: "oops secret" });
    await incoming({ retract: { id: "m3" } });
    let m3 = chat.messages.find(m => m.id == "m3") as XMPPChatMessage;
    expect(m3.retracted).toBe(true);
    expect(m3.text).not.toBe("oops secret");
  });

  test("the chat partner can't edit or delete our messages", async () => {
    let ours = chat.newMessage();
    ours.text = "I'll pay 10 €";
    await chat.sendMessage(ours);
    await incoming({ id: "c2", body: "I'll pay 1000 €", replace: ours.id });
    await incoming({ retract: { id: ours.id } });
    expect(ours.text).toBe("I'll pay 10 €");
    expect(ours.edited).toBe(false);
    expect(ours.retracted).toBe(false);
  });

  test("in a group chat, only the author can edit or delete a message", async () => {
    let room = new XMPPGroupChat(account);
    room.id = kRoom;
    room.nick = "me";
    let alices = await room.addMessage({ type: "groupchat", from: `${kRoom}/alice`, id: "g1", body: "I like cats" } as any);
    await room.addMessage({ type: "groupchat", from: `${kRoom}/mallory`, id: "g2", body: "I hate cats", replace: "g1" } as any);
    await room.addMessage({ type: "groupchat", from: `${kRoom}/mallory`, retract: { id: "g1" } } as any);
    expect(alices!.text).toBe("I like cats");
    expect(alices!.retracted).toBe(false);

    await room.addMessage({ type: "groupchat", from: `${kRoom}/alice`, id: "g3", body: "I love cats", replace: "g1" } as any);
    expect(alices!.text).toBe("I love cats");
    await room.addMessage({ type: "groupchat", from: `${kRoom}/alice`, retract: { id: "g1" } } as any);
    expect(alices!.retracted).toBe(true);
  });

  test("an unencrypted edit or deletion can't change an encrypted message", async () => {
    let msg = await incoming({ id: "e1", body: "the code is 1234" });
    msg!.encrypted = true; // as if it came OMEMO-encrypted
    await incoming({ id: "e2", body: "the code is 0000", replace: "e1" });
    await incoming({ retract: { id: "e1" } });
    expect(msg!.text).toBe("the code is 1234");
    expect(msg!.retracted).toBe(false);
  });

  test("a delivery receipt and read marker update the delivery status", async () => {
    let out = chat.newMessage();
    out.id = "out1";
    out.outgoing = true;
    out.text = "hi";
    out.sent = new Date();
    chat.messages.add(out);

    await incoming({ receipt: { type: "received", id: "out1" } });
    expect(out.deliveryStatus).toBe(DeliveryStatus.User);
    await incoming({ marker: { type: "displayed", id: "out1" } });
    expect(out.deliveryStatus).toBe(DeliveryStatus.Seen);
  });

  test("a chat state sets the typing indicator", async () => {
    await incoming({ chatState: "composing" });
    expect(chat.contactIsTyping).toBe(true);
    await incoming({ chatState: "paused" });
    expect(chat.contactIsTyping).toBe(false);
    // a real message clears typing too
    await incoming({ chatState: "composing" });
    await incoming({ id: "m4", body: "done typing" });
    expect(chat.contactIsTyping).toBe(false);
  });

  test("a reply sets inReplyTo", async () => {
    let msg = await incoming({ id: "m5", body: "I agree", reply: { id: "m1", to: kMe } });
    expect(msg!.inReplyTo).toBe("m1");
  });
});

describe("XMPP message features — sending", () => {
  test("setMyReaction sends the emoji and shows it locally", async () => {
    let target = chat.newMessage();
    target.id = "t1";
    chat.messages.add(target);
    await target.setMyReaction("👍");
    expect(sent[0].reactions).toEqual({ id: "t1", emojis: ["👍"] });
    expect(target.reactions.get(account.getOwnContact())).toBe("👍");
  });

  test("sendEdit sends a replace and updates the original locally", async () => {
    let original = chat.newMessage();
    original.id = "t2";
    original.text = "frist";
    chat.messages.add(original);
    let edit = chat.newMessage();
    edit.isEdit = "t2"; // references the original
    edit.text = "first"; // the new text
    await edit.sendEdit();
    expect(sent[0].replace).toBe("t2"); // references the original
    expect(sent[0].body).toBe("first"); // carries the new text
    expect(original.text).toBe("first"); // original updated in place
    expect(original.edited).toBe(true);
  });

  test("deleteForOthers sends a retract for the message", async () => {
    let target = chat.newMessage();
    target.id = "t3";
    target.outgoing = true; // can only retract our own message
    chat.messages.add(target);
    await target.deleteForOthers();
    expect(sent[0].retract).toEqual({ id: "t3" });
    // XEP-0428 fallback marker, so a supporting client applies the retraction
    // instead of showing the fallback <body> as a new message.
    expect(sent[0].fallback).toEqual({ for: "urn:xmpp:message-retract:1" });
  });

  test("sendMessage requests a receipt and marks the message markable", async () => {
    let msg = chat.newMessage();
    msg.text = "Hi Alice";
    await chat.sendMessage(msg);
    expect(sent[0].body).toBe("Hi Alice");
    expect(sent[0].receipt).toEqual({ type: "request" });
    expect(sent[0].marker).toEqual({ type: "markable" });
    // XEP-0359 origin-id, so the recipient can match a later edit/retraction we
    // send that references this id (otherwise it's shown as a new message).
    expect(sent[0].originId).toBe(msg.id);
    expect(msg.deliveryStatus).toBe(DeliveryStatus.Server);
  });

  test("a displayed marker is sent when our user reads an incoming message", async () => {
    let msg = await incoming({ id: "r1", body: "read me" });
    await msg!.markRead();
    expect(sent[0].marker).toEqual({ type: "displayed", id: "r1" });
  });
});
