/** How a proposal, a commit or application data is authenticated and encrypted,
 * RFC 9420 § 6.
 *
 *     Proposal / Commit / application data
 *                 |
 *                 v
 *           FramedContent  --sign-->  FramedContentAuthData
 *                 |                          |
 *                 +-------------+------------+
 *                               v
 *                      AuthenticatedContent
 *                               |
 *                +--------------+--------------+
 *                v                             v
 *          PublicMessage                 PrivateMessage
 *
 * `AuthenticatedContent` is the internal form: it is what we sign, what we hash
 * for a `ProposalRef`, and what goes into the transcript hash. It is never sent
 * as such. Sending means framing it either as a `PublicMessage`, which is only
 * signed and carries a membership tag, or as a `PrivateMessage`, which is also
 * AEAD-encrypted and hides the sender.
 *
 * This file deliberately knows nothing about the key schedule or the secret
 * tree: `PrivateMessage` takes the message key and nonce it should use, and
 * `MLSGroup` is what looks them up. */
import { GroupContext } from "./GroupContext";
import { Commit } from "./Commit";
import { Proposal } from "./Proposal";
import type { CipherSuite } from "../Crypto/CipherSuite";
import type { MessageKey } from "../Tree/SecretTree";
import { TLSReader, TLSParseError, tlsParse } from "../Codec/TLSReader";
import { TLSWriter, tlsSerialize } from "../Codec/TLSWriter";
import { kProtocolVersionMLS10 } from "../Tree/Capabilities";
import { MLSError } from "../util";
import { randomBytes } from "../../Signal/Crypto/primitives";

/**
 * RFC 9420 § 6: the message itself, before any authentication.
 *
 *     struct {
 *         opaque group_id<V>;
 *         uint64 epoch;
 *         Sender sender;
 *         opaque authenticated_data<V>;
 *         ContentType content_type;
 *         select (FramedContent.content_type) {
 *             case application: opaque application_data<V>;
 *             case proposal:    Proposal proposal;
 *             case commit:      Commit commit;
 *         };
 *     } FramedContent;
 *
 * Note that `authenticated_data` comes *before* `content_type`.
 */
export class FramedContent {
  readonly groupID: Uint8Array;
  readonly epoch: bigint;
  readonly sender: Sender;
  readonly authenticatedData: Uint8Array;
  readonly contentType: ContentType;
  /** Only for `ContentType.Application` */
  applicationData: Uint8Array | null = null;
  /** Only for `ContentType.Proposal` */
  proposal: Proposal | null = null;
  /** Only for `ContentType.Commit` */
  commit: Commit | null = null;

  protected constructor(groupID: Uint8Array, epoch: bigint, sender: Sender, authenticatedData: Uint8Array,
    contentType: ContentType) {
    this.groupID = groupID;
    this.epoch = epoch;
    this.sender = sender;
    this.authenticatedData = authenticatedData;
    this.contentType = contentType;
  }

  static application(groupID: Uint8Array, epoch: bigint, sender: Sender, data: Uint8Array,
    authenticatedData: Uint8Array = kNoBytes): FramedContent {
    let content = new FramedContent(groupID, epoch, sender, authenticatedData, ContentType.Application);
    content.applicationData = data;
    return content;
  }

  static proposal(groupID: Uint8Array, epoch: bigint, sender: Sender, proposal: Proposal,
    authenticatedData: Uint8Array = kNoBytes): FramedContent {
    let content = new FramedContent(groupID, epoch, sender, authenticatedData, ContentType.Proposal);
    content.proposal = proposal;
    return content;
  }

  static commit(groupID: Uint8Array, epoch: bigint, sender: Sender, commit: Commit,
    authenticatedData: Uint8Array = kNoBytes): FramedContent {
    let content = new FramedContent(groupID, epoch, sender, authenticatedData, ContentType.Commit);
    content.commit = commit;
    return content;
  }

  static read(reader: TLSReader): FramedContent {
    let groupID = reader.opaque();
    let epoch = reader.uint64();
    let sender = Sender.read(reader);
    let authenticatedData = reader.opaque();
    return FramedContent.readBody(reader, groupID, epoch, sender, authenticatedData, reader.uint8());
  }

  /** The `content_type` and the selected arm, which `PrivateMessage` reads
   * separately because its content type lives in the cleartext header. */
  static readBody(reader: TLSReader, groupID: Uint8Array, epoch: bigint, sender: Sender,
    authenticatedData: Uint8Array, contentType: ContentType): FramedContent {
    switch (contentType) {
      case ContentType.Application:
        return FramedContent.application(groupID, epoch, sender, reader.opaque(), authenticatedData);
      case ContentType.Proposal:
        return FramedContent.proposal(groupID, epoch, sender, Proposal.read(reader), authenticatedData);
      case ContentType.Commit:
        return FramedContent.commit(groupID, epoch, sender, Commit.read(reader), authenticatedData);
      default:
        throw new TLSParseError(`Unknown MLS content type ${contentType}`);
    }
  }

  static fromBytes(data: Uint8Array): FramedContent {
    return tlsParse(data, FramedContent.read);
  }

  writeTo(writer: TLSWriter): void {
    writer.opaque(this.groupID).uint64(this.epoch);
    this.sender.writeTo(writer);
    writer.opaque(this.authenticatedData).uint8(this.contentType);
    this.writeBodyTo(writer);
  }

  /** Only the selected arm, without the `content_type` discriminant. */
  writeBodyTo(writer: TLSWriter): void {
    if (this.contentType == ContentType.Application) {
      writer.opaque(this.applicationData);
    } else if (this.contentType == ContentType.Proposal) {
      this.proposal.writeTo(writer);
    } else {
      this.commit.writeTo(writer);
    }
  }

  toBytes(): Uint8Array {
    return tlsSerialize(writer => this.writeTo(writer));
  }

  /**
   * RFC 9420 § 6.1 `FramedContentTBS`: what the signature covers.
   *
   *     struct {
   *         ProtocolVersion version = mls10;
   *         WireFormat wire_format;
   *         FramedContent content;
   *         select (FramedContentTBS.content.sender.sender_type) {
   *             case member:
   *             case new_member_commit:  GroupContext context;
   *             case external:
   *             case new_member_proposal: struct{};
   *         };
   *     } FramedContentTBS;
   *
   * The `GroupContext` is appended for `member` and `new_member_commit` senders
   * *only*; getting that select wrong is the classic interop failure.
   *
   * @param groupContext for a Commit, the context of the epoch the Commit is
   *   *sent in*, i.e. the old one, never the new epoch's. For an external
   *   commit (`new_member_commit`), the one from the `GroupInfo` the joiner used.
   *   Ignored, and may be null, for `external` and `new_member_proposal`.
   */
  signatureContent(wireFormat: WireFormat, groupContext: GroupContext | null): Uint8Array {
    return tlsSerialize(writer => {
      writer.uint16(kProtocolVersionMLS10).uint16(wireFormat);
      this.writeTo(writer);
      if (this.sender.needsGroupContext) {
        if (!groupContext) {
          throw new MLSError(`A ${SenderType[this.sender.type]} sender needs the GroupContext to sign`);
        }
        groupContext.writeTo(writer);
      }
    });
  }
}

/**
 * RFC 9420 § 6: who sent a message.
 *
 *     struct {
 *         SenderType sender_type;
 *         select (Sender.sender_type) {
 *             case member:              uint32 leaf_index;
 *             case external:            uint32 sender_index;
 *             case new_member_commit:
 *             case new_member_proposal: struct{};
 *         };
 *     } Sender;
 */
export class Sender {
  readonly type: SenderType;
  /** The leaf index for `member`, the `external_senders` index for `external`,
   * and -1 for the two new-member types, which carry no index. */
  readonly index: number;

  protected constructor(type: SenderType, index = -1) {
    this.type = type;
    this.index = index;
  }

  static member(leafIndex: number): Sender {
    return new Sender(SenderType.Member, leafIndex);
  }

  /** @param index into the `external_senders` GroupContext extension */
  static external(index: number): Sender {
    return new Sender(SenderType.External, index);
  }

  static newMemberProposal(): Sender {
    return new Sender(SenderType.NewMemberProposal);
  }

  static newMemberCommit(): Sender {
    return new Sender(SenderType.NewMemberCommit);
  }

  static read(reader: TLSReader): Sender {
    let type = reader.uint8();
    switch (type) {
      case SenderType.Member:
        return Sender.member(reader.uint32());
      case SenderType.External:
        return Sender.external(reader.uint32());
      case SenderType.NewMemberProposal:
        return Sender.newMemberProposal();
      case SenderType.NewMemberCommit:
        return Sender.newMemberCommit();
      default:
        throw new TLSParseError(`Unknown MLS sender type ${type}`);
    }
  }

  writeTo(writer: TLSWriter): void {
    writer.uint8(this.type);
    if (this.type == SenderType.Member || this.type == SenderType.External) {
      writer.uint32(this.index);
    }
  }

  /** RFC 9420 § 6.1: only these two sign over the GroupContext. */
  get needsGroupContext(): boolean {
    return this.type == SenderType.Member || this.type == SenderType.NewMemberCommit;
  }
}

/**
 * RFC 9420 § 6.1: the signature over a `FramedContent`, plus the confirmation
 * tag that a Commit carries.
 *
 *     struct {
 *         opaque signature<V>;   // SignWithLabel(., "FramedContentTBS", FramedContentTBS)
 *         select (FramedContent.content_type) {
 *             case commit:      MAC confirmation_tag;
 *             case application:
 *             case proposal:    struct{};
 *         };
 *     } FramedContentAuthData;
 */
export class FramedContentAuthData {
  readonly signature: Uint8Array;
  /** `MAC(confirmation_key, confirmed_transcript_hash)`, commits only */
  readonly confirmationTag: Uint8Array | null;

  constructor(signature: Uint8Array, confirmationTag: Uint8Array | null = null) {
    this.signature = signature;
    this.confirmationTag = confirmationTag;
  }

  /** The content type is not part of this struct; it comes from the enclosing
   * `FramedContent` or `PrivateMessage`. */
  static read(reader: TLSReader, contentType: ContentType): FramedContentAuthData {
    let signature = reader.opaque();
    return new FramedContentAuthData(signature, contentType == ContentType.Commit ? reader.opaque() : null);
  }

  writeTo(writer: TLSWriter): void {
    writer.opaque(this.signature);
    if (this.confirmationTag) {
      writer.opaque(this.confirmationTag);
    }
  }
}

/**
 * RFC 9420 § 6: the fully authenticated message, in the form the protocol works
 * with internally.
 *
 *     struct {
 *         WireFormat wire_format;
 *         FramedContent content;
 *         FramedContentAuthData auth;
 *     } AuthenticatedContent;
 */
export class AuthenticatedContent {
  readonly wireFormat: WireFormat;
  readonly content: FramedContent;
  readonly auth: FramedContentAuthData;

  constructor(wireFormat: WireFormat, content: FramedContent, auth: FramedContentAuthData) {
    this.wireFormat = wireFormat;
    this.content = content;
    this.auth = auth;
  }

  /** RFC 9420 § 6.1 `SignWithLabel(., "FramedContentTBS", FramedContentTBS)`.
   * @param groupContext the epoch the message is sent in, i.e. for a Commit the
   *   *old* GroupContext. Only used for `member` and `new_member_commit` senders.
   * @param confirmationTag for a Commit, `MAC(confirmation_key,
   *   confirmed_transcript_hash)` of the *new* epoch, which the caller can only
   *   compute once the transcript hash has been updated with this signature. */
  static sign(suite: CipherSuite, wireFormat: WireFormat, content: FramedContent,
    signaturePrivateKey: Uint8Array, groupContext: GroupContext | null,
    confirmationTag: Uint8Array | null = null): AuthenticatedContent {
    let signature = suite.signWithLabel(signaturePrivateKey, "FramedContentTBS",
      content.signatureContent(wireFormat, groupContext));
    return new AuthenticatedContent(wireFormat, content, new FramedContentAuthData(signature, confirmationTag));
  }

  /** RFC 9420 § 6.1. The key depends on the sender type: a member's leaf node,
   * the `external_senders` entry, the LeafNode in the Commit's path, or the one
   * in the KeyPackage of an external Add.
   * @param groupContext as in `sign()`: the epoch the message was sent in. */
  verify(suite: CipherSuite, signaturePublicKey: Uint8Array, groupContext: GroupContext | null): boolean {
    return suite.verifyWithLabel(signaturePublicKey, "FramedContentTBS",
      this.content.signatureContent(this.wireFormat, groupContext), this.auth.signature);
  }

  static read(reader: TLSReader): AuthenticatedContent {
    let wireFormat = reader.uint16();
    let content = FramedContent.read(reader);
    return new AuthenticatedContent(wireFormat, content, FramedContentAuthData.read(reader, content.contentType));
  }

  static fromBytes(data: Uint8Array): AuthenticatedContent {
    return tlsParse(data, AuthenticatedContent.read);
  }

  writeTo(writer: TLSWriter): void {
    writer.uint16(this.wireFormat);
    this.content.writeTo(writer);
    this.auth.writeTo(writer);
  }

  toBytes(): Uint8Array {
    return tlsSerialize(writer => this.writeTo(writer));
  }

  /** RFC 9420 § 5.2 `MakeProposalRef`: how a Commit names a proposal that was
   * already sent. The hash is over this whole framed object, not the bare
   * `Proposal`. */
  ref(suite: CipherSuite): Uint8Array {
    return suite.proposalRef(this.toBytes());
  }

  /**
   * RFC 9420 § 8.2 `ConfirmedTranscriptHashInput`: this object with the
   * confirmation tag left out, because the tag is computed over the very hash
   * this feeds.
   *
   *     struct {
   *         WireFormat wire_format;
   *         FramedContent content;   // content_type == commit
   *         opaque signature<V>;
   *     } ConfirmedTranscriptHashInput;
   */
  confirmedTranscriptHashInput(): Uint8Array {
    return tlsSerialize(writer => {
      writer.uint16(this.wireFormat);
      this.content.writeTo(writer);
      writer.opaque(this.auth.signature);
    });
  }
}

/**
 * RFC 9420 § 6.2: signed but not encrypted.
 *
 *     struct {
 *         FramedContent content;
 *         FramedContentAuthData auth;
 *         select (PublicMessage.content.sender.sender_type) {
 *             case member: MAC membership_tag;
 *             case external:
 *             case new_member_commit:
 *             case new_member_proposal: struct{};
 *         };
 *     } PublicMessage;
 *
 * Applications SHOULD send handshake messages as `PrivateMessage`, but MAY use
 * this where the delivery service has to read them — which is exactly what
 * Wire's backend requires for proposals and commits.
 */
export class PublicMessage {
  readonly content: FramedContent;
  readonly auth: FramedContentAuthData;
  /** `MAC(membership_key, AuthenticatedContentTBM)`, for `member` senders only */
  readonly membershipTag: Uint8Array | null;

  constructor(content: FramedContent, auth: FramedContentAuthData, membershipTag: Uint8Array | null = null) {
    this.content = content;
    this.auth = auth;
    this.membershipTag = membershipTag;
  }

  /** RFC 9420 § 6.2: frame an already-signed message, adding the membership tag
   * that proves the sender is in the group.
   * @param groupContext the epoch the message is sent in; see `AuthenticatedContent.sign()` */
  static protect(suite: CipherSuite, content: AuthenticatedContent, membershipKey: Uint8Array,
    groupContext: GroupContext | null): PublicMessage {
    if (content.content.contentType == ContentType.Application) {
      // RFC 9420 § 6: a PublicMessage is not encrypted, so it must not carry
      // application data. Parsing one is still allowed, only sending is not.
      throw new MLSError("Application data must be sent as a PrivateMessage");
    }
    let message = new PublicMessage(content.content, content.auth);
    if (content.content.sender.type != SenderType.Member) {
      return message;
    }
    return new PublicMessage(content.content, content.auth,
      suite.mac(membershipKey, message.membershipTagContent(groupContext)));
  }

  /** RFC 9420 § 6.1 and § 6.2 in one step: sign the content, then add the
   * membership tag over that signature.
   * @param groupContext the epoch the message is sent in; for a Commit the
   *   *old* GroupContext, not the one the Commit creates. */
  static create(suite: CipherSuite, content: FramedContent, signaturePrivateKey: Uint8Array,
    membershipKey: Uint8Array, groupContext: GroupContext | null,
    confirmationTag: Uint8Array | null = null): PublicMessage {
    return PublicMessage.protect(suite, AuthenticatedContent.sign(suite, WireFormat.PublicMessage, content,
      signaturePrivateKey, groupContext, confirmationTag), membershipKey, groupContext);
  }

  /** RFC 9420 § 6.2: back to the internal form, after checking the membership tag.
   * The caller still has to verify the signature and the confirmation tag.
   * @throws `MLSError` if the membership tag is missing or wrong */
  unprotect(suite: CipherSuite, membershipKey: Uint8Array, groupContext: GroupContext | null): AuthenticatedContent {
    if (!this.verifyMembershipTag(suite, membershipKey, groupContext)) {
      throw new MLSError("PublicMessage membership tag does not verify");
    }
    return this.authenticatedContent;
  }

  get authenticatedContent(): AuthenticatedContent {
    return new AuthenticatedContent(WireFormat.PublicMessage, this.content, this.auth);
  }

  verifyMembershipTag(suite: CipherSuite, membershipKey: Uint8Array, groupContext: GroupContext | null): boolean {
    if (this.content.sender.type != SenderType.Member) {
      return !this.membershipTag;
    }
    return !!this.membershipTag &&
      suite.verifyMAC(membershipKey, this.membershipTagContent(groupContext), this.membershipTag);
  }

  /**
   * RFC 9420 § 6.2 `AuthenticatedContentTBM`: the whole `FramedContentTBS`
   * again, plus the auth data, so that the membership tag covers the signature.
   *
   *     struct {
   *       FramedContentTBS content_tbs;
   *       FramedContentAuthData auth;
   *     } AuthenticatedContentTBM;
   */
  protected membershipTagContent(groupContext: GroupContext | null): Uint8Array {
    return tlsSerialize(writer => {
      writer.bytes(this.content.signatureContent(WireFormat.PublicMessage, groupContext));
      this.auth.writeTo(writer);
    });
  }

  static read(reader: TLSReader): PublicMessage {
    let content = FramedContent.read(reader);
    let auth = FramedContentAuthData.read(reader, content.contentType);
    let membershipTag = content.sender.type == SenderType.Member ? reader.opaque() : null;
    return new PublicMessage(content, auth, membershipTag);
  }

  static fromBytes(data: Uint8Array): PublicMessage {
    return tlsParse(data, PublicMessage.read);
  }

  writeTo(writer: TLSWriter): void {
    this.content.writeTo(writer);
    this.auth.writeTo(writer);
    if (this.content.sender.type == SenderType.Member) {
      writer.opaque(this.membershipTag);
    }
  }

  toBytes(): Uint8Array {
    return tlsSerialize(writer => this.writeTo(writer));
  }
}

/**
 * RFC 9420 § 6.3: signed and encrypted, with the sender hidden too.
 *
 *     struct {
 *         opaque group_id<V>;
 *         uint64 epoch;
 *         ContentType content_type;
 *         opaque authenticated_data<V>;
 *         opaque encrypted_sender_data<V>;
 *         opaque ciphertext<V>;
 *     } PrivateMessage;
 *
 * Two AEAD layers: the content is encrypted under a per-sender, per-generation
 * key from the secret tree, and the `SenderData` that says which key that was is
 * encrypted under a key derived from the `sender_data_secret` and a sample of
 * the content ciphertext. Decryption is therefore two steps — `senderData()`
 * first, then look the message key up, then `decrypt()`.
 */
export class PrivateMessage {
  readonly groupID: Uint8Array;
  readonly epoch: bigint;
  readonly contentType: ContentType;
  readonly authenticatedData: Uint8Array;
  readonly encryptedSenderData: Uint8Array;
  readonly ciphertext: Uint8Array;

  constructor(groupID: Uint8Array, epoch: bigint, contentType: ContentType, authenticatedData: Uint8Array,
    encryptedSenderData: Uint8Array, ciphertext: Uint8Array) {
    this.groupID = groupID;
    this.epoch = epoch;
    this.contentType = contentType;
    this.authenticatedData = authenticatedData;
    this.encryptedSenderData = encryptedSenderData;
    this.ciphertext = ciphertext;
  }

  /**
   * RFC 9420 § 6.3: encrypt an already-signed message.
   * @param messageKey the handshake or application key of *our* leaf at
   *   `generation`, from the secret tree. Single use.
   * @param senderDataKey `SecretTree.senderDataKey`. It is a function, not a
   *   key, because § 6.3.2 binds the sender-data key to a sample of the content
   *   ciphertext, which only exists once this method has encrypted it.
   * @param paddingLength zero bytes appended inside the ciphertext, to hide the
   *   real message length.
   */
  static encrypt(suite: CipherSuite, content: AuthenticatedContent, messageKey: MessageKey, generation: number,
    senderDataKey: SenderDataKey, paddingLength = 0, reuseGuard = randomBytes(4)): PrivateMessage {
    let sender = content.content.sender;
    if (sender.type != SenderType.Member) {
      throw new MLSError("Only a member can send a PrivateMessage");
    }
    let framed = content.content;
    let plaintext = tlsSerialize(writer => {
      framed.writeBodyTo(writer);
      content.auth.writeTo(writer);
      writer.bytes(new Uint8Array(paddingLength));
    });
    let aad = tlsSerialize(writer => writer
      .opaque(framed.groupID).uint64(framed.epoch).uint8(framed.contentType).opaque(framed.authenticatedData));
    let ciphertext = suite.aead.seal(messageKey.key, guardedNonce(messageKey.nonce, reuseGuard), aad, plaintext);

    let senderData = new SenderData(sender.index, generation, reuseGuard);
    let senderDataAAD = tlsSerialize(writer => writer
      .opaque(framed.groupID).uint64(framed.epoch).uint8(framed.contentType));
    let key = senderDataKey(ciphertext);
    let encryptedSenderData = suite.aead.seal(key.key, key.nonce, senderDataAAD, senderData.toBytes());
    return new PrivateMessage(framed.groupID, framed.epoch, framed.contentType, framed.authenticatedData,
      encryptedSenderData, ciphertext);
  }

  /** RFC 9420 § 6.3.2: who sent this and with which generation, so that the
   * caller can fetch the right key from the secret tree.
   * @param senderDataKey `SecretTree.senderDataKey`, as in `encrypt()`
   * @throws `MLSError` if the sender data does not authenticate */
  senderData(suite: CipherSuite, senderDataKey: SenderDataKey): SenderData {
    let key = senderDataKey(this.ciphertext);
    let aad = tlsSerialize(writer => writer.opaque(this.groupID).uint64(this.epoch).uint8(this.contentType));
    try {
      return SenderData.fromBytes(suite.aead.open(key.key, key.nonce, aad, this.encryptedSenderData));
    } catch (ex) {
      throw new MLSError(`PrivateMessage sender data does not decrypt: ${ex?.message ?? ex}`);
    }
  }

  /** RFC 9420 § 6.3.1: decrypt the content and rebuild the internal form.
   * @param messageKey the sender's key at `senderData.generation`, from the
   *   secret tree; the reuse guard is applied to its nonce here.
   * @throws `MLSError` if the ciphertext does not authenticate or the padding
   *   is not all zero */
  decrypt(suite: CipherSuite, messageKey: MessageKey, senderData: SenderData): AuthenticatedContent {
    let aad = tlsSerialize(writer => writer
      .opaque(this.groupID).uint64(this.epoch).uint8(this.contentType).opaque(this.authenticatedData));
    let plaintext: Uint8Array;
    try {
      plaintext = suite.aead.open(messageKey.key, guardedNonce(messageKey.nonce, senderData.reuseGuard),
        aad, this.ciphertext);
    } catch (ex) {
      throw new MLSError(`PrivateMessage content does not decrypt: ${ex?.message ?? ex}`);
    }
    let reader = new TLSReader(plaintext);
    let content = FramedContent.readBody(reader, this.groupID, this.epoch, Sender.member(senderData.leafIndex),
      this.authenticatedData, this.contentType);
    let auth = FramedContentAuthData.read(reader, this.contentType);
    // The rest is `opaque padding[length_of_padding]`, which has no length of
    // its own and MUST be all zero, so that it cannot become a covert channel.
    for (let byte of reader.rest()) {
      if (byte != 0) {
        throw new MLSError("PrivateMessage padding is not all zero bytes");
      }
    }
    return new AuthenticatedContent(WireFormat.PrivateMessage, content, auth);
  }

  static read(reader: TLSReader): PrivateMessage {
    return new PrivateMessage(reader.opaque(), reader.uint64(), reader.uint8(), reader.opaque(),
      reader.opaque(), reader.opaque());
  }

  static fromBytes(data: Uint8Array): PrivateMessage {
    return tlsParse(data, PrivateMessage.read);
  }

  writeTo(writer: TLSWriter): void {
    writer.opaque(this.groupID).uint64(this.epoch).uint8(this.contentType)
      .opaque(this.authenticatedData).opaque(this.encryptedSenderData).opaque(this.ciphertext);
  }

  toBytes(): Uint8Array {
    return tlsSerialize(writer => this.writeTo(writer));
  }
}

/**
 * RFC 9420 § 6.3.2: which secret-tree key a `PrivateMessage` was encrypted with.
 *
 *     struct {
 *         uint32 leaf_index;
 *         uint32 generation;
 *         opaque reuse_guard[4];
 *     } SenderData;
 *
 * `reuse_guard` is a bare 4-byte array with no length prefix, so a `SenderData`
 * is always exactly 12 bytes.
 */
export class SenderData {
  readonly leafIndex: number;
  readonly generation: number;
  readonly reuseGuard: Uint8Array;

  constructor(leafIndex: number, generation: number, reuseGuard: Uint8Array) {
    this.leafIndex = leafIndex;
    this.generation = generation;
    this.reuseGuard = reuseGuard;
  }

  static read(reader: TLSReader): SenderData {
    return new SenderData(reader.uint32(), reader.uint32(), reader.bytes(4));
  }

  static fromBytes(data: Uint8Array): SenderData {
    return tlsParse(data, SenderData.read);
  }

  writeTo(writer: TLSWriter): void {
    writer.uint32(this.leafIndex).uint32(this.generation).bytes(this.reuseGuard);
  }

  toBytes(): Uint8Array {
    return tlsSerialize(writer => this.writeTo(writer));
  }
}

/** RFC 9420 § 6.3.2: the key and nonce for the `SenderData`, derived from the
 * epoch's `sender_data_secret` and a sample of the content ciphertext.
 * `SecretTree.senderDataKey` is the implementation; taking it as a function
 * keeps this file out of the key schedule. */
export type SenderDataKey = (ciphertext: Uint8Array) => MessageKey;

/** RFC 9420 § 17.2 "MLS Wire Formats" */
export enum WireFormat {
  PublicMessage = 0x0001,
  PrivateMessage = 0x0002,
  Welcome = 0x0003,
  GroupInfo = 0x0004,
  KeyPackage = 0x0005,
}

/** RFC 9420 § 6 */
export enum ContentType {
  Application = 1,
  Proposal = 2,
  Commit = 3,
}

/** RFC 9420 § 6 */
export enum SenderType {
  Member = 1,
  External = 2,
  NewMemberProposal = 3,
  NewMemberCommit = 4,
}

/** RFC 9420 § 6.3.1: the sender XORs a fresh random four-byte guard into the
 * front of the key schedule's nonce, so that a client that lost its generation
 * counter still does not reuse a key/nonce pair. */
function guardedNonce(nonce: Uint8Array, reuseGuard: Uint8Array): Uint8Array {
  let guarded = new Uint8Array(nonce);
  for (let i = 0; i < reuseGuard.length; i++) {
    guarded[i] ^= reuseGuard[i];
  }
  return guarded;
}

const kNoBytes = new Uint8Array(0);
