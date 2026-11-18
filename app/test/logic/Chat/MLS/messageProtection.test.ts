/** The official MLS interop test vectors for message framing, from
 * <https://github.com/mlswg/mls-implementations>
 * `test-vectors/message-protection.json`.
 *
 * Each vector gives one epoch's secrets and the same proposal, commit and
 * application message in three forms: bare, framed as a `PublicMessage`, and
 * framed as a `PrivateMessage`. We check both directions of both framings:
 * that the vector's messages verify and decrypt with our code, and that what we
 * produce from the bare content verifies and decrypts again.
 *
 * The sender is always the member at leaf index 1, in a group of 2. */
import { CipherSuite } from "../../../../logic/Chat/MLS/Crypto/CipherSuite";
import { Commit } from "../../../../logic/Chat/MLS/Messages/Commit";
import { GroupContext } from "../../../../logic/Chat/MLS/Messages/GroupContext";
import { MLSMessage } from "../../../../logic/Chat/MLS/Messages/MLSMessage";
import { Proposal } from "../../../../logic/Chat/MLS/Messages/Proposal";
import { SecretTree } from "../../../../logic/Chat/MLS/Tree/SecretTree";
import {
  AuthenticatedContent, ContentType, FramedContent, PrivateMessage, PublicMessage, Sender, SenderType, WireFormat,
} from "../../../../logic/Chat/MLS/Messages/Framing";
import messageProtection from "./vectors/message-protection.json";
import { expect, test } from "vitest";

for (let vector of messageProtection) {
  let suite = CipherSuite.forID(vector.cipher_suite);
  let groupContext = new GroupContext(suite, hex(vector.group_id), BigInt(vector.epoch),
    hex(vector.tree_hash), hex(vector.confirmed_transcript_hash));
  let signaturePublic = hex(vector.signature_pub);
  let signaturePrivate = scalar(hex(vector.signature_priv), signaturePublic);
  let membershipKey = hex(vector.membership_key);
  let sender = 1;
  let secretTree = () => new SecretTree(suite, 2, hex(vector.encryption_secret), hex(vector.sender_data_secret));

  test(`PublicMessage for ${suite.name}`, () => {
    for (let [encoded, bare] of [[vector.proposal_pub, vector.proposal], [vector.commit_pub, vector.commit]]) {
      let message = MLSMessage.fromBytes(hex(encoded)).publicMessage;
      expect(message.content.sender.type).toBe(SenderType.Member);
      expect(message.content.sender.index).toBe(sender);
      // Checks the membership tag, and gives us back the internal form
      let content = message.unprotect(suite, membershipKey, groupContext);
      expect(content.verify(suite, signaturePublic, groupContext)).toBe(true);
      expect(bytes(bodyOf(content))).toBe(bare);
      // A wrong membership key must not pass
      expect(message.verifyMembershipTag(suite, new Uint8Array(membershipKey.length), groupContext)).toBe(false);

      // The other direction: build the same message ourselves
      let ours = PublicMessage.create(suite, framedContent(bare, message.content.contentType),
        signaturePrivate, membershipKey, groupContext, message.auth.confirmationTag);
      expect(ours.verifyMembershipTag(suite, membershipKey, groupContext)).toBe(true);
      expect(ours.authenticatedContent.verify(suite, signaturePublic, groupContext)).toBe(true);
      // And it survives the wire
      let reparsed = MLSMessage.fromBytes(new MLSMessage(ours).toBytes()).publicMessage;
      expect(reparsed.unprotect(suite, membershipKey, groupContext)
        .verify(suite, signaturePublic, groupContext)).toBe(true);
    }
  });

  test(`Application data may not be sent as a PublicMessage, for ${suite.name}`, () => {
    let content = framedContent(vector.application, ContentType.Application);
    expect(() => PublicMessage.create(suite, content, signaturePrivate, membershipKey, groupContext)).toThrow();
  });

  test(`PrivateMessage for ${suite.name}`, () => {
    let cases: [string, string, ContentType][] = [
      [vector.proposal_priv, vector.proposal, ContentType.Proposal],
      [vector.commit_priv, vector.commit, ContentType.Commit],
      [vector.application_priv, vector.application, ContentType.Application],
    ];
    for (let [encoded, bare, contentType] of cases) {
      let message = MLSMessage.fromBytes(hex(encoded)).privateMessage;
      expect(message.contentType).toBe(contentType);
      expect(bytes(new MLSMessage(message).toBytes())).toBe(encoded);

      let tree = secretTree();
      let senderData = message.senderData(suite, ciphertext => tree.senderDataKey(ciphertext));
      expect(senderData.leafIndex).toBe(sender);
      let content = message.decrypt(suite, messageKey(tree, contentType, senderData.generation), senderData);
      expect(content.verify(suite, signaturePublic, groupContext)).toBe(true);
      expect(bytes(bodyOf(content))).toBe(bare);

      // The other direction: encrypt the same content ourselves and open it again
      let sendTree = secretTree();
      let key = nextMessageKey(sendTree, contentType);
      let ours = AuthenticatedContent.sign(suite, WireFormat.PrivateMessage,
        framedContent(bare, contentType), signaturePrivate, groupContext, content.auth.confirmationTag);
      let encrypted = PrivateMessage.encrypt(suite, ours, key, key.generation,
        ciphertext => sendTree.senderDataKey(ciphertext), 32);

      let receiveTree = secretTree();
      let reparsed = MLSMessage.fromBytes(new MLSMessage(encrypted).toBytes()).privateMessage;
      let ourSenderData = reparsed.senderData(suite, ciphertext => receiveTree.senderDataKey(ciphertext));
      expect(ourSenderData.generation).toBe(key.generation);
      let opened = reparsed.decrypt(suite, messageKey(receiveTree, contentType, ourSenderData.generation),
        ourSenderData);
      expect(opened.verify(suite, signaturePublic, groupContext)).toBe(true);
      expect(bytes(bodyOf(opened))).toBe(bare);
    }
  });

  /** The `FramedContent` that the vector's bare proposal / commit / application
   * data belongs in. The sender is always the member at leaf 1. */
  function framedContent(bare: string, contentType: ContentType): FramedContent {
    let groupID = groupContext.groupID;
    let epoch = groupContext.epoch;
    if (contentType == ContentType.Proposal) {
      return FramedContent.proposal(groupID, epoch, Sender.member(sender), Proposal.fromBytes(hex(bare)));
    } else if (contentType == ContentType.Commit) {
      return FramedContent.commit(groupID, epoch, Sender.member(sender), Commit.fromBytes(hex(bare)));
    }
    return FramedContent.application(groupID, epoch, Sender.member(sender), hex(bare));
  }

  function messageKey(tree: SecretTree, contentType: ContentType, generation: number) {
    return contentType == ContentType.Application
      ? tree.applicationKey(sender, generation) : tree.handshakeKey(sender, generation);
  }

  function nextMessageKey(tree: SecretTree, contentType: ContentType) {
    return contentType == ContentType.Application ? tree.nextApplicationKey(sender) : tree.nextHandshakeKey(sender);
  }
}

/** The bare proposal, commit or application data inside a framed message. */
function bodyOf(content: AuthenticatedContent): Uint8Array {
  let framed = content.content;
  if (framed.contentType == ContentType.Proposal) {
    return framed.proposal.toBytes();
  } else if (framed.contentType == ContentType.Commit) {
    return framed.commit.toBytes();
  }
  return framed.applicationData;
}

/** The P-521 vector dropped the leading zero byte of its private scalar, and
 * @noble insists on the full field width. The width follows from the public
 * key: an uncompressed EC point is `0x04 || x || y`. */
function scalar(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  let length = publicKey.length > 32 ? (publicKey.length - 1) / 2 : publicKey.length;
  if (privateKey.length >= length) {
    return privateKey;
  }
  let padded = new Uint8Array(length);
  padded.set(privateKey, length - privateKey.length);
  return padded;
}

function hex(text: string): Uint8Array {
  let out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(text.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytes(data: Uint8Array): string {
  return [...data].map(b => b.toString(16).padStart(2, "0")).join("");
}
