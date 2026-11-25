import { encode, decode } from "../../../../logic/Chat/Signal/Proto/codec";
import {
  GenericMessage, Text, Asset, Reaction, Location, contentKind, ephemeralContentKind,
  assetStatusKind, AssetNotUploaded, AvailabilityType, ClientAction, ConfirmationType,
  EncryptionAlgorithm, UnknownStrategy,
} from "../../../../logic/Chat/Wire/Proto/messages";
import { expect, test } from "vitest";

function hex(data: Uint8Array): string {
  return [...data].map(b => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

function roundtrip(msg: GenericMessage): GenericMessage {
  return decode(GenericMessage, encode(GenericMessage, msg));
}

test("a simple text message is exactly these bytes", () => {
  let msg: GenericMessage = { messageID: "id", text: { content: "hi" } };
  // message_id = 1 (string) -> 0A, then Text = 2 (message) -> 12, whose content = 1 -> 0A
  expect(hex(encode(GenericMessage, msg))).toBe("0A 02 69 64 12 04 0A 02 68 69");
});

test("every content branch sits at the tag byte the spec table gives", () => {
  let tags: [keyof GenericMessage, any, string][] = [
    ["text", {}, "12"],
    ["image", {}, "1A"],
    ["knock", {}, "22"],
    ["lastRead", {}, "32"], // field 5 is skipped: it does not exist
    ["cleared", {}, "3A"],
    ["external", {}, "42"],
    ["clientAction", ClientAction.ResetSession, "48"],
    ["calling", {}, "52"],
    ["asset", {}, "5A"],
    ["hidden", {}, "62"],
    ["location", {}, "6A"],
    ["deleted", {}, "72"],
    ["edited", {}, "7A"],
    ["confirmation", {}, "82 01"],
    ["reaction", {}, "8A 01"],
    ["ephemeral", {}, "92 01"],
    ["availability", {}, "9A 01"],
    ["composite", {}, "A2 01"],
    ["buttonAction", {}, "AA 01"],
    ["buttonActionConfirmation", {}, "B2 01"],
    ["dataTransfer", {}, "BA 01"],
    ["inCallEmoji", {}, "C2 01"],
    ["unknownStrategy", UnknownStrategy.Ignore, "C8 01"],
    ["inCallHandRaise", {}, "D2 01"],
    ["multipart", {}, "DA 01"],
  ];
  for (let [field, value, tag] of tags) {
    expect(hex(encode(GenericMessage, { [field]: value } as GenericMessage))).toBe(tag + " 00");
  }
});

test("text with mentions, a quote and a link preview round-trips", () => {
  let msg: GenericMessage = {
    messageID: "4f5c1e2a-0000-4000-8000-000000000001",
    text: {
      content: "@Alice look at **this**: https://example.com/x",
      mentions: [{
        start: 0,
        length: 6,
        userID: "a1b2c3d4-0000-4000-8000-000000000002",
        qualifiedUserID: { ID: "a1b2c3d4-0000-4000-8000-000000000002", domain: "wire.com" },
      }],
      quote: {
        quotedMessageID: "4f5c1e2a-0000-4000-8000-000000000000",
        quotedMessageSHA256: new Uint8Array([1, 2, 3, 4]),
      },
      linkPreviews: [{
        URL: "https://example.com/x",
        URLOffset: 24,
        permanentURL: "https://example.com/x",
        title: "Example",
        summary: "An example page",
      }],
      expectsReadConfirmation: true,
    },
  };
  let back = roundtrip(msg);
  expect(contentKind(back)).toBe("text");
  expect(back.messageID).toBe(msg.messageID);
  let text = back.text!;
  expect(text.content).toBe(msg.text!.content);
  expect(text.expectsReadConfirmation).toBe(true);
  expect(text.mentions!.length).toBe(1);
  expect(text.mentions![0].start).toBe(0);
  expect(text.mentions![0].length).toBe(6);
  expect(text.mentions![0].userID).toBe(msg.text!.mentions![0].userID);
  expect(text.mentions![0].qualifiedUserID!.domain).toBe("wire.com");
  expect(text.quote!.quotedMessageID).toBe(msg.text!.quote!.quotedMessageID);
  expect([...text.quote!.quotedMessageSHA256!]).toEqual([1, 2, 3, 4]);
  expect(text.linkPreviews![0].URL).toBe("https://example.com/x");
  expect(text.linkPreviews![0].URLOffset).toBe(24);
  expect(text.linkPreviews![0].title).toBe("Example");
  // Markdown stays literal; there is no HTML anywhere in the protocol.
  expect(text.content).toContain("**this**");
});

test("mention offsets count UTF-16 code units, not bytes or code points", () => {
  let content = "🎉 @Alice party"; // the party popper is a surrogate pair, i.e. 2 code units
  let start = content.indexOf("@");
  expect(start).toBe(3);
  expect([...content].indexOf("@")).toBe(2); // a code-point offset would say 2
  expect(new TextEncoder().encode(content).indexOf("@".charCodeAt(0))).toBe(5); // a byte offset would say 5

  let back = roundtrip({
    messageID: "m1",
    text: { content, mentions: [{ start, length: 6, qualifiedUserID: { ID: "u1", domain: "wire.com" } }] },
  });
  let mention = back.text!.mentions![0];
  expect(mention.start).toBe(3);
  expect(back.text!.content.slice(mention.start, mention.start + mention.length)).toBe("@Alice");
  expect(back.text!.content.length).toBe(15); // JS string length is UTF-16 code units, the same unit
});

test("Reaction.emoji is the sender's whole current set, comma-separated", () => {
  let both = roundtrip({ messageID: "m2", reaction: { emoji: "👍,🎉", messageID: "target" } });
  expect(contentKind(both)).toBe("reaction");
  expect(both.reaction!.emoji!.split(",")).toEqual(["👍", "🎉"]);
  expect(both.reaction!.messageID).toBe("target");

  // Not a delta: removing 🎉 means resending the remaining set, not the removed emoji.
  let one = roundtrip({ messageID: "m3", reaction: { emoji: "👍", messageID: "target" } });
  expect(one.reaction!.emoji!.split(",")).toEqual(["👍"]);

  // The empty string clears all of the sender's reactions, and must survive as "".
  let cleared = roundtrip({ messageID: "m4", reaction: { emoji: "", messageID: "target" } });
  expect(cleared.reaction!.emoji).toBe("");
  expect(cleared.reaction!.emoji!.split(",").filter(emoji => !!emoji)).toEqual([]);
  expect(hex(encode(Reaction, { emoji: "", messageID: "t" }))).toBe("0A 00 12 01 74");
});

test("an uploaded asset round-trips with its metadata and keys", () => {
  let otrKey = new Uint8Array(32).fill(7);
  let sha256 = new Uint8Array(32).fill(9);
  let msg: GenericMessage = {
    messageID: "m5",
    asset: {
      original: {
        mimeType: "image/jpeg",
        size: 123456,
        name: "cat.jpg",
        image: { width: 1920, height: 1080, tag: "medium" },
        caption: "dog",
      },
      uploaded: {
        otrKey,
        sha256,
        assetID: "3-1-abcdef",
        assetToken: "tok",
        encryption: EncryptionAlgorithm.AESCBC,
        assetDomain: "wire.com",
      },
      preview: {
        mimeType: "image/jpeg",
        size: 4096,
        remote: { otrKey, sha256, assetID: "3-1-preview" },
        image: { width: 192, height: 108 },
      },
      expectsReadConfirmation: true,
    },
  };
  let back = roundtrip(msg);
  expect(contentKind(back)).toBe("asset");
  expect(assetStatusKind(back.asset!)).toBe("uploaded");
  expect(back.asset!.original!.mimeType).toBe("image/jpeg");
  expect(back.asset!.original!.size).toBe(123456);
  expect(back.asset!.original!.name).toBe("cat.jpg");
  expect(back.asset!.original!.image!.width).toBe(1920);
  expect(back.asset!.original!.caption).toBe("dog");
  expect([...back.asset!.uploaded!.otrKey!]).toEqual([...otrKey]);
  expect([...back.asset!.uploaded!.sha256!]).toEqual([...sha256]);
  expect(back.asset!.uploaded!.assetID).toBe("3-1-abcdef");
  expect(back.asset!.uploaded!.assetToken).toBe("tok");
  expect(back.asset!.uploaded!.assetDomain).toBe("wire.com");
  expect(back.asset!.uploaded!.encryption).toBe(EncryptionAlgorithm.AESCBC);
  expect(back.asset!.preview!.remote!.assetID).toBe("3-1-preview");
  expect(back.asset!.preview!.image!.height).toBe(108);
  expect(back.asset!.expectsReadConfirmation).toBe(true);
});

test("a failed upload is the other branch of the asset status", () => {
  let back = roundtrip({
    messageID: "m6",
    asset: { original: { mimeType: "video/mp4", size: 1 }, notUploaded: AssetNotUploaded.Failed },
  });
  expect(assetStatusKind(back.asset!)).toBe("notUploaded");
  expect(back.asset!.notUploaded).toBe(AssetNotUploaded.Failed);
  expect(back.asset!.uploaded).toBe(undefined);
});

test("audio and video metadata keep their own field numbers", () => {
  let back = roundtrip({
    messageID: "m7",
    asset: {
      original: {
        mimeType: "audio/mp4", size: 900,
        audio: { durationInMillis: 12_000, normalizedLoudness: new Uint8Array([0, 128, 255]) },
      },
    },
  });
  expect(back.asset!.original!.audio!.durationInMillis).toBe(12_000);
  expect([...back.asset!.original!.audio!.normalizedLoudness!]).toEqual([0, 128, 255]);
  // normalized_loudness is field 3, because field 2 was the retired packed float array
  expect(hex(encode(Asset, { original: { audio: { normalizedLoudness: new Uint8Array([1]) } } })))
    .toBe("0A 05 32 03 1A 01 01");
});

test("delete-for-everyone and delete-for-me are different messages", () => {
  let deleted = roundtrip({ messageID: "m8", deleted: { messageID: "target" } });
  expect(contentKind(deleted)).toBe("deleted");
  expect(deleted.deleted!.messageID).toBe("target");

  // MessageHide goes to the self-conversation, so it must name the real one itself.
  let hidden = roundtrip({
    messageID: "m9",
    hidden: {
      conversationID: "conv-1",
      messageID: "target",
      qualifiedConversationID: { ID: "conv-1", domain: "wire.com" },
    },
  });
  expect(contentKind(hidden)).toBe("hidden");
  expect(hidden.hidden!.messageID).toBe("target");
  expect(hidden.hidden!.qualifiedConversationID!.ID).toBe("conv-1");
  expect(hidden.hidden!.qualifiedConversationID!.domain).toBe("wire.com");
});

test("an edit carries a new message ID and names the replaced one", () => {
  let back = roundtrip({
    messageID: "new-id",
    edited: { replacingMessageID: "old-id", text: { content: "fixed typo" } },
  });
  expect(contentKind(back)).toBe("edited");
  expect(back.messageID).toBe("new-id");
  expect(back.edited!.replacingMessageID).toBe("old-id");
  expect(back.edited!.text!.content).toBe("fixed typo");
});

test("a confirmation acknowledges several messages at once", () => {
  let back = roundtrip({
    messageID: "m10",
    confirmation: {
      firstMessageID: "one",
      type: ConfirmationType.Read,
      moreMessageIDs: ["two", "three"],
    },
  });
  expect(contentKind(back)).toBe("confirmation");
  expect(back.confirmation!.type).toBe(ConfirmationType.Read);
  expect(back.confirmation!.firstMessageID).toBe("one");
  expect(back.confirmation!.moreMessageIDs).toEqual(["two", "three"]);
});

test("delivery confirmations use type 0, which must still reach the wire", () => {
  let back = roundtrip({
    messageID: "m11",
    confirmation: { firstMessageID: "one", type: ConfirmationType.Delivered },
  });
  expect(back.confirmation!.type).toBe(ConfirmationType.Delivered);
});

test("ephemeral wraps the content and keeps the original message ID", () => {
  let plain: GenericMessage = { messageID: "m12", text: { content: "self-destructs" } };
  let ephemeral: GenericMessage = {
    messageID: plain.messageID,
    ephemeral: { expireAfterMillis: 10_000, text: plain.text },
  };
  let back = roundtrip(ephemeral);
  expect(contentKind(back)).toBe("ephemeral");
  expect(back.messageID).toBe("m12");
  expect(ephemeralContentKind(back.ephemeral!)).toBe("text");
  expect(back.ephemeral!.expireAfterMillis).toBe(10_000);
  expect(back.ephemeral!.text!.content).toBe("self-destructs");
  // The inner Text is the same message type, so its bytes are the unwrapped ones.
  expect(hex(encode(Text, back.ephemeral!.text!))).toBe(hex(encode(Text, plain.text!)));
});

test("a four-week ephemeral timer stays exact", () => {
  let back = roundtrip({ messageID: "m13", ephemeral: { expireAfterMillis: 4 * 7 * 24 * 3600_000 } });
  expect(back.ephemeral!.expireAfterMillis).toBe(2_419_200_000);
});

test("unknownStrategy sits outside the oneof and rides along with content", () => {
  let back = roundtrip({
    messageID: "m14",
    text: { content: "hello" },
    unknownStrategy: UnknownStrategy.WarnUserAllowRetry,
  });
  expect(contentKind(back)).toBe("text");
  expect(back.unknownStrategy).toBe(UnknownStrategy.WarnUserAllowRetry);
});

test("the self-conversation state messages round-trip", () => {
  let lastRead = roundtrip({
    messageID: "m15",
    lastRead: {
      conversationID: "conv-1",
      lastReadTimestamp: 1_718_000_000_000,
      qualifiedConversationID: { ID: "conv-1", domain: "wire.com" },
    },
  });
  expect(contentKind(lastRead)).toBe("lastRead");
  expect(lastRead.lastRead!.lastReadTimestamp).toBe(1_718_000_000_000);
  expect(lastRead.lastRead!.qualifiedConversationID!.ID).toBe("conv-1");

  let cleared = roundtrip({
    messageID: "m16",
    cleared: { conversationID: "conv-1", clearedTimestamp: 1_718_000_000_001 },
  });
  expect(contentKind(cleared)).toBe("cleared");
  expect(cleared.cleared!.clearedTimestamp).toBe(1_718_000_000_001);
});

test("knock, availability and client action round-trip", () => {
  let knock = roundtrip({ messageID: "m17", knock: { hotKnock: true, expectsReadConfirmation: true } });
  expect(contentKind(knock)).toBe("knock");
  expect(knock.knock!.hotKnock).toBe(true);

  let availability = roundtrip({ messageID: "m18", availability: { type: AvailabilityType.Busy } });
  expect(contentKind(availability)).toBe("availability");
  expect(availability.availability!.type).toBe(AvailabilityType.Busy);

  let action = roundtrip({ messageID: "m19", clientAction: ClientAction.ResetSession });
  expect(contentKind(action)).toBe("clientAction");
  expect(action.clientAction).toBe(ClientAction.ResetSession);
});

test("calling, external and data transfer round-trip", () => {
  let calling = roundtrip({
    messageID: "m20",
    calling: { content: '{"type":"SETUP"}', qualifiedConversationID: { ID: "conv-1", domain: "wire.com" } },
  });
  expect(contentKind(calling)).toBe("calling");
  expect(JSON.parse(calling.calling!.content!).type).toBe("SETUP");

  let external = roundtrip({
    messageID: "m21",
    external: {
      otrKey: new Uint8Array(32).fill(3),
      sha256: new Uint8Array(32).fill(4),
      encryption: EncryptionAlgorithm.AESCBC,
    },
  });
  expect(contentKind(external)).toBe("external");
  expect(external.external!.otrKey!.length).toBe(32);

  let transfer = roundtrip({ messageID: "m22", dataTransfer: { trackingIdentifier: { identifier: "abc" } } });
  expect(transfer.dataTransfer!.trackingIdentifier!.identifier).toBe("abc");
});

test("a composite and its button action round-trip", () => {
  let composite = roundtrip({
    messageID: "m23",
    composite: {
      items: [{ text: { content: "Pick one" } }, { button: { text: "Yes", ID: "b1" } }],
    },
  });
  expect(contentKind(composite)).toBe("composite");
  expect(composite.composite!.items![0].text!.content).toBe("Pick one");
  expect(composite.composite!.items![1].button!.ID).toBe("b1");

  let action = roundtrip({ messageID: "m24", buttonAction: { buttonID: "b1", referenceMessageID: "m23" } });
  expect(action.buttonAction!.buttonID).toBe("b1");
  let confirmation = roundtrip({
    messageID: "m25",
    buttonActionConfirmation: { referenceMessageID: "m23", buttonID: "b1" },
  });
  expect(confirmation.buttonActionConfirmation!.buttonID).toBe("b1");
});

test("a location round-trips through its 32-bit floats", () => {
  let back = roundtrip({
    messageID: "m26",
    location: { longitude: 13.404954, latitude: 52.520008, name: "Berlin", zoom: 14 },
  });
  expect(contentKind(back)).toBe("location");
  expect(back.location!.longitude).toBeCloseTo(13.404954, 4);
  expect(back.location!.latitude).toBeCloseTo(52.520008, 4);
  expect(back.location!.name).toBe("Berlin");
  expect(back.location!.zoom).toBe(14);
  // float is wire type 5, so the key byte is (1 << 3) | 5 and the value is 4 bytes
  expect(hex(encode(Location, { longitude: 1 }))).toBe("0D 00 00 80 3F");
});

test("the legacy ImageAsset still decodes, for old peers", () => {
  let back = roundtrip({
    messageID: "m27",
    image: {
      tag: "medium", width: 640, height: 480, originalWidth: 1280, originalHeight: 960,
      mimeType: "image/jpeg", size: 50_000, otrKey: new Uint8Array(32).fill(1),
      sha256: new Uint8Array(32).fill(2),
    },
  });
  expect(contentKind(back)).toBe("image");
  expect(back.image!.originalHeight).toBe(960);
  expect(back.image!.mimeType).toBe("image/jpeg");
});

test("contentKind is undefined when there is no content", () => {
  expect(contentKind(decode(GenericMessage, encode(GenericMessage, { messageID: "m28" })))).toBe(undefined);
});
