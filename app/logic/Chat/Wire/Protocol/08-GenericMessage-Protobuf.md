# Wire protocol, part 8: the `GenericMessage` protobuf

This is the **payload format** of every Wire message. It is protocol-agnostic:
the exact same serialised bytes are the plaintext for Proteus (per-device
encryption, see `09-Proteus.md`) and the application-message content for MLS
(see the MLS document). Nothing above the encryption layer differs between the
two transports.

## 1. Where the schema lives

The canonical schema is the standalone repository **`wireapp/generic-message-proto`**.

* It is a git submodule of wire-server at
  `wire-server/libs/wire-message-proto-lens/generic-message-proto`
  (declared in `wire-server/.gitmodules:1-3`). In our reference clone that
  submodule is **not checked out** (the directory is empty), so the schema was
  obtained by cloning `https://github.com/wireapp/generic-message-proto` at tag
  `v1.56.0` — the exact version wire-webapp depends on
  (`wire-webapp/libraries/core/package.json:34`: `"@wireapp/protocol-messaging": "1.56.0"`).
* The repo contains three files: `proto/messages.proto` (this document),
  `proto/otr.proto` (Proteus transport, reproduced in `09-Proteus.md`) and
  `proto/mls.proto` (MLS commit bundles).
* Citations below of the form `generic-message-proto/proto/messages.proto:NN`
  refer to that v1.56.0 checkout.

### Language / codegen used by the official clients

| Client | Library |
|---|---|
| Web / TypeScript | `protobufjs` 7.2.5, compiled into a *static module* (`generic-message-proto/package.json` dependencies, `main: "web/messages.js"`) |
| iOS | SwiftProtobuf — checked-in `generic-message-proto/ios/messages.pb.swift` |
| Android | protoc via `generic-message-proto/android/build.sbt` |
| Backend (Haskell) | `proto-lens` via `wire-server/libs/wire-message-proto-lens` |

We will **hand-write a codec**, so section 4 gives the exact field numbers and
wire types. Nothing in the schema needs a full protobuf runtime: there are no
`packed` repeated scalars in the messages a chat client cares about, one `map`
(`InCallEmoji.emojis`), and no groups.

## 2. Wire-format basics you must respect

* `syntax = "proto2"` (`messages.proto:20`). This matters:
  * `required` fields exist. The official clients *will* fail to parse a message
    that omits one (protobufjs static modules throw on a missing required field
    at `verify()` time; the Haskell `proto-lens` decoder errors out).
  * `optional` fields have **explicit defaults** declared in the schema
    (e.g. `expects_read_confirmation = false`, `legal_hold_status = UNKNOWN`,
    `unknownStrategy = IGNORE`). An absent field means "the default", it is not
    distinguishable from an explicitly-set default on the wire, and you should
    simply omit fields whose value equals the default.
  * `oneof` is a normal protobuf `oneof` (proto2 supports it). On the wire it is
    just "at most one of these field numbers is present". A decoder must treat a
    later occurrence as overriding an earlier one.
* `option optimize_for = LITE_RUNTIME` — no reflection, no descriptors. Only the
  binary encoding is used; there is no JSON or text-format variant anywhere in
  the Wire stack.
* Field key = `(field_number << 3) | wire_type`, encoded as a varint. Wire types
  used here: `0` = varint (`int32`, `int64`, `uint64`, `bool`, enums),
  `2` = length-delimited (`string`, `bytes`, nested messages, `map` entries),
  `5` = 32-bit (`float`, used only by `Location.longitude/latitude`).

## 3. `messages.proto` — full schema, verbatim (v1.56.0)

```proto
syntax = "proto2";

option java_package = "com.waz.model";
option optimize_for = LITE_RUNTIME;

message GenericMessage {
  required string message_id = 1; // client generated random id, preferably UUID
  oneof content {
    Text text = 2;
    ImageAsset image = 3; // deprecated in favour of Asset
    Knock knock = 4;
    LastRead lastRead = 6;
    Cleared cleared = 7;
    External external = 8;
    ClientAction clientAction = 9;
    Calling calling = 10;
    Asset asset = 11;
    Multipart multipart = 27;
    MessageHide hidden = 12;
    Location location = 13;
    MessageDelete deleted = 14;
    MessageEdit edited = 15;
    Confirmation confirmation = 16;
    Reaction reaction = 17;
    Ephemeral ephemeral = 18;
    Availability availability = 19;
    Composite composite = 20;
    ButtonAction buttonAction = 21;
    ButtonActionConfirmation buttonActionConfirmation = 22;
    DataTransfer dataTransfer = 23; // client-side synchronization across devices of the same user
    InCallEmoji inCallEmoji = 24;
    // UnknownStrategy unknownStrategy = 25; -- Defined outside the oneof
    // Next field should be 26 ↓
    InCallHandRaise inCallHandRaise = 26;
  }
  optional UnknownStrategy unknownStrategy = 25 [default = IGNORE];

  // See internal RFC: "2024-07-18 RFC Improve future-proofing for new OTR message types"
  enum UnknownStrategy {
    IGNORE = 0;                 // Ignore the message completely. Trash. Bye
    DISCARD_AND_WARN = 1;       // Warn the user, but discard the message, as it won't be helpful in the future.
    WARN_USER_ALLOW_RETRY = 2;  // Warn the user. Client has freedom to store it and retry in the future.
  }
}

message QualifiedUserId {
  required string id     = 1;
  required string domain = 2;
}

message QualifiedConversationId {
  required string id = 1;
  required string domain = 2;
}

message Composite {
  repeated Item items = 1;
  optional bool expects_read_confirmation = 2 [default = false];
  optional LegalHoldStatus legal_hold_status = 3 [default = UNKNOWN];

  message Item {
      oneof content {
          Text text = 1;
          Button button = 2;
      }
  }
}

message Button {
  required string text = 1;
  required string id = 2;
}

message ButtonAction {
  required string button_id = 1;
  required string reference_message_id = 2;
}

message ButtonActionConfirmation {
  required string reference_message_id = 1;
  optional string button_id = 2; // if not present, no button is accepted
}

message Availability {
  enum Type {
    NONE = 0;
    AVAILABLE = 1;
    AWAY = 2;
    BUSY = 3;
  }

  required Type type = 1;
}

message Ephemeral {
  required int64 expire_after_millis = 1;
  oneof content {
    Text text = 2;
    ImageAsset image = 3; // deprecated in favour of Asset
    Knock knock = 4;
    Asset asset = 5;
    Location location = 6;
  }
}

message Text {
  required string content = 1;
  // reserved 2; // reserved keyword is not available in older protoc versions
  repeated LinkPreview link_preview = 3;
  repeated Mention mentions = 4;
  optional Quote quote = 5; // if this Text is part of a MessageEdit, this field is ignored
  optional bool expects_read_confirmation = 6 [default = false]; // whether the sender is expecting to receive a read confirmation
  optional LegalHoldStatus legal_hold_status = 7 [default = UNKNOWN]; // whether this message was sent to legal hold
}

message Knock {
  required bool hot_knock = 1 [default = false];
  optional bool expects_read_confirmation = 2 [default = false]; // whether the sender is expecting to receive a read confirmation
  optional LegalHoldStatus legal_hold_status = 3 [default = UNKNOWN]; // whether this message was sent to legal hold
}

message LinkPreview {
  required string url = 1;
  required int32 url_offset = 2; // url offset from beginning of text message

  oneof preview {
    Article article = 3; // deprecated - use meta_data
  }

  optional string permanent_url = 5;
  optional string title = 6;
  optional string summary = 7;
  optional Asset image = 8;

  oneof meta_data {
    Tweet tweet = 9;
  }
}

message Tweet {
  optional string author = 1;
  optional string username = 2;
}

// deprecated - use the additional fields in LinkPreview
message Article {
  required string permanent_url = 1;
  optional string title = 2;
  optional string summary = 3;
  optional Asset image = 4;
}

message Mention {
  required int32 start = 1; // offset from beginning of the message counting in utf16 characters
  required int32 length = 2;
  oneof mention_type {
    // deprecated. Should be set such that old clients always fail when looking
    // up the user. Ideally, this should not be a problem, as a non-federation
    // aware user should never be part of a federated conversation.
    string user_id = 3;
  }
  // only optional to maintain backwards compatibility.
  optional QualifiedUserId qualified_user_id = 4;
}

message LastRead {
  // deprecated. Should be set such that old clients always fail when looking up
  // the conversation.
  required string conversation_id = 1;
  required int64 last_read_timestamp = 2;
  // only optional to maintain backwards compatibility
  optional QualifiedConversationId qualified_conversation_id = 3;
}

message Cleared {
  // deprecated. Should be set such that old clients always fail when looking up
  // the conversation.
  required string conversation_id = 1;
  required int64 cleared_timestamp = 2;
  // only optional to maintain backwards compatibility
  optional QualifiedConversationId qualified_conversation_id = 3;
}

message MessageHide {
  // deprecated. Should be set such that old clients always fail when looking up
  // the conversation.
  required string conversation_id = 1;
  required string message_id = 2;
  // only optional to maintain backwards compatibility
  optional QualifiedConversationId qualified_conversation_id = 3;
}

message MessageDelete {
  required string message_id = 1;
}

message MessageEdit {
  required string replacing_message_id = 1;
  oneof content {
    Text text = 2;
    Composite composite = 3;
    Multipart multipart = 4;
  }
}

message Quote {
  required string quoted_message_id = 1;
  optional bytes quoted_message_sha256 = 2;
}

message Confirmation {
  enum Type {
    DELIVERED = 0;
    READ = 1;
  }

  required Type type = 2;
  required string first_message_id = 1;
  repeated string more_message_ids = 3;
}

message Location {
  required float longitude = 1;
  required float latitude = 2;
  optional string name = 3; // location description/name
  optional int32 zoom = 4; // google maps zoom level (check maps api documentation)
  optional bool expects_read_confirmation = 5 [default = false];
  optional LegalHoldStatus legal_hold_status = 6 [default = UNKNOWN];
}

// deprecated in favour of Asset.Original.ImageMetaData
message ImageAsset {
  required string tag = 1;
  required int32 width = 2;
  required int32 height = 3;
  required int32 original_width = 4;
  required int32 original_height = 5;
  required string mime_type = 6;
  required int32 size = 7;
  optional bytes otr_key = 8;
  optional bytes mac_key = 9; // deprecated - use sha256
  optional bytes mac = 10; // deprecated - use sha256
  optional bytes sha256 = 11; // sha256 of ciphertext
}

// Attachment can attach different kind of assets to a Multipart message
message Attachment {
  oneof content {
    Asset asset = 1;
    CellAsset cell_asset = 2;
  }
}

// Multipart message combines optional text with multiple attachments
message Multipart {
  optional Text text = 1;
  repeated Attachment attachments = 2;

  // Standard flags for all message types
  optional bool expects_read_confirmation = 3 [default = false];
  optional LegalHoldStatus legal_hold_status = 4 [default = UNKNOWN];
}

// CellAsset represents a file uploaded to a conversation cell
message CellAsset {

  // Required pydio backend reference
  required string uuid = 1;
  // known mime_type
  required string content_type = 2;

  // Fields below are used for optimistic display: they could have changed since first posting

  // Path contains full path including name (last path part)
  optional string initial_name = 3;
  // Size of the file
  optional int64 initial_size = 4;

  message ImageMetaData {
    required int32 width = 1;
    required int32 height = 2;
  }

  message VideoMetaData {
    optional int32 width = 1;
    optional int32 height = 2;
    optional uint64 duration_in_millis = 3;
  }

  message AudioMetaData {
    optional uint64 duration_in_millis = 1;
    optional bytes normalized_loudness = 2;
  }

  oneof initial_meta_data {
    ImageMetaData image = 5;
    VideoMetaData video = 6;
    AudioMetaData audio = 7;
  }

}

message Asset {
  message Original {
    required string mime_type = 1;
    required uint64 size = 2;
    optional string name = 3;
    oneof meta_data {
      ImageMetaData image = 4;
      VideoMetaData video = 5;
      AudioMetaData audio = 6;
    }
    optional string source = 7; // link to source e.g. http://giphy.com/234245
    optional string caption = 8; // caption of the asset, e.g. "dog" for a Giphy "dog" search result
  }

  message Preview {
    required string mime_type = 1;
    required uint64 size = 2;
    optional RemoteData remote = 3;
    oneof meta_data {
      ImageMetaData image = 4;
    }
  }

  message ImageMetaData {
    required int32 width = 1;
    required int32 height = 2;
    optional string tag = 3;
  }

  message VideoMetaData {
    optional int32 width = 1;
    optional int32 height = 2;
    optional uint64 duration_in_millis = 3;
  }

  message AudioMetaData {
    optional uint64 duration_in_millis = 1;
    // repeated float normalized_loudness = 2 [packed=true]; // deprecated - Switched to bytes instead
    optional bytes normalized_loudness = 3; // each byte represent one loudness value as a byte (char) value.
    // e.g. a 100-bytes field here represents 100 loudness values.
    // Values are in chronological order and range from 0 to 255.
  }

  enum NotUploaded {
    CANCELLED = 0;
    FAILED = 1;
  }

  message RemoteData {
    required bytes otr_key = 1;
    required bytes sha256 = 2; // obsolete but required for backward compatibility
    optional string asset_id = 3;
    // optional bytes asset_token = 4; // deprecated - changed type to string
    optional string asset_token = 5;
    optional string asset_domain = 7;
    optional EncryptionAlgorithm encryption = 6;
  }

  optional Original original = 1;
  // optional Preview preview = 2;  // deprecated - preview was completely replaced
  oneof status {
    NotUploaded not_uploaded = 3;
    RemoteData uploaded = 4;
  }
  optional Preview preview = 5;
  optional bool expects_read_confirmation = 6 [default = false];
  optional LegalHoldStatus legal_hold_status = 7 [default = UNKNOWN];
}

// Actual message is encrypted with AES and sent as additional data
message External {
  required bytes otr_key = 1;
  optional bytes sha256 = 2; // sha256 of ciphertext, obsolete but required for backward compatibility
  optional EncryptionAlgorithm encryption = 3;
}

message Reaction {
  optional string emoji = 1; // some emoji reaction or the empty string to remove previous reaction(s)
  required string message_id = 2;
  optional LegalHoldStatus legal_hold_status = 3 [default = UNKNOWN];
}

message InCallEmoji {
  map<string, int32> emojis = 1;
}

message InCallHandRaise {
  required bool is_hand_up = 1; // true if the hand is raised, false if lowered
}

message Calling {
  required string content = 1;
  optional QualifiedConversationId qualified_conversation_id = 2;
}

message DataTransfer {
  optional TrackingIdentifier trackingIdentifier = 1;
}

message TrackingIdentifier {
  required string identifier = 1;
}

// Enums have to come last because of an unresolved issue with jsdoc
// https://github.com/jsdoc/jsdoc/pull/1686

enum ClientAction {
  RESET_SESSION = 0;
}

enum EncryptionAlgorithm {
  AES_CBC = 0;
  AES_GCM = 1;
}

enum LegalHoldStatus {
  UNKNOWN = 0;
  DISABLED = 1;
  ENABLED = 2;
}
```

(Source: `generic-message-proto/proto/messages.proto:20-441`, verbatim except
that the GPL header comment and two trailing inline comments on `Location` /
`Composite` were trimmed for length.)

## 4. Hand-codec cheat sheet: `GenericMessage` tag bytes

`GenericMessage` is the only message you must be able to *dispatch on* quickly.
Precomputed key bytes (varint of `(field << 3) | wire_type`):

| Field | # | Type | Wire type | Key bytes (hex) |
|---|---|---|---|---|
| `message_id` | 1 | string | 2 | `0A` |
| `text` | 2 | msg | 2 | `12` |
| `image` (deprecated) | 3 | msg | 2 | `1A` |
| `knock` | 4 | msg | 2 | `22` |
| `lastRead` | 6 | msg | 2 | `32` |
| `cleared` | 7 | msg | 2 | `3A` |
| `external` | 8 | msg | 2 | `42` |
| `clientAction` | 9 | enum | 0 | `48` |
| `calling` | 10 | msg | 2 | `52` |
| `asset` | 11 | msg | 2 | `5A` |
| `hidden` | 12 | msg | 2 | `62` |
| `location` | 13 | msg | 2 | `6A` |
| `deleted` | 14 | msg | 2 | `72` |
| `edited` | 15 | msg | 2 | `7A` |
| `confirmation` | 16 | msg | 2 | `82 01` |
| `reaction` | 17 | msg | 2 | `8A 01` |
| `ephemeral` | 18 | msg | 2 | `92 01` |
| `availability` | 19 | msg | 2 | `9A 01` |
| `composite` | 20 | msg | 2 | `A2 01` |
| `buttonAction` | 21 | msg | 2 | `AA 01` |
| `buttonActionConfirmation` | 22 | msg | 2 | `B2 01` |
| `dataTransfer` | 23 | msg | 2 | `BA 01` |
| `inCallEmoji` | 24 | map | 2 | `C2 01` |
| `unknownStrategy` | 25 | enum | 0 | `C8 01` |
| `inCallHandRaise` | 26 | msg | 2 | `D2 01` |
| `multipart` | 27 | msg | 2 | `DA 01` |

Note the irregularities that a naive reader gets wrong:

* **Field 5 does not exist** in `GenericMessage`. It was removed.
* **`multipart = 27` sits inside the `oneof`** even though it is numerically
  after `unknownStrategy = 25` and `inCallHandRaise = 26`, and
  `unknownStrategy = 25` sits *outside* the `oneof`. So a message may legally
  carry both `unknownStrategy` and one content field.
* `Confirmation` declares `type = 2` **before** `first_message_id = 1`
  (`messages.proto:236-237`). Field order in the `.proto` file is irrelevant to
  the wire format, but it trips up people transcribing the schema by hand.
* `Asset.RemoteData` numbers `asset_domain = 7` *after* `encryption = 6`, and
  skips 4 (the old `bytes asset_token`).

`InCallEmoji.emojis` is a `map<string, int32>`, i.e. on the wire a repeated
length-delimited field 1, each element being a nested message with
`key = 1 (string)` and `value = 2 (varint)`. It is only used during calls; a
chat-only client can skip it.

## 5. `message_id`

`GenericMessage.message_id` is `required string`, field 1, and is a
**client-generated UUID** in canonical lowercase hyphenated form. Every builder
in the reference client calls `createId()`
(`wire-webapp/libraries/core/src/conversation/message/messageBuilder.ts:334`,
`:342`, `:351`, `:360`, and throughout).

It is the *only* identity a message has. The backend does not assign message
IDs; it only assigns a `time` and an event position. Consequently:

* **Edits** (`MessageEdit.replacing_message_id`) reference it.
* **Deletes** (`MessageDelete.message_id`) reference it.
* **Hides** (`MessageHide.message_id`) reference it.
* **Reactions** (`Reaction.message_id`) reference it.
* **Quotes** (`Quote.quoted_message_id`) reference it.
* **Read receipts** (`Confirmation.first_message_id`, `more_message_ids`)
  reference it.
* **Button actions** (`ButtonAction.reference_message_id`) reference it.

Because the ID is chosen by the sender, a receiving client must scope it per
conversation and must tolerate (and ideally reject) a second message arriving
with an ID it already stored.

A subtlety for **edits**: the edit `GenericMessage` carries a *new*
`message_id`, and `MessageEdit.replacing_message_id` points at the old one. The
webapp then re-keys its stored event to the new ID. For **ephemeral** messages
the wrapper keeps the original ID
(`messageBuilder.ts:462`: `messageId: originalGenericMessage.messageId`), and
for **external** messages the wrapped inner message inherits the outer wrapper's
ID (see `CryptographyMapper._unwrapExternal` doc comment,
`wire-webapp/apps/webapp/src/script/repositories/cryptography/CryptographyMapper.ts:555`).

## 6. `Text` — the message body

```
Text.content                   = 1  required string
Text.link_preview              = 3  repeated LinkPreview
Text.mentions                  = 4  repeated Mention
Text.quote                     = 5  optional Quote
Text.expects_read_confirmation = 6  optional bool  (default false)
Text.legal_hold_status         = 7  optional LegalHoldStatus (default UNKNOWN)
```

Field 2 is retired (`messages.proto:127`).

### 6.1 There is no rich text. Only plain text.

`content` is a plain UTF-8 string. **No HTML is supported anywhere in the
protocol.** The web client renders the received string with `markdown-it`
configured with `html: false`
(`wire-webapp/apps/webapp/src/script/util/messageRenderer.ts:41-60`), enabling
only `autolink, backticks, code, emphasis, escape, fence, heading, link,
linkify, newline, list, strikethrough, blockquote`. Any literal HTML in the
string is escaped, not rendered.

So "formatting" is conveyed by **markdown syntax sitting literally in
`Text.content`**. A sender that wants bold writes `**bold**` into `content`; a
receiver that does not implement markdown simply shows the asterisks. That is
the whole story — there is no parallel formatted-body field, no attribute runs,
no HTML.

Practical consequences for us:
* Send: emit the user's text as-is; if we support markdown input, put the raw
  markdown source in `content`.
* Receive: render markdown ourselves, with HTML disabled, and escape everything
  else. Only allow `wire://`, `http://`, `https://`, `mailto:` link schemes —
  that is what the reference renderer enforces (`messageRenderer.ts:91-106`).

### 6.2 `Mention` offsets are **UTF-16 code units** — verified

```
Mention.start             = 1  required int32
Mention.length            = 2  required int32
Mention.user_id           = 3  string (oneof mention_type; deprecated)
Mention.qualified_user_id = 4  optional QualifiedUserId
```

The schema says so explicitly: *"offset from beginning of the message counting
in utf16 characters"* (`messages.proto:173`).

**Verified in the implementation**, not just in the comment: the web client's
`MentionEntity.validate()` does `messageText.charAt(this.startIndex) === '@'`
and `this.endIndex <= messageText.length`
(`wire-webapp/apps/webapp/src/script/message/mentionEntity.ts:107`, `:117`).
JavaScript `String.prototype.charAt` and `.length` operate on UTF-16 code units,
so `start`/`length` are UTF-16 code-unit counts, **not** UTF-8 bytes and **not**
Unicode code points.

That means: an emoji outside the BMP (e.g. U+1F600) counts as **2**; a BMP CJK
character counts as **1**; an "é" written as `e` + U+0301 counts as **2**.

Additional invariants the reference client enforces (`mentionEntity.ts:70-121`):
* mentions must not overlap each other,
* `start >= 0`, `length >= 1`, `start + length <= content.length`,
* `content[start]` must be `'@'` — the `@` is **part of the mention span**,
* the user id must be a valid UUID.

`user_id` (field 3, inside a `oneof`) is deprecated in favour of
`qualified_user_id` (field 4, `{id, domain}`). The schema comment
(`messages.proto:176-179`) says the deprecated field "should be set such that
old clients always fail when looking up the user" — in practice modern senders
set field 4 and either omit field 3 or set it to the bare UUID. **A new client
should read field 4 first and fall back to field 3 with the local backend's
domain.**

### 6.3 `LinkPreview`

```
LinkPreview.url           = 1  required string
LinkPreview.url_offset    = 2  required int32
LinkPreview.article       = 3  Article  (oneof preview; deprecated)
LinkPreview.permanent_url = 5  optional string
LinkPreview.title         = 6  optional string
LinkPreview.summary       = 7  optional string
LinkPreview.image         = 8  optional Asset
LinkPreview.tweet         = 9  Tweet    (oneof meta_data)
```

Field 4 does not exist. `url_offset` is the index of the URL inside
`Text.content`. The proto comment does not state the unit; the web client passes
a JS regex `match.index`
(`wire-webapp/apps/webapp/src/script/repositories/conversation/linkPreviews/helpers.ts:54`,
consumed at `linkPreviews/index.ts:143`), i.e. a **UTF-16 code-unit index**, the
same unit as mentions. For non-web clients this is **UNVERIFIED**, but UTF-16 is
the only self-consistent choice given mentions.

The reference client still populates the deprecated `article` field in parallel
with the flat fields, for old peers
(`wire-webapp/libraries/core/src/conversation/message/messageToProtoMapper.ts:78-83`).
A new client should **read** either and **write** the flat fields (5-8);
populating `article` too is cheap insurance.

`LinkPreview.image` is a full `Asset` — i.e. the preview thumbnail is uploaded
to the asset store like any other image and referenced by `Asset.uploaded`
(`RemoteData`). Link previews are therefore not free: sending one means an asset
upload.

### 6.4 `Quote`

```
Quote.quoted_message_id     = 1  required string
Quote.quoted_message_sha256 = 2  optional bytes
```

`quoted_message_id` is the `GenericMessage.message_id` of the quoted message.
`quoted_message_sha256` is an integrity hash used to detect that the quoted
message was edited after the quote was made. The web client stores and compares
it opaquely (`wire-webapp/apps/webapp/src/script/message/quoteEntity.ts:58-61`,
`wire-webapp/apps/webapp/src/script/repositories/event/preprocessor/QuoteDecoderMiddleware.ts:156-160`).
The **exact pre-image of that SHA-256 is not computed anywhere in wire-webapp** —
it is produced by other platforms and only round-tripped by web. Treat it as
**UNVERIFIED**; a new client can safely omit field 2 when sending and ignore it
when receiving.

Note `messages.proto:130`: if a `Text` is carried inside a `MessageEdit`, the
`quote` field of that `Text` **is ignored**. An edit cannot change the quote.

## 7. Receipts, reactions, deletion, edits

### 7.1 `Confirmation` — delivery and read receipts

```
Confirmation.first_message_id = 1  required string
Confirmation.type             = 2  required Type   (DELIVERED = 0, READ = 1)
Confirmation.more_message_ids = 3  repeated string
```

One `Confirmation` can acknowledge many messages: `first_message_id` plus
`more_message_ids`.

Gating rules as implemented by the reference client
(`wire-webapp/apps/webapp/src/script/repositories/conversation/MessageRepository.ts:1205-1247`):

* Never confirm your own messages (`:1213`).
* **`DELIVERED`** is sent only in **1:1** conversations, and only if the message
  timestamp is within `CONFIRMATION_THRESHOLD` of now (`:1217-1225`). It is *not*
  sent in groups.
* **`READ`** is sent only if the received message had
  `expects_read_confirmation = true`, and then only if
  * 1:1: the local user has read receipts switched on
    (`expectReadReceipt()`, `MessageRepository.ts:1275-1285`, which reads the
    user property `receiptMode`), or
  * group/channel: the conversation is a team room or guest room
    (`wire-webapp/apps/webapp/src/script/components/Conversation/Conversation.tsx:549-559`).
* Confirmations are sent with `nativePush: false` (no push notification) and
  targeted only at the original sender's clients (`MessageRepository.ts:1233-1238`).

`expects_read_confirmation` is set by the sender when it *wants* receipts, based
on the conversation's `receipt_mode` (`MessageRepository.ts:1275-1285`). It is a
per-message copy of that setting, carried on `Text`, `Knock`, `Location`,
`Asset`, `Composite` and `Multipart`.

### 7.2 `Reaction` — and the surprise

```
Reaction.emoji             = 1  optional string
Reaction.message_id        = 2  required string
Reaction.legal_hold_status = 3  optional LegalHoldStatus
```

The schema comment says "some emoji reaction or the empty string to remove
previous reaction(s)" (`messages.proto:399`). That is true but incomplete, and
the incomplete part will break interop if you miss it:

**`emoji` is a comma-separated list of the sender's *entire current* reaction
set on that message — not a single emoji, and not a delta.**

* Sending: `updateUserReactions()` collects all of this user's existing
  reactions on the message, toggles the one just clicked, and joins them with
  `','`
  (`wire-webapp/apps/webapp/src/script/repositories/conversation/MessageRepository.ts:1112-1120`).
* Receiving: `addReaction()` **removes all of that user's previous reactions**
  from the message and then adds every entry of `emoji.split(',')`
  (`wire-webapp/apps/webapp/src/script/util/reactionUtil.ts:52-71`).

So `emoji = ""` removes all of the sender's reactions (`split(',')` yields
`[""]`, which is filtered out by the `!!reaction` guard at
`reactionUtil.ts:61`). `emoji = "👍,🎉"` means "this user now reacts with 👍 and
🎉 and nothing else".

Implication: to add one emoji you must know and resend the user's whole current
set for that message. Keep per-message, per-user reaction state locally.

### 7.3 `MessageDelete` vs `MessageHide`

These are **not** two spellings of the same thing.

| | `MessageDelete` (field 14, `deleted`) | `MessageHide` (field 12, `hidden`) |
|---|---|---|
| Meaning | *Delete for everyone* | *Delete for me* (this user's own devices) |
| Fields | `message_id = 1` | `conversation_id = 1`, `message_id = 2`, `qualified_conversation_id = 3` |
| Sent to | all participants of the conversation | **the self-conversation only** |
| Who may send | only the original sender (or the recipient of an expired ephemeral) | anyone, for their own copy |

Verified in
`wire-webapp/apps/webapp/src/script/repositories/conversation/MessageRepository.ts`:
`deleteMessageForEveryone()` at `:1295-1341` builds a `MessageDelete` and sends
it into the conversation with all participants as recipients (`:1316-1326`),
after checking `message.user().isMe` (`:1313`); `deleteMessage()` at `:1350-1367`
builds a `MessageHide` and calls `sendToSelfConversations()` (`:1358`,
implementation at `:1369-1380`).

`MessageHide` therefore needs the conversation ID inside the payload — the
transport conversation is the self-conversation, so the target conversation
cannot be inferred from the envelope.

`Cleared` (field 7) and `LastRead` (field 6) follow the identical pattern:
deprecated bare `conversation_id` string in field 1, `int64` timestamp in field
2, and `qualified_conversation_id` (`{id, domain}`) in field 3, and they too are
sent only to the self-conversation
(`MessageRepository.ts:1385-1389` for `Cleared`). Send field 3; read field 3
first, then fall back to field 1.

### 7.4 `MessageEdit`

```
MessageEdit.replacing_message_id = 1  required string
MessageEdit.text                 = 2  Text       (oneof content)
MessageEdit.composite            = 3  Composite  (oneof content)
MessageEdit.multipart            = 4  Multipart  (oneof content)
```

The outer `GenericMessage.message_id` is a **new** UUID; the edited message is
identified by `replacing_message_id`
(`wire-webapp/libraries/core/src/conversation/message/messageBuilder.ts:108-120`).
A receiver replaces the stored message body and re-keys it to the new ID, so a
chain of edits forms a chain of IDs. Only the sender of the original may edit
it, and `Text.quote` inside an edit is ignored (`messages.proto:130`).

There is no "unsend an edit". There is no edit for assets, knocks or locations.

## 8. `Ephemeral` — self-deleting messages

```
Ephemeral.expire_after_millis = 1  required int64
Ephemeral.text                = 2  Text        (oneof content)
Ephemeral.image               = 3  ImageAsset  (deprecated)
Ephemeral.knock               = 4  Knock
Ephemeral.asset               = 5  Asset
Ephemeral.location            = 6  Location
```

Ephemeral is a **wrapper**, not a flag. To send an ephemeral text you build the
normal `GenericMessage{message_id, text}` and then *move* the content into an
`Ephemeral`:

```
GenericMessage {
  message_id: <same UUID as the unwrapped message>
  ephemeral:  Ephemeral { expire_after_millis: N, text: Text { ... } }
}
```

Exactly what `wrapInEphemeral()` does
(`wire-webapp/libraries/core/src/conversation/message/messageBuilder.ts:454-466`):
it copies `originalGenericMessage[content]` into the `Ephemeral` under the same
field name and keeps `messageId` (`:462`).

Note the content set is **narrower** than `GenericMessage`'s: only text, knock,
asset, location (and legacy image). You cannot make a reaction, confirmation or
edit ephemeral.

Semantics on receipt: start a timer of `expire_after_millis` when the message is
*displayed*, then delete locally and — as the recipient — send a `MessageDelete`
back so the sender's copy goes too. In the reference client the recipient is
allowed to `deleteMessageForEveryone()` an ephemeral even though it is not
theirs: `MessageRepository.ts:1313` permits it when `message.ephemeral_expires()`.

Timer values offered by the reference UI come from `SELF_DELETING_TIMEOUT`
(`wire-webapp/libraries/api-client/src/team/feature/featureList.types.ts:112-120`):
0, 10 s, 5 min, 1 h, 1 d, 1 w, 4 w — but the field is a free `int64` of
milliseconds, so accept anything.

## 9. `External` — when the payload is too big

```
External.otr_key    = 1  required bytes
External.sha256     = 2  optional bytes
External.encryption = 3  optional EncryptionAlgorithm (AES_CBC = 0, AES_GCM = 1)
```

Proteus encrypts the payload **once per recipient device**. A 200 KB message in
a 50-device conversation would be 10 MB on the wire. `External` fixes that:
encrypt the real `GenericMessage` **once** with a symmetric key, put the
*ciphertext* in the transport envelope's single `blob`, and Proteus-encrypt only
the tiny `GenericMessage{external: {otr_key, sha256}}` per device.

Concretely, on send:

1. Serialise the real `GenericMessage` → `plaintext`.
2. Generate a random 32-byte AES key and a random 16-byte IV.
3. `ciphertext = IV || AES-256-CBC(key, IV, plaintext)` — the IV is **prepended**
   (`wire-webapp/libraries/core/src/cryptography/assetCryptography/assetCryptography.ts:53-69`).
4. `sha256 = SHA-256(ciphertext)`, i.e. over `IV || ct`, **not** over the
   plaintext (`assetCryptography.ts:63`).
5. Build `GenericMessage{message_id, external: External{otr_key: key, sha256}}`
   and encrypt *that* per device.
6. Put `ciphertext` into `QualifiedNewOtrMessage.blob` (field 4 of `otr.proto`).
   The backend base64-encodes it into the event's `data` metadata field
   (`wire-server/libs/wire-api/src/Wire/API/Message.hs:203`:
   `mmData = Just . toBase64Text $ qualifiedNewOtrData msg`).

On receive
(`wire-webapp/apps/webapp/src/script/repositories/cryptography/CryptographyMapper.ts:560-580`):

1. Decrypt the per-device Proteus payload → `GenericMessage` with `external` set.
2. Take `event.data.data` (base64), decode → `ciphertext`.
3. Verify `SHA-256(ciphertext) == External.sha256`, else reject
   (`assetCryptography.ts:44-48`).
4. Split off the first 16 bytes as IV, AES-256-CBC-decrypt the rest with
   `External.otr_key`.
5. Decode the plaintext as a `GenericMessage`. It **inherits the outer message's
   `message_id`** (`CryptographyMapper.ts:555`).

Three things to know:

* **External only works over Proteus.** `_unwrapExternal` explicitly refuses MLS
  events:
  `const eventData = event.type === CONVERSATION_EVENT.OTR_MESSAGE_ADD ? event.data : undefined`
  (`CryptographyMapper.ts:564`). MLS has no `blob` side-channel and does not need
  one (one ciphertext per group, not per device).
* **The current web client only *receives* External, it never sends it.** The
  `assetData` option that feeds `protoMessage.blob` exists
  (`wire-webapp/libraries/core/src/conversation/message/messageService.ts:136-138`)
  but nothing in the tree sets it. So a new client may safely **not implement
  sending External**; it must implement *receiving* it, because older clients
  still send it.
* `EncryptionAlgorithm.AES_GCM` is declared but the web client implements only
  AES-CBC (`assetCryptography/crypto.node.ts:29-38`,
  `assetCryptography/crypto.browser.ts:42-57`). Treat AES_GCM as
  **UNVERIFIED / unused**.

The identical scheme (random AES-256-CBC key, IV prepended, SHA-256 over the
ciphertext) is used for `Asset.RemoteData.otr_key`/`sha256` — assets and
externals share `assetCryptography.ts`.

## 10. Assets in one paragraph

`Asset` (field 11) describes a file that lives in Wire's asset store, not in the
message. `Asset.original` carries mime type, size, filename and one of
`ImageMetaData` / `VideoMetaData` / `AudioMetaData`. `Asset.uploaded`
(`RemoteData`, `oneof status` field 4) carries `otr_key`, `sha256`, `asset_id`,
`asset_token`, `asset_domain` — download the blob from the asset endpoint using
`asset_domain`/`asset_id`/`asset_token`, verify `SHA-256(blob) == sha256`, then
AES-256-CBC-decrypt with `otr_key` (IV = first 16 bytes). `Asset.preview`
(field 5) is a smaller thumbnail with its own `RemoteData`. `Asset.not_uploaded`
(`oneof status` field 3, `CANCELLED = 0` / `FAILED = 1`) signals an aborted
upload. `ImageAsset` (field 3) is the pre-2016 form; decode it for old peers,
never send it. `Multipart` / `CellAsset` / `Attachment` are the new "Cells"
file-storage feature and can be ignored by a first client.

## 11. How the protobuf is embedded in each transport

### 11.1 Proteus

The serialised `GenericMessage` **is** the Proteus plaintext, encrypted once per
recipient device:

```
wire-webapp/libraries/core/src/messagingProtocols/proteus/utility/getGenericMessageParams.ts:58
  const plainText = GenericMessage.encode(genericMessage).finish();
```

which is handed to `ProteusService.encrypt(plainText, recipients)`
(`wire-webapp/libraries/core/src/messagingProtocols/proteus/proteusService/proteusService.ts:265`,
`:331-349`). On receipt:

```
wire-webapp/libraries/core/src/messagingProtocols/proteus/eventHandler/events/otrMessageAdd/otrMessageAdd.ts:52-54
  const decryptedData = await proteusService.decrypt(messageBytes, userId, clientId);
  const decodedData = GenericMessage.decode(decryptedData);
```

### 11.2 MLS — **verified: byte-for-byte the same `GenericMessage`**

```
wire-webapp/libraries/core/src/conversation/conversationService/conversationService.ts:469-472
  const encrypted = await this.mlsService.encryptMessage(
    new ConversationId(groupIdBytes),
    GenericMessage.encode(payload).finish(),
  );
```

and on receipt

```
wire-webapp/libraries/core/src/messagingProtocols/mls/eventHandler/events/messageAdd/messageAdd.ts:98
  return message !== undefined ? {event, decryptedData: GenericMessage.decode(message)} : null;
```

There is **no MLS-specific wrapper, header, or content-type byte**. The MLS
application message's `application_data` is exactly the `GenericMessage` bytes.
Everything in this document applies unchanged to MLS.

The only asymmetries between the two transports at this layer:

| | Proteus | MLS |
|---|---|---|
| Sender device | `event.data.sender` (hex client id) | `event.senderClientId`, decoded from the MLS credential (`messageAdd.ts:77-81`) |
| Big payloads | `External` + `blob` | not needed, not supported |
| Encryption count | once per recipient **device** | once per **group** |
| Session-reset action | `ClientAction.RESET_SESSION` is meaningful | meaningless (no pairwise sessions) |

## 12. `unknownStrategy` — forward compatibility

`GenericMessage.unknownStrategy` (field 25, enum, default `IGNORE`) tells a
receiver what to do with a `content` field it does not understand
(`messages.proto:55-62`):

* `IGNORE = 0` — drop silently. This is the default and what you get from any
  older sender.
* `DISCARD_AND_WARN = 1` — tell the user "your client is too old for this
  message" and drop it.
* `WARN_USER_ALLOW_RETRY = 2` — warn, but the client may keep the bytes and
  re-decode after an upgrade.

A new client should read this field and, at minimum, distinguish 0 from 1/2 so
the user is told when something was silently lost. When sending, set `IGNORE`
(0) — the reference builders set it explicitly for the newest message types
(`messageBuilder.ts:335`).

## 13. Minimum viable subset for a chat client

Ordered by how much you lose by skipping it.

**Must implement (send + receive):** `GenericMessage.message_id`, `Text`
(content / mentions / quote), `Confirmation`, `Reaction`, `MessageDelete`,
`MessageEdit`, `Knock`, `Asset` (at least receive + download), `Ephemeral` (at
least receive), `External` (**receive only**), `ClientAction.RESET_SESSION`
(Proteus only), and `LastRead` + `Cleared` + `MessageHide` for
self-conversation state sync.

**Should implement (receive only):** `ImageAsset` (legacy peers), `Article`
inside `LinkPreview` (legacy peers), `Availability`, `unknownStrategy`.

**Can skip entirely for a first version:** `Composite` / `Button` /
`ButtonAction` / `ButtonActionConfirmation` (bot poll UI), `Calling` (WebRTC
signalling; its `content` is a JSON string —
`wire-webapp/apps/webapp/src/script/repositories/cryptography/CryptographyMapper.ts:468`),
`InCallEmoji`, `InCallHandRaise`, `DataTransfer` (analytics ID sync between the
user's own devices), `Multipart` / `CellAsset` / `Attachment` (Cells file
storage), `Location`, `Tweet`, and `LegalHoldStatus` (read it, but a non-team
client will always see `UNKNOWN`).
