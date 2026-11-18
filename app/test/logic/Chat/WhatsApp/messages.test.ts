import { appGlobal } from "../../../../logic/app";
import { WhatsAppMessage } from "../../../../logic/Chat/WhatsApp/WhatsAppMessage";
import { WhatsAppChatRoom } from "../../../../logic/Chat/WhatsApp/WhatsAppChatRoom";
import { WhatsApp1to1ChatRoom } from "../../../../logic/Chat/WhatsApp/WhatsApp1to1ChatRoom";
import { WhatsAppGroupChatRoom } from "../../../../logic/Chat/WhatsApp/WhatsAppGroupChatRoom";
import { encodeWAMessage, decodeWAMessage, ProtocolMessageType, type WAMessage } from "../../../../logic/Chat/WhatsApp/Proto/schema";
import { MediaType, encryptMedia, decryptMedia } from "../../../../logic/Chat/WhatsApp/Crypto/mediaCrypto";
import { verifyAccountSignature, generateDeviceSignature, verifyDeviceIdentityHMAC }
  from "../../../../logic/Chat/WhatsApp/Crypto/adv";
import { WhatsAppContact } from "../../../../logic/Chat/WhatsApp/WhatsAppContact";
import { DummyChatStorage } from "../../../../logic/Chat/SQL/DummyChatStorage";
import { Attachment } from "../../../../logic/Abstract/Attachment";
import { JID } from "../../../../logic/Chat/WhatsApp/Binary/JID";
import { WANode } from "../../../../logic/Chat/WhatsApp/Binary/WANode";
import { KeyPair } from "../../../../logic/Chat/Signal/Crypto/KeyPair";
import { xeddsaSign, xeddsaVerify } from "../../../../logic/Chat/Signal/Crypto/curve";
import { randomBytes, hmacSHA256, concatBytes, bytesEqual } from "../../../../logic/Chat/Signal/Crypto/primitives";
import { expect, test } from "vitest";

let peer = JID.parse("412300000000@s.whatsapp.net");
/** Another device of our own account */
let ownPhone = JID.parse("491700000000:0@s.whatsapp.net");

/** A dummy account storage that supports attachments (so `newAttachment()` works)
 * but persists nothing. */
let storageStub = new DummyChatStorage();

/** Parses a payload into a WhatsAppMessage, exercising the protobuf schema
 * (encode→decode, like the wire) and the message's own interpretation. */
function parse(fields: WAMessage): WhatsAppMessage {
  let room = { contact: new WhatsAppContact(peer, "Alice"), account: { storage: storageStub } } as any;
  let message = new WhatsAppMessage(room);
  // The room unwraps before interpreting content; mirror that here.
  message.readContent(WhatsAppMessage.unwrap(decodeWAMessage(encodeWAMessage(fields))));
  return message;
}

test("plain text", () => {
  expect(parse({ conversation: "hello world" }).text).toBe("hello world");
});

test("extended text reply", () => {
  let m = parse({ extendedTextMessage: { text: "a reply", contextInfo: { stanzaID: "ORIG123" } } });
  expect(m.text).toBe("a reply");
  expect(m.inReplyTo).toBe("ORIG123");
});

test("image with caption and attachment", () => {
  let m = parse({ imageMessage: { mimetype: "image/jpeg", caption: "look", fileLength: 4096, mediaKey: randomBytes(32) } });
  expect(m.text).toBe("look");
  expect(m.attachments.first.mimeType).toBe("image/jpeg");
  expect(m.attachments.first.size).toBe(4096);
});

test("voice note, gif and sticker are represented for display", () => {
  let voice = parse({ audioMessage: { mimetype: "audio/ogg", PTT: true, seconds: 5, mediaKey: randomBytes(32) } });
  expect(voice.attachments.first.mimeType).toBe("audio/ogg");

  let gif = parse({ videoMessage: { mimetype: "video/mp4", gifPlayback: true, mediaKey: randomBytes(32) } });
  expect(gif.attachments.first.related).toBe(true); // renders inline

  let sticker = parse({ stickerMessage: { mimetype: "image/webp", isAnimated: true, mediaKey: randomBytes(32) } });
  expect(sticker.attachments.first.related).toBe(true);
});

test("unwraps device-sent and ephemeral wrappers", () => {
  let m = parse({ deviceSentMessage: { destinationJID: "1@s.whatsapp.net", message: { conversation: "from my other device" } } });
  expect(m.text).toBe("from my other device");
});

/** A room with a stubbed account, for testing the receive/dispatch path. */
function makeRoom(): WhatsAppChatRoom {
  let saved: any[] = [];
  let account = {
    storage: { saveMessage: async (m: any) => saved.push(m) },
    errorCallback: () => undefined,
    isOwnJID: (jid: JID) => jid.user == ownPhone.user,
    getOwnContact: async () => new WhatsAppContact(ownPhone, "Me"),
  } as any;
  let room = new WhatsApp1to1ChatRoom(account);
  room.contact = new WhatsAppContact(peer, "Alice") as any;
  return room;
}

test("a 1:1 room lists its partner as the sole member (ChatRoom.listMembers)", async () => {
  let room = makeRoom();
  await room.listMembers();
  expect(room.members.length).toBe(1);
  expect(room.members.first).toBe(room.contact);
});

function stanza(id: string): WANode {
  return new WANode("message", { id, from: peer.toString(), t: "1700000000" });
}

test("room stores an incoming message", async () => {
  let room = makeRoom();
  await room.receiveMessage(stanza("M1"), { conversation: "hi there" }, peer);
  expect(room.messages.length).toBe(1);
  expect(room.messages.first.text).toBe("hi there");
  expect(room.lastMessage?.id).toBe("M1");
  // duplicate id is ignored
  await room.receiveMessage(stanza("M1"), { conversation: "dup" }, peer);
  expect(room.messages.length).toBe(1);
});

test("room applies a reaction, then removes it", async () => {
  let room = makeRoom();
  await room.receiveMessage(stanza("M1"), { conversation: "hi" }, peer);
  let target = room.messages.first;
  await room.receiveMessage(stanza("R1"), { reactionMessage: { key: { id: "M1" }, text: "❤️" } }, peer);
  expect([...target.reactions.values()]).toContain("❤️");
  await room.receiveMessage(stanza("R2"), { reactionMessage: { key: { id: "M1" }, text: "" } }, peer);
  expect(target.reactions.size).toBe(0);
});

test("room edits and deletes a message", async () => {
  let room = makeRoom();
  await room.receiveMessage(stanza("M1"), { conversation: "original" }, peer);
  let target = room.messages.first;
  await room.receiveMessage(stanza("E1"),
    { protocolMessage: { type: ProtocolMessageType.MessageEdit, key: { id: "M1" }, editedMessage: { conversation: "edited" } } }, peer);
  expect(target.text).toBe("edited");
  await room.receiveMessage(stanza("D1"),
    { protocolMessage: { type: ProtocolMessageType.Revoke, key: { id: "M1" } } }, peer);
  expect(target.text).toBe("This message was deleted");
});

test("a revoke with no type field (REVOKE is the omitted protobuf default) still deletes", async () => {
  let room = makeRoom();
  await room.receiveMessage(stanza("M1"), { conversation: "secret" }, peer);
  let target = room.messages.first;
  // Real WhatsApp omits the enum value 0 (REVOKE) on the wire, so the decoded
  // protocolMessage has no `type` — we must still treat it as a delete.
  await room.receiveMessage(stanza("D1"), { protocolMessage: { key: { id: "M1" } } }, peer);
  expect(target.text).toBe("This message was deleted");
});

test("in a 1:1, only the author can edit or delete a message", async () => {
  let room = makeRoom();
  await room.receiveMessage(stanza("M1"), { conversation: "ours" }, ownPhone, true);
  let ours = room.messages.first;

  await room.receiveMessage(stanza("E1"),
    { protocolMessage: { type: ProtocolMessageType.MessageEdit, key: { id: "M1" }, editedMessage: { conversation: "changed by Alice" } } }, peer);
  await room.receiveMessage(stanza("D1"),
    { protocolMessage: { type: ProtocolMessageType.Revoke, key: { id: "M1" } } }, peer);
  expect(ours.text).toBe("ours");

  await room.receiveMessage(stanza("E2"),
    { protocolMessage: { type: ProtocolMessageType.MessageEdit, key: { id: "M1" }, editedMessage: { conversation: "edited" } } }, ownPhone, true);
  expect(ours.text).toBe("edited");
});

test("in a group, only the author can edit a message, and only the author or an admin delete it", async () => {
  let admin = JID.parse("111@lid");
  let bob = JID.parse("222:3@lid");
  let carol = JID.parse("333@lid");
  // The participants, as the server reports them when the room fetches its metadata
  let groupNode = new WANode("group", { id: "120363041234567890", subject: "Hikers", addressing_mode: "lid" }, [
    new WANode("participant", { jid: "111@lid", type: "admin" }),
    new WANode("participant", { jid: "222@lid" }),
    new WANode("participant", { jid: "333@lid" }),
  ]);
  let account = {
    storage: storageStub,
    errorCallback: () => undefined,
    isOwnJID: (jid: JID) => jid.user == ownPhone.user,
    getContact: (jid: JID) => new WhatsAppContact(jid),
    connection: { sendIQ: async () => new WANode("iq", { type: "result" }, [groupNode]) },
  } as any;
  let room = new WhatsAppGroupChatRoom(account);
  room.id = "120363041234567890@g.us";
  await room.receiveMessage(stanza("M1"), { conversation: "Bob's" }, bob);
  let message = room.messages.first;

  await room.receiveMessage(stanza("E1"),
    { protocolMessage: { type: ProtocolMessageType.MessageEdit, key: { id: "M1" }, editedMessage: { conversation: "changed by Carol" } } }, carol);
  await room.receiveMessage(stanza("D1"),
    { protocolMessage: { type: ProtocolMessageType.Revoke, key: { id: "M1" } } }, carol);
  await room.receiveMessage(stanza("E2"),
    { protocolMessage: { type: ProtocolMessageType.MessageEdit, key: { id: "M1" }, editedMessage: { conversation: "changed by the admin" } } }, admin);
  expect(message.text).toBe("Bob's");

  await room.receiveMessage(stanza("E3"),
    { protocolMessage: { type: ProtocolMessageType.MessageEdit, key: { id: "M1" }, editedMessage: { conversation: "Bob's, edited" } } }, bob);
  expect(message.text).toBe("Bob's, edited");
  await room.receiveMessage(stanza("D2"),
    { protocolMessage: { type: ProtocolMessageType.Revoke, key: { id: "M1" } } }, admin);
  expect(message.text).toBe("This message was deleted");
});

test("room sends files as media, with the text as the first file's caption", async () => {
  let sentMedia: Array<{ caption: string | undefined, filename: string }> = [];
  let account = {
    getOwnContact: async () => new WhatsAppContact(peer, "Me"),
    sender: {
      sendMedia: async (_chat: JID, attachment: any, caption?: string) => {
        sentMedia.push({ caption, filename: attachment.filename });
        return "MID" + sentMedia.length;
      },
      sendText: async () => { throw new Error("must not send a text message when there are attachments"); },
    },
    storage: storageStub,
  } as any;
  let room = new WhatsApp1to1ChatRoom(account);
  room.id = peer.toString();
  room.contact = new WhatsAppContact(peer, "Alice") as any;

  let message = room.newMessage();
  message.text = "here you go";
  for (let name of ["a.pdf", "b.png"]) {
    let attachment = message.newAttachment();
    attachment.filename = name;
    attachment.mimeType = name.endsWith(".png") ? "image/png" : "application/pdf";
    attachment.content = new File([new Uint8Array([1, 2, 3])], name);
    message.attachments.add(attachment);
  }
  await room.sendMessage(message);

  expect(sentMedia.map(m => m.filename)).toEqual(["a.pdf", "b.png"]);
  expect(sentMedia[0].caption).toBe("here you go"); // caption rides on the first file
  expect(sentMedia[1].caption).toBeUndefined(); // and is not repeated on the rest
  expect(message.id).toBe("MID2");
});

test("media encrypt/decrypt round-trips and detects tampering", async () => {
  let plaintext = randomBytes(5000);
  let mediaKey = randomBytes(32);
  let enc = await encryptMedia(plaintext, mediaKey, MediaType.Image);
  expect(bytesEqual(await decryptMedia(enc.enc, mediaKey, MediaType.Image, enc.fileEncSHA256), plaintext)).toBe(true);
  await expect(decryptMedia(enc.enc, randomBytes(32), MediaType.Image)).rejects.toThrow();
});

test("ADV pairing: account-signature verify and device-signature generation", () => {
  let primaryIdentity = KeyPair.generate();
  let companionIdentity = KeyPair.generate();
  let details = randomBytes(40);

  let accountSig = xeddsaSign(primaryIdentity.privateKey,
    concatBytes(new Uint8Array([6, 0]), details, companionIdentity.publicKey));
  expect(verifyAccountSignature(primaryIdentity.publicKey, details, companionIdentity.publicKey, accountSig)).toBe(true);
  expect(verifyAccountSignature(KeyPair.generate().publicKey, details, companionIdentity.publicKey, accountSig)).toBe(false);

  let deviceSig = generateDeviceSignature(companionIdentity.privateKey, details, companionIdentity.publicKey, primaryIdentity.publicKey);
  let expected = concatBytes(new Uint8Array([6, 1]), details, companionIdentity.publicKey, primaryIdentity.publicKey);
  expect(xeddsaVerify(companionIdentity.publicKey, expected, deviceSig)).toBe(true);

  let advSecret = randomBytes(32);
  let hmac = hmacSHA256(advSecret, details).subarray(0, 32);
  expect(verifyDeviceIdentityHMAC(advSecret, details, hmac)).toBe(true);
  expect(verifyDeviceIdentityHMAC(randomBytes(32), details, hmac)).toBe(false);
});
