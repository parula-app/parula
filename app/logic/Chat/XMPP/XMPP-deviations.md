# XMPP implementation: XEP coverage, deviations, and limitations

This documents the wire-protocol decisions in `app/logic/Chat/XMPP/`, in particular
every place where we intentionally deviate from a written XEP, and the user-visible
features that are limited or not possible because the relevant XEP is missing or
immature.

The reference for interoperability is **Conversations** (Daniel Gultsch's Android
client) plus Dino, Gajim, and Monal. Two source-reading studies back the choices
here: [`interop-conversations.md`](./interop-conversations.md) (exact Conversations
wire format) and [`interop-cross-client.md`](./interop-cross-client.md) (the
cross-client discrepancy matrix and the safest interoperable choice for each
detail). The implementation matches all of their "interop traps".

We build on the `stanza` library (v12), which handles the XML, SASL, stream
management, MAM, MUC, PEP/PubSub, carbons, chat states, chat markers, receipts,
correction, hints, EME, OOB, HTTP-upload and the OMEMO *serialization*. We add the
OMEMO *crypto*, reactions, retraction and replies.

## Implemented features and their XEPs

| Feature | XEP | Notes |
|---|---|---|
| 1:1 chat | RFC 6121 | text + XHTML-IM (XEP-0071) |
| Formatting | XEP-0393 Message Styling | `*bold*` etc. in a body without XHTML-IM, also in OMEMO |
| History sync | XEP-0313 MAM | batched, incremental via `syncState` |
| Group chat | XEP-0045 MUC | bookmarks XEP-0048/0402, occupants from presence, MUC-MAM |
| End-to-end encryption | XEP-0384 OMEMO | legacy `eu.siacs.conversations.axolotl` |
| Reactions | XEP-0444 | |
| Message editing | XEP-0308 | `urn:xmpp:message-correct:0` |
| Message retraction | XEP-0424 | `urn:xmpp:message-retract:1` |
| Replies | XEP-0461 | |
| Delivery receipts | XEP-0184 | 1:1 → `DeliveryStatus.User` |
| Read markers | XEP-0333 | displayed → `DeliveryStatus.Seen` |
| Typing notifications | XEP-0085 | `contactIsTyping` |
| Carbons | XEP-0280 | own messages from other devices |
| File transfer / inline images | XEP-0363 + XEP-0066 | + OMEMO media sharing (`aesgcm://`) |
| Avatars | XEP-0084 + vCard (XEP-0153/0054) | receive + publish |
| Stanza/origin IDs | XEP-0359 | reaction/marker references in MUC |

## Intentional deviations from the XEPs

These are deliberate, and each is required for interoperability with the deployed
clients. The deployed reality differs from the written XEP text in several places.

### OMEMO (XEP-0384)

1. **Legacy namespace, not OMEMO 2.** We send and receive only
   `eu.siacs.conversations.axolotl` ("OMEMO 0.3"). The current XEP-0384 describes
   `urn:xmpp:omemo:2` (twomemo, SCE, AES-256), but no mainstream end-user client
   *sends* that by default; Conversations ignores it entirely. The legacy format is
   the lingua franca that Conversations, Dino, Gajim and Monal all interoperate on.

2. **Auth tag is moved into the key material.** What we Signal-encrypt per device
   is **32 bytes = 16-byte AES key ‖ 16-byte GCM tag** (libsignal's
   `PUT_AUTH_TAG_INTO_KEY`), and `<payload>` is the GCM ciphertext **without** the
   tag. The modern XEP keeps the tag on the payload; the deployed legacy format does
   not. On receive we are liberal: a 16-byte key blob means the tag is on the
   payload, a ≥32-byte blob means it's in the key (see `OMEMO.decrypt`).

3. **AES-128-GCM, 12-byte IV** for message payloads (not the 256-bit/larger-IV
   parameters of the modern XEP). On receive we accept a 12- or 16-byte IV (WebCrypto
   handles both); we always *send* 12 bytes, because Monal rejects anything else.

4. **Public keys on the wire are the 33-byte `0x05 || key` form**, base64'd
   (`identityKey`, `signedPreKeyPublic`, every `preKeyPublic`). The XEP-0384 0.3.0
   examples show 32 bytes; every libsignal-based client uses 33. We publish 33 and
   `djbDecode()` to 32 on import (and tolerate a 32-byte key on receive).

5. **`prekey="true"`** (literal) on a session-setup `<key>`; we accept `"true"` or
   `"1"` on receive (Monal sends `"1"`).

6. **We encrypt to all of our own other devices too**, not just the recipient's, so
   our sent messages are readable on our other clients (there are no encrypted
   carbons).

7. **OMEMO media uses different crypto than OMEMO messages**: `aesgcm://` files are
   **AES-256-GCM, 12-byte IV, with the tag left on the blob**, and the URL fragment
   is `hex(IV ‖ key)` (88 hex chars; we also accept the 96-char 16-byte-IV variant).
   This is the de-facto "OMEMO media sharing" convention, not part of XEP-0384.

### Other

8. **Reaction / marker / retraction target IDs differ by chat type** (XEP-0444/
   0333/0424 leave this implicit): in a MUC we reference the room's `<stanza-id>`
   (XEP-0359); in a 1:1 the message `id`. See `referenceID()`.

9. **Plain file URLs are duplicated** in `<body>` and OOB `<x><url>` (XEP-0066), as
   Conversations does, so clients that only read one of them still show the file.
   OMEMO file URLs go *only* in the encrypted body (no cleartext OOB).

10. **Retraction**: we author `urn:xmpp:message-retract:1` with a plaintext fallback
    body. Conversations only *processes* standalone chat retractions (it authors them
    only for MUC moderation), so our retraction shows as a normal "deleted" message
    on clients without XEP-0424.

11. **MUC occupants are not address-book contacts.** They are resolved live from
    presence into the chat account's *own* address book (`ChatAccount.addressbook`,
    a DummyStorage book that is never written to the contacts DB), and persisted only
    as `{name, userID}` on the room and `{senderName, senderID}` on each message.

## Limitations and features that need a missing/immature XEP

- **OMEMO trust is blind (BTBV)**: we encrypt to and accept all published devices.
  There is no fingerprint-verification UI and no per-device trust gating yet
  (XEP-0450 / out-of-band verification). This matches Conversations' *default*
  (blind-trust-before-verification) but not its verified mode.
- **OMEMO bundle access model**: we publish device list and bundles with stanza's
  default PEP options. We do **not** set `pubsub#access_model=open` (stanza's
  `publish` has no option for it), so on strict servers a contact must have a
  presence subscription before they can fetch our bundle. *Flagged for follow-up:
  send `<publish-options>` via a raw IQ.*
- **OMEMO in MUC requires a non-anonymous, members-only room** (we need every
  occupant's real JID to address them). In a public/semi-anonymous room, OMEMO is
  not possible — a protocol limitation, not ours. Two further coverage gaps within
  such rooms: (a) we encrypt to the devices of the occupants currently *present*
  (`memberByNick`), not to offline affiliated members, so a member who is offline
  when we send won't be able to read it later (Conversations resolves the full
  member list); (b) for a MAM-archived OMEMO message whose sender has since left
  the room, we may not be able to resolve their real JID (we only keep JIDs of
  occupants we've seen), so such archived messages may not decrypt. Both are
  coverage gaps, not wire-format errors.
- **Group delivery/read status is coarse**: XEP-0184 receipts are not used in
  groupchat (per XEP and Conversations), so MUC messages don't get per-member
  delivered/seen state; only XEP-0333 "displayed" markers apply.
- **Cross-device read sync (XEP-0490 MDS) is not implemented**: read state is
  per-message (XEP-0333), not synced across your own devices.
- **Voice messages**: there is no stable XEP for voice-message semantics (the audio
  message / waveform spec is a draft). We send/receive audio as a normal file
  attachment (XEP-0363) — it plays, but without "voice message" UI semantics.
- **Stickers**: no widely-deployed sticker XEP; stickers are handled as inline images.
- **Last-message correction of a retracted/own-device-only message** and editing the
  reaction set per-emoji are simplified: our model stores one combined reaction
  string per person (XEP-0444 allows an arbitrary per-person emoji set).
- **OAuth2 / token login** is stubbed (see `XMPPAccount.connect`).

## Interoperability status

The OMEMO crypto and envelope are verified byte-for-byte against the Conversations
source and cross-checked against Dino, Gajim, Monal and the Syndace `oldmemo`
backend (used by slixmpp/poezio/profanity). The full encrypt→decrypt cycle, device
list/bundle publish+fetch, and the message-feature wire formats are covered by the
tests in `app/test/logic/Chat/XMPP/`. Live interop against a real server/peer has
not been run here and should be the final validation step.
