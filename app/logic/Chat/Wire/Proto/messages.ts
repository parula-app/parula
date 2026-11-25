/** Wire's `GenericMessage` schema (`generic-message-proto` v1.56.0), in the
 * codec DSL from `Chat/Signal/Proto/codec.ts`. Each message reads top-to-bottom
 * like the `.proto`; the TypeScript types are inferred, so there is nothing to
 * keep in sync by hand.
 *
 * These bytes *are* the message payload of both transports: the Proteus
 * plaintext and, byte-identical, the MLS application data. No wrapper, no
 * content-type prefix.
 *
 * The schema is proto2, so every optional field has a declared default. Omit a
 * field rather than writing its default: on the wire the two are the same, and
 * an omitted field is smaller. `oneof` has no equivalent in the DSL, and needs
 * none — a `oneof` is just "at most one of these field numbers is present", so
 * its branches are plain optional fields here. Use `contentKind()` & co. to ask
 * which branch a decoded message took. */
import { message, string, bytes, int, bool, float, sub, repeated, type TypeOf } from "../../Signal/Proto/codec";

export let GenericMessage = message({
  messageID: string(1), // client-generated UUID; the only identity a message has
  text: sub(2, () => Text),
  image: sub(3, () => ImageAsset), // deprecated by `asset`, receive only
  knock: sub(4, () => Knock),
  lastRead: sub(6, () => LastRead), // field 5 was removed and does not exist
  cleared: sub(7, () => Cleared),
  external: sub(8, () => External),
  clientAction: int(9), // ClientAction
  calling: sub(10, () => Calling),
  asset: sub(11, () => Asset),
  hidden: sub(12, () => MessageHide),
  location: sub(13, () => Location),
  deleted: sub(14, () => MessageDelete),
  edited: sub(15, () => MessageEdit),
  confirmation: sub(16, () => Confirmation),
  reaction: sub(17, () => Reaction),
  ephemeral: sub(18, () => Ephemeral),
  availability: sub(19, () => Availability),
  composite: sub(20, () => Composite),
  buttonAction: sub(21, () => ButtonAction),
  buttonActionConfirmation: sub(22, () => ButtonActionConfirmation),
  dataTransfer: sub(23, () => DataTransfer),
  inCallEmoji: sub(24, () => InCallEmoji),
  unknownStrategy: int(25), // UnknownStrategy. Outside the oneof, so it may accompany any content.
  inCallHandRaise: sub(26, () => InCallHandRaise),
  multipart: sub(27, () => Multipart), // inside the oneof, despite the number being past 25 and 26
});
export type GenericMessage = TypeOf<typeof GenericMessage>;

/** How a receiver should treat a `content` branch it does not understand. */
export enum UnknownStrategy {
  Ignore = 0,
  DiscardAndWarn = 1,
  WarnUserAllowRetry = 2,
}

/** Which branch of `GenericMessage`'s `oneof content` this message carries.
 * `unknownStrategy` and `messageID` are not part of it. */
export function contentKind(msg: GenericMessage): GenericMessageContent | undefined {
  return oneofBranch(msg, genericMessageContents);
}

/** Which branch of `Ephemeral`'s `oneof content` the wrapper carries. */
export function ephemeralContentKind(ephemeral: Ephemeral): EphemeralContent | undefined {
  return oneofBranch(ephemeral, ephemeralContents);
}

/** Whether the asset is uploaded, or the upload was cancelled or failed. */
export function assetStatusKind(asset: Asset): AssetStatus | undefined {
  return oneofBranch(asset, assetStatuses);
}

let genericMessageContents = ["text", "image", "knock", "lastRead", "cleared", "external",
  "clientAction", "calling", "asset", "hidden", "location", "deleted", "edited", "confirmation",
  "reaction", "ephemeral", "availability", "composite", "buttonAction", "buttonActionConfirmation",
  "dataTransfer", "inCallEmoji", "inCallHandRaise", "multipart"] as const;
export type GenericMessageContent = typeof genericMessageContents[number];

let ephemeralContents = ["text", "image", "knock", "asset", "location"] as const;
export type EphemeralContent = typeof ephemeralContents[number];

let assetStatuses = ["notUploaded", "uploaded"] as const;
export type AssetStatus = typeof assetStatuses[number];

/** The set branch of a `oneof`, which the DSL models as plain optional fields.
 * A sender must set only one; a decoder that sees several takes the last one on
 * the wire, which for us is whichever the codec wrote into the object. */
function oneofBranch<T extends object, K extends keyof T>(msg: T, branches: readonly K[]): K | undefined {
  return branches.find(branch => msg[branch] !== undefined);
}

/** The message body. `content` is plain UTF-8: markdown syntax sits literally in
 * it and is rendered by the receiver. There is no rich text and no HTML field
 * anywhere in the protocol. */
export let Text = message({
  content: string(1),
  linkPreviews: repeated(sub(3, () => LinkPreview)), // field 2 is retired
  mentions: repeated(sub(4, () => Mention)),
  quote: sub(5, () => Quote), // ignored when this Text sits inside a MessageEdit
  expectsReadConfirmation: bool(6),
  legalHoldStatus: int(7), // LegalHoldStatus
});
export type Text = TypeOf<typeof Text>;

/** `start` and `length` count **UTF-16 code units** — the unit JS strings use,
 * so a non-BMP emoji is 2 and a combining accent is its own unit. Not bytes and
 * not code points. The `@` is part of the span, and spans may not overlap. */
export let Mention = message({
  start: int(1),
  length: int(2),
  userID: string(3), // deprecated; read this only if there is no qualifiedUserID
  qualifiedUserID: sub(4, () => QualifiedUserID),
});
export type Mention = TypeOf<typeof Mention>;

export let Quote = message({
  quotedMessageID: string(1),
  quotedMessageSHA256: bytes(2), // pre-image undocumented; safe to omit when sending
});
export type Quote = TypeOf<typeof Quote>;

export let LinkPreview = message({
  URL: string(1),
  URLOffset: int(2), // index of the URL in Text.content, in UTF-16 code units like Mention.start
  article: sub(3, () => Article), // deprecated by the flat fields below; still worth writing for old peers
  permanentURL: string(5), // field 4 does not exist
  title: string(6),
  summary: string(7),
  image: sub(8, () => Asset), // an uploaded thumbnail, not inline bytes
  tweet: sub(9, () => Tweet),
});
export type LinkPreview = TypeOf<typeof LinkPreview>;

export let Tweet = message({
  author: string(1),
  username: string(2),
});
export type Tweet = TypeOf<typeof Tweet>;

/** Deprecated by LinkPreview's flat fields 5-8. */
export let Article = message({
  permanentURL: string(1),
  title: string(2),
  summary: string(3),
  image: sub(4, () => Asset),
});
export type Article = TypeOf<typeof Article>;

/** A "ping". */
export let Knock = message({
  hotKnock: bool(1),
  expectsReadConfirmation: bool(2),
  legalHoldStatus: int(3), // LegalHoldStatus
});
export type Knock = TypeOf<typeof Knock>;

/** A file in Wire's asset store. The message carries only the metadata and the
 * key to decrypt the downloaded blob. */
export let Asset = message({
  original: sub(1, () => AssetOriginal),
  notUploaded: int(3), // AssetNotUploaded; oneof status with `uploaded`
  uploaded: sub(4, () => AssetRemoteData),
  preview: sub(5, () => AssetPreview), // field 2 was an older preview, removed
  expectsReadConfirmation: bool(6),
  legalHoldStatus: int(7), // LegalHoldStatus
});
export type Asset = TypeOf<typeof Asset>;

export enum AssetNotUploaded {
  Cancelled = 0,
  Failed = 1,
}

export let AssetOriginal = message({
  mimeType: string(1),
  size: int(2),
  name: string(3),
  image: sub(4, () => AssetImageMetaData), // oneof meta_data
  video: sub(5, () => AssetVideoMetaData),
  audio: sub(6, () => AssetAudioMetaData),
  source: string(7), // where the asset came from, e.g. a Giphy URL
  caption: string(8),
});
export type AssetOriginal = TypeOf<typeof AssetOriginal>;

/** Where to fetch the ciphertext and how to open it: download by
 * `assetDomain`/`assetID`/`assetToken`, check `sha256` over the ciphertext, then
 * AES-256-CBC-decrypt with `otrKey`, IV = the first 16 bytes. */
export let AssetRemoteData = message({
  otrKey: bytes(1),
  sha256: bytes(2),
  assetID: string(3),
  assetToken: string(5), // field 4 was the same token as bytes
  encryption: int(6), // EncryptionAlgorithm
  assetDomain: string(7),
});
export type AssetRemoteData = TypeOf<typeof AssetRemoteData>;

/** A smaller thumbnail of the asset, with its own upload and key. */
export let AssetPreview = message({
  mimeType: string(1),
  size: int(2),
  remote: sub(3, () => AssetRemoteData),
  image: sub(4, () => AssetImageMetaData), // oneof meta_data
});
export type AssetPreview = TypeOf<typeof AssetPreview>;

export let AssetImageMetaData = message({
  width: int(1),
  height: int(2),
  tag: string(3),
});
export type AssetImageMetaData = TypeOf<typeof AssetImageMetaData>;

export let AssetVideoMetaData = message({
  width: int(1),
  height: int(2),
  durationInMillis: int(3),
});
export type AssetVideoMetaData = TypeOf<typeof AssetVideoMetaData>;

export let AssetAudioMetaData = message({
  durationInMillis: int(1),
  normalizedLoudness: bytes(3), // one loudness value per byte, 0-255, chronological. Field 2 was a packed float array.
});
export type AssetAudioMetaData = TypeOf<typeof AssetAudioMetaData>;

/** The pre-2016 image message. Decode it for old peers; never send it. */
export let ImageAsset = message({
  tag: string(1),
  width: int(2),
  height: int(3),
  originalWidth: int(4),
  originalHeight: int(5),
  mimeType: string(6),
  size: int(7),
  otrKey: bytes(8),
  macKey: bytes(9), // deprecated by sha256
  mac: bytes(10), // deprecated by sha256
  sha256: bytes(11),
});
export type ImageAsset = TypeOf<typeof ImageAsset>;

/** Delete for everyone: sent into the conversation, and only the original
 * sender may send it (plus the recipient of an expired ephemeral). */
export let MessageDelete = message({
  messageID: string(1),
});
export type MessageDelete = TypeOf<typeof MessageDelete>;

/** Delete for me: sent to the self-conversation only, so it carries the target
 * conversation itself — the envelope cannot say which one it was. */
export let MessageHide = message({
  conversationID: string(1), // deprecated by qualifiedConversationID
  messageID: string(2),
  qualifiedConversationID: sub(3, () => QualifiedConversationID),
});
export type MessageHide = TypeOf<typeof MessageHide>;

/** The edit's `GenericMessage.messageID` is a *new* UUID; the edited message is
 * named by `replacingMessageID`, and the receiver re-keys its copy to the new
 * ID. Only text-like content can be edited, and `Text.quote` is ignored here. */
export let MessageEdit = message({
  replacingMessageID: string(1),
  text: sub(2, () => Text), // oneof content
  composite: sub(3, () => Composite),
  multipart: sub(4, () => Multipart),
});
export type MessageEdit = TypeOf<typeof MessageEdit>;

/** `emoji` is a comma-separated list of the sender's **entire current reaction
 * set** on that message — not a single emoji and not a delta. "👍,🎉" means the
 * sender now reacts with exactly those two; the empty string clears all of
 * theirs. So adding one emoji means resending the whole set, and a receiver must
 * drop all of that sender's previous reactions before applying it. */
export let Reaction = message({
  emoji: string(1),
  messageID: string(2),
  legalHoldStatus: int(3), // LegalHoldStatus
});
export type Reaction = TypeOf<typeof Reaction>;

/** A delivery or read receipt, acknowledging one or many messages at once. */
export let Confirmation = message({
  firstMessageID: string(1),
  type: int(2), // ConfirmationType
  moreMessageIDs: repeated(string(3)),
});
export type Confirmation = TypeOf<typeof Confirmation>;

export enum ConfirmationType {
  Delivered = 0,
  Read = 1,
}

/** Call signalling. `content` is a JSON string, opaque at this layer. */
export let Calling = message({
  content: string(1),
  qualifiedConversationID: sub(2, () => QualifiedConversationID),
});
export type Calling = TypeOf<typeof Calling>;

/** Self-conversation state: everything before `clearedTimestamp` is hidden. */
export let Cleared = message({
  conversationID: string(1), // deprecated by qualifiedConversationID
  clearedTimestamp: int(2),
  qualifiedConversationID: sub(3, () => QualifiedConversationID),
});
export type Cleared = TypeOf<typeof Cleared>;

/** Self-conversation state: the read marker of a conversation. */
export let LastRead = message({
  conversationID: string(1), // deprecated by qualifiedConversationID
  lastReadTimestamp: int(2),
  qualifiedConversationID: sub(3, () => QualifiedConversationID),
});
export type LastRead = TypeOf<typeof LastRead>;

export let Availability = message({
  type: int(1), // AvailabilityType
});
export type Availability = TypeOf<typeof Availability>;

export enum AvailabilityType {
  None = 0,
  Available = 1,
  Away = 2,
  Busy = 3,
}

/** Self-deleting messages are a wrapper, not a flag: build the normal message,
 * then move its content in here and keep the same `GenericMessage.messageID`.
 * The content set is narrower than `GenericMessage`'s — no reaction, receipt or
 * edit can be ephemeral. */
export let Ephemeral = message({
  expireAfterMillis: int(1),
  text: sub(2, () => Text), // oneof content
  image: sub(3, () => ImageAsset), // deprecated by `asset`
  knock: sub(4, () => Knock),
  asset: sub(5, () => Asset),
  location: sub(6, () => Location),
});
export type Ephemeral = TypeOf<typeof Ephemeral>;

/** Text plus buttons, for bot polls. */
export let Composite = message({
  items: repeated(sub(1, () => CompositeItem)),
  expectsReadConfirmation: bool(2),
  legalHoldStatus: int(3), // LegalHoldStatus
});
export type Composite = TypeOf<typeof Composite>;

export let CompositeItem = message({
  text: sub(1, () => Text), // oneof content
  button: sub(2, () => Button),
});
export type CompositeItem = TypeOf<typeof CompositeItem>;

export let Button = message({
  text: string(1),
  ID: string(2),
});
export type Button = TypeOf<typeof Button>;

/** The user pressed a button of a Composite. */
export let ButtonAction = message({
  buttonID: string(1),
  referenceMessageID: string(2),
});
export type ButtonAction = TypeOf<typeof ButtonAction>;

/** The bot's answer: which button now counts as pressed, if any. */
export let ButtonActionConfirmation = message({
  referenceMessageID: string(1),
  buttonID: string(2), // absent means no button is accepted
});
export type ButtonActionConfirmation = TypeOf<typeof ButtonActionConfirmation>;

/** Syncs the analytics identity between the devices of one user. */
export let DataTransfer = message({
  trackingIdentifier: sub(1, () => TrackingIdentifier),
});
export type DataTransfer = TypeOf<typeof DataTransfer>;

export let TrackingIdentifier = message({
  identifier: string(1),
});
export type TrackingIdentifier = TypeOf<typeof TrackingIdentifier>;

export let Location = message({
  longitude: float(1), // the only floats in the whole schema
  latitude: float(2),
  name: string(3),
  zoom: int(4), // Google Maps zoom level
  expectsReadConfirmation: bool(5),
  legalHoldStatus: int(6), // LegalHoldStatus
});
export type Location = TypeOf<typeof Location>;

/** A payload too big to encrypt once per recipient device: the real
 * `GenericMessage` is AES-256-CBC-encrypted once into the transport envelope's
 * `blob`, and only this key travels per device. `sha256` covers the ciphertext
 * including its prepended IV. Proteus only — MLS has no `blob` and no need.
 * Receive it; there is no reason for us to send it. */
export let External = message({
  otrKey: bytes(1),
  sha256: bytes(2),
  encryption: int(3), // EncryptionAlgorithm
});
export type External = TypeOf<typeof External>;

/** Text with attached files, from the "Cells" file storage. */
export let Multipart = message({
  text: sub(1, () => Text),
  attachments: repeated(sub(2, () => Attachment)),
  expectsReadConfirmation: bool(3),
  legalHoldStatus: int(4), // LegalHoldStatus
});
export type Multipart = TypeOf<typeof Multipart>;

export let Attachment = message({
  asset: sub(1, () => Asset), // oneof content
  cellAsset: sub(2, () => CellAsset),
});
export type Attachment = TypeOf<typeof Attachment>;

/** A file in a conversation cell. Its metadata is only for optimistic display;
 * the file may have changed since it was posted. */
export let CellAsset = message({
  UUID: string(1), // the backend's reference to the file
  contentType: string(2),
  initialName: string(3),
  initialSize: int(4),
  image: sub(5, () => CellAssetImageMetaData), // oneof initial_meta_data
  video: sub(6, () => CellAssetVideoMetaData),
  audio: sub(7, () => CellAssetAudioMetaData),
});
export type CellAsset = TypeOf<typeof CellAsset>;

export let CellAssetImageMetaData = message({
  width: int(1),
  height: int(2),
});
export type CellAssetImageMetaData = TypeOf<typeof CellAssetImageMetaData>;

export let CellAssetVideoMetaData = message({
  width: int(1),
  height: int(2),
  durationInMillis: int(3),
});
export type CellAssetVideoMetaData = TypeOf<typeof CellAssetVideoMetaData>;

export let CellAssetAudioMetaData = message({
  durationInMillis: int(1),
  normalizedLoudness: bytes(2), // field 2 here, but 3 in AssetAudioMetaData
});
export type CellAssetAudioMetaData = TypeOf<typeof CellAssetAudioMetaData>;

/** Emoji thrown during a call. The proto declares a `map<string, int32>`, which
 * on the wire is this repeated key/value pair. */
export let InCallEmoji = message({
  emojis: repeated(sub(1, () => InCallEmojiEntry)),
});
export type InCallEmoji = TypeOf<typeof InCallEmoji>;

export let InCallEmojiEntry = message({
  key: string(1), // the emoji
  value: int(2), // how many times it was thrown
});
export type InCallEmojiEntry = TypeOf<typeof InCallEmojiEntry>;

export let InCallHandRaise = message({
  isHandUp: bool(1),
});
export type InCallHandRaise = TypeOf<typeof InCallHandRaise>;

export let QualifiedUserID = message({
  ID: string(1),
  domain: string(2),
});
export type QualifiedUserID = TypeOf<typeof QualifiedUserID>;

export let QualifiedConversationID = message({
  ID: string(1),
  domain: string(2),
});
export type QualifiedConversationID = TypeOf<typeof QualifiedConversationID>;

/** `GenericMessage.clientAction`. Meaningful for Proteus only: MLS has no
 * pairwise sessions to reset. */
export enum ClientAction {
  ResetSession = 0,
}

/** Only AES-CBC is used in practice. */
export enum EncryptionAlgorithm {
  AESCBC = 0,
  AESGCM = 1,
}

export enum LegalHoldStatus {
  Unknown = 0,
  Disabled = 1,
  Enabled = 2,
}
