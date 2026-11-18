/** The MLS group state machine, RFC 9420 § 11 to § 15.
 *
 * One instance is one group, in one epoch. Everything that the epoch defines —
 * the GroupContext, the ratchet tree, our private keys, the key schedule and
 * the secret tree — lives in a single `GroupState`, and a Commit replaces the
 * whole of it at once. Nothing is ever half-applied.
 *
 * Three GroupContexts surround one Commit, and mixing them up is the classic
 * interop failure (§ 12.4.1):
 *
 * - the *old* one, of the epoch the Commit is sent in, signs the `FramedContent`
 *   and keys the `PublicMessage` membership tag,
 * - the *provisional* one — new epoch, new tree hash, but still the **old**
 *   confirmed transcript hash — is the HPKE context of every `UpdatePathNode`,
 * - the *new* one, which is the provisional one with the new confirmed
 *   transcript hash filled in, feeds `"joiner"` and `"epoch"` in the key
 *   schedule and ends up in the `GroupInfo`.
 *
 * Building a Commit never touches the live state (§ 14): `commit()` works on a
 * clone and returns the epoch it would produce, and only `applyOwnCommit()`,
 * once the delivery service accepted it, moves us into it. Otherwise a Commit
 * that loses a race against another member's forks us out of the group. */
import type { CreatedKeyPackage, MLSClient } from "./MLSClient";
import { KeySchedule, PreSharedKeyID, TranscriptHash } from "./KeySchedule";
import { RatchetTree, type CreatedUpdatePath } from "./Tree/RatchetTree";
import { SecretTree, type MessageKey } from "./Tree/SecretTree";
import { LeafNode, LeafNodeSource } from "./Tree/LeafNode";
import { UpdatePath } from "./Tree/UpdatePath";
import { Commit } from "./Messages/Commit";
import { Extension, ExtensionType, ExternalSender } from "./Messages/Extension";
import { GroupContext } from "./Messages/GroupContext";
import { GroupInfo } from "./Messages/GroupInfo";
import { KeyPackage } from "./Messages/KeyPackage";
import { MLSMessage } from "./Messages/MLSMessage";
import { EncryptedGroupSecrets, GroupSecrets, Welcome } from "./Messages/Welcome";
import {
  AddProposal, ExternalInitProposal, GroupContextExtensionsProposal, PreSharedKeyProposal, Proposal, ProposalOrRef,
  ProposalType, RemoveProposal, UpdateProposal,
} from "./Messages/Proposal";
import {
  AuthenticatedContent, ContentType, FramedContent, FramedContentAuthData, PrivateMessage, PublicMessage, Sender,
  SenderType, WireFormat,
} from "./Messages/Framing";
import type { CipherSuite } from "./Crypto/CipherSuite";
import { tlsSerialize } from "./Codec/TLSWriter";
import { MLSError } from "./util";
import { base64Decode, base64Encode, bytesEqual } from "../Signal/Crypto/primitives";

export class MLSGroup {
  readonly client: MLSClient;
  readonly suite: CipherSuite;
  /** A Commit removed us. We can neither send nor process anything any more,
   * RFC 9420 § 12.4.2. */
  removed = false;
  /** Everything the current epoch defines. A Commit swaps it wholesale. */
  protected state: GroupState;
  /** RFC 9420 § 12.1: the proposals of this epoch, by `MakeProposalRef`, so
   * that a Commit that names one by reference can be applied. */
  protected readonly proposals = new Map<string, CommittedProposal>();
  /** The encryption keys of the Update proposals we sent this epoch, by their
   * public key: whoever commits ours hands our own new leaf back to us. */
  protected readonly updateKeys = new Map<string, Uint8Array>();
  /** RFC 9420 § 8.6: epoch → `resumption_psk`, for a PreSharedKey proposal that
   * names an epoch we took part in. */
  protected readonly resumptionPSKs = new Map<string, Uint8Array>();
  /** RFC 9420 § 15.3: the epochs we just left, so that an application message
   * that a Commit overtook can still be decrypted. */
  protected readonly pastEpochs: GroupState[] = [];

  protected constructor(client: MLSClient, state: GroupState) {
    this.client = client;
    this.suite = state.context.suite;
    this.state = state;
  }

  get groupID(): Uint8Array {
    return this.state.context.groupID;
  }

  get epoch(): bigint {
    return this.state.context.epoch;
  }

  get groupContext(): GroupContext {
    return this.state.context;
  }

  get tree(): RatchetTree {
    return this.state.tree;
  }

  get ourLeafIndex(): number {
    return this.state.leafIndex;
  }

  get members(): LeafNode[] {
    return this.state.tree.memberLeafIndices().map(leafIndex => this.state.tree.leaf(leafIndex));
  }

  /** RFC 9420 § 8.7: compare it with the other members, out of band, to confirm
   * that everybody sees the same group. */
  get epochAuthenticator(): Uint8Array {
    return this.state.keySchedule.epochAuthenticator;
  }

  /** The confirmation tag of the Commit that started this epoch, RFC 9420 § 8.2 */
  get confirmationTag(): Uint8Array {
    return this.state.confirmationTag;
  }

  /** RFC 9420 § 11: a brand-new group, with only us in it. */
  static create(client: MLSClient, groupID: Uint8Array, suite: CipherSuite, extensions: Extension[] = []): MLSGroup {
    let { leaf, encryptionKeyPair } = client.createLeafNode(LeafNodeSource.KeyPackage);
    let tree = RatchetTree.withLeaf(suite, leaf);
    let context = new GroupContext(suite, groupID, 0n, tree.treeHash(), kNoBytes, extensions);
    let zero = new Uint8Array(suite.secretLength);
    let keySchedule = KeySchedule.forNewGroup(suite, context.toBytes());
    // § 11: the first epoch has no Commit, so its confirmation tag is a MAC
    // over the empty confirmed transcript hash
    let confirmationTag = suite.mac(keySchedule.confirmationKey, context.confirmedTranscriptHash);
    let state = new GroupState(context, tree, 0, new Map([[0, encryptionKeyPair.privateKey]]), keySchedule, zero,
      confirmationTag, TranscriptHash.interim(suite, context.confirmedTranscriptHash, confirmationTag));
    let group = new MLSGroup(client, state);
    group.enteredEpoch();
    client.addGroup(group);
    return group;
  }

  /**
   * RFC 9420 § 12.4.3.1: join from a Welcome that someone's Commit produced for
   * one of the KeyPackages we published.
   *
   * @param tree from the delivery service, for a Welcome whose GroupInfo has no
   *   `ratchet_tree` extension. The tree is not trusted either way: its hash,
   *   its parent hashes and every leaf in it are verified here.
   * @throws `MLSError` if the Welcome is not for us, or anything about the
   *   group it describes does not verify
   */
  static fromWelcome(client: MLSClient, welcome: Welcome, tree: RatchetTree | null = null): MLSGroup {
    let suite = welcome.suite;
    let entry: EncryptedGroupSecrets | null = null;
    let ours: CreatedKeyPackage | null = null;
    for (let secrets of welcome.secrets) {
      let keyPackage = client.keyPackageForRef(secrets.newMember);
      if (keyPackage) {
        entry = secrets;
        ours = keyPackage;
        break;
      }
    }
    if (!entry || !ours) {
      throw new MLSError("This Welcome is not addressed to any KeyPackage of ours");
    }
    if (ours.keyPackage.suite != suite) {
      throw new MLSError(`The Welcome is for cipher suite ${suite.name}, our KeyPackage for another`);
    }
    let groupSecrets = entry.decrypt(suite, ours.initKeyPair.privateKey, welcome.encryptedGroupInfo);
    let pskSecret = client.pskSecret(groupSecrets.psks);
    // The welcome secret does not depend on the GroupContext (§ 8, Figure 22),
    // which is just as well: it is inside the GroupInfo this decrypts.
    let welcomeKey = KeySchedule.fromJoinerSecret(suite, groupSecrets.joinerSecret, kNoBytes, pskSecret)
      .welcomeKeyAndNonce();
    let groupInfo = welcome.decryptGroupInfo(welcomeKey);
    let context = groupInfo.groupContext;
    if (context.suite != suite) {
      throw new MLSError("The GroupInfo names a different cipher suite than the Welcome");
    }
    if (client.group(context.groupID)) {
      throw new MLSError("We are already a member of this group");
    }
    let ratchetTree = tree ?? (groupInfo.ratchetTree ? RatchetTree.fromBytes(suite, groupInfo.ratchetTree) : null);
    if (!ratchetTree) {
      throw new MLSError("The Welcome carries no ratchet_tree extension and no tree was supplied");
    }
    MLSGroup.verifyTree(ratchetTree, context);
    let signerLeaf = ratchetTree.leaf(groupInfo.signer);
    if (!signerLeaf || !groupInfo.verify(signerLeaf.signatureKey)) {
      throw new MLSError(`The GroupInfo signature of leaf ${groupInfo.signer} does not verify`);
    }

    let ourLeaf = ours.keyPackage.leafNode.toBytes();
    let leafIndex = ratchetTree.memberLeafIndices()
      .find(leafIndex => bytesEqual(ratchetTree.leaf(leafIndex).toBytes(), ourLeaf));
    if (leafIndex == undefined) {
      throw new MLSError("The ratchet tree holds no leaf of ours");
    }
    let privateKeys = new Map([[leafIndex * 2, ours.encryptionKeyPair.privateKey]]);
    if (groupSecrets.pathSecret) {
      MLSGroup.recoverPathSecret(ratchetTree, groupSecrets.pathSecret, leafIndex, groupInfo.signer, privateKeys);
    }
    let keySchedule = KeySchedule.fromJoinerSecret(suite, groupSecrets.joinerSecret, context.toBytes(), pskSecret);
    if (!groupInfo.verifyConfirmationTag(keySchedule.confirmationKey)) {
      throw new MLSError("The confirmation tag of the GroupInfo does not match the key schedule we derived");
    }
    let state = new GroupState(context, ratchetTree, leafIndex, privateKeys, keySchedule, pskSecret,
      groupInfo.confirmationTag,
      TranscriptHash.interim(suite, context.confirmedTranscriptHash, groupInfo.confirmationTag));
    let group = new MLSGroup(client, state);
    group.enteredEpoch();
    client.forgetKeyPackage(entry.newMember);   // Single use, § 10
    client.addGroup(group);
    return group;
  }

  /**
   * RFC 9420 § 12.4.3.2: join a group we were never added to, by committing
   * ourselves into it. Needs a GroupInfo with an `external_pub` extension,
   * which the delivery service publishes for exactly this.
   *
   * Unlike `commit()`, this applies immediately: the returned group is already
   * in the new epoch. If the delivery service rejects the Commit, throw the
   * group away and start over with a fresher GroupInfo.
   *
   * @param removeLeafIndex our own earlier appearance in the group, for the
   *   "resync" flavour that replaces a device that lost its state
   */
  static externalCommit(client: MLSClient, groupInfo: GroupInfo, tree: RatchetTree | null = null,
    removeLeafIndex: number | null = null): { group: MLSGroup, commit: MLSMessage } {
    let suite = groupInfo.suite;
    let context = groupInfo.groupContext;
    let externalPub = groupInfo.externalPub;
    if (!externalPub) {
      throw new MLSError("The GroupInfo has no external_pub extension, so we cannot join by external Commit");
    }
    let ratchetTree = tree ?? (groupInfo.ratchetTree ? RatchetTree.fromBytes(suite, groupInfo.ratchetTree) : null);
    if (!ratchetTree) {
      throw new MLSError("The GroupInfo carries no ratchet_tree extension and no tree was supplied");
    }
    MLSGroup.verifyTree(ratchetTree, context);
    let signerLeaf = ratchetTree.leaf(groupInfo.signer);
    if (!signerLeaf || !groupInfo.verify(signerLeaf.signatureKey)) {
      throw new MLSError(`The GroupInfo signature of leaf ${groupInfo.signer} does not verify`);
    }

    // § 8.3: the new epoch's init secret travels through HPKE's exporter, and
    // the group recovers it from the kem_output in the ExternalInit proposal
    let { kemOutput, initSecret } = suite.hpke.sendExternalInitSecret(externalPub);
    let proposals = [new ExternalInitProposal(kemOutput) as Proposal];
    if (removeLeafIndex != null) {
      proposals.push(new RemoveProposal(removeLeafIndex));
    }
    let committed = new ProposalList(proposals.map(proposal =>
      new CommittedProposal(proposal, Sender.newMemberCommit(), null)));
    committed.validate(ratchetTree, context.groupID, -1, true, null);
    let newTree = ratchetTree.clone();
    let applied = committed.applyTo(newTree, context.extensions);

    let { leaf, encryptionKeyPair } = client.createLeafNode(LeafNodeSource.Commit);
    let leafIndex = newTree.addLeaf(leaf);
    let provisional = context.clone();
    provisional.epoch = context.epoch + 1n;
    provisional.extensions = applied.extensions;
    let path = newTree.createUpdatePath(leafIndex, context.groupID, client.signatureKeyPair.privateKey, leaf,
      treeHash => {
        provisional.treeHash = treeHash;
        return provisional.toBytes();
      });
    let privateKeys = new Map(path.privateKeys);
    privateKeys.set(leafIndex * 2, encryptionKeyPair.privateKey);

    let content = FramedContent.commit(context.groupID, context.epoch, Sender.newMemberCommit(),
      new Commit(committed.orRefs, path.updatePath));
    // § 12.4.3.2: an external Commit is signed with the key in its own path,
    // and the GroupContext it signs over is the one from the GroupInfo
    let signed = AuthenticatedContent.sign(suite, WireFormat.PublicMessage, content,
      client.signatureKeyPair.privateKey, context);
    let interim = TranscriptHash.interim(suite, context.confirmedTranscriptHash, groupInfo.confirmationTag);
    let state = GroupState.forCommit(interim, signed, provisional, newTree, leafIndex, privateKeys,
      path.commitSecret, client.pskSecret(applied.psks), initSecret);
    let authenticated = new AuthenticatedContent(WireFormat.PublicMessage, content,
      new FramedContentAuthData(signed.auth.signature, state.confirmationTag));

    let group = new MLSGroup(client, state);
    group.enteredEpoch();
    client.addGroup(group);
    // No membership tag: we were not a member of the epoch we sent this in
    return { group, commit: new MLSMessage(PublicMessage.protect(suite, authenticated, kNoBytes, context)) };
  }

  /**
   * RFC 9420 § 12.4.1: build a Commit over the proposals of this epoch, without
   * applying it. Every proposal we cached this epoch goes in by reference, and
   * `proposals` are added by value.
   *
   * The group is untouched until `applyOwnCommit()`. Send the `commit`, and the
   * `welcome` and `groupInfo` alongside it if the delivery service wants them;
   * only once it accepted the Commit is the new epoch ours.
   */
  commit(proposals: Proposal[] = [], options: CommitOptions = {}): CommitResult {
    this.checkAlive();
    let committed = this.collectProposals(proposals);
    committed.validate(this.state.tree, this.groupID, this.ourLeafIndex, false, new Date());
    let tree = this.state.tree.clone();
    let privateKeys = new Map(this.state.privateKeys);
    let applied = committed.applyTo(tree, this.state.context.extensions);
    this.takeOverUpdatedLeaves(tree, applied, privateKeys);

    let provisional = this.state.context.clone();
    provisional.epoch = this.epoch + 1n;
    provisional.extensions = applied.extensions;
    let path: CreatedUpdatePath | null = null;
    let commitSecret: Uint8Array = new Uint8Array(this.suite.secretLength);
    // § 12.4: an UpdatePath is mandatory for a Commit that changes who is in
    // the group and for an empty one; for the rest we send one anyway, unless
    // the caller would rather keep the Commit small
    if (committed.requiresPath || options.path != false) {
      let { leaf, encryptionKeyPair } = this.client.createLeafNode(LeafNodeSource.Commit);
      path = tree.createUpdatePath(this.ourLeafIndex, this.groupID, this.client.signatureKeyPair.privateKey, leaf,
        treeHash => {
          provisional.treeHash = treeHash;
          return provisional.toBytes();
        }, applied.added.map(added => added.leafIndex));
      commitSecret = path.commitSecret;
      for (let nodeIndex of tree.directPath(this.ourLeafIndex * 2)) {
        privateKeys.delete(nodeIndex);
      }
      for (let [nodeIndex, privateKey] of path.privateKeys) {
        privateKeys.set(nodeIndex, privateKey);
      }
      privateKeys.set(this.ourLeafIndex * 2, encryptionKeyPair.privateKey);
    } else {
      provisional.treeHash = tree.treeHash();
    }

    let wireFormat = this.client.handshakeWireFormat;
    let content = FramedContent.commit(this.groupID, this.epoch, Sender.member(this.ourLeafIndex),
      new Commit(committed.orRefs, path?.updatePath ?? null), options.authenticatedData);
    let signed = AuthenticatedContent.sign(this.suite, wireFormat, content,
      this.client.signatureKeyPair.privateKey, this.state.context);
    let state = GroupState.forCommit(this.state.interimTranscriptHash, signed, provisional, tree, this.ourLeafIndex,
      privateKeys, commitSecret, this.client.pskSecret(applied.psks), this.state.keySchedule.initSecret);
    let authenticated = new AuthenticatedContent(wireFormat, content,
      new FramedContentAuthData(signed.auth.signature, state.confirmationTag));

    let groupInfo = this.createGroupInfo(state, options);
    return {
      commit: new MLSMessage(this.frameHandshake(authenticated)),
      welcome: this.createWelcome(state, applied, path, groupInfo),
      groupInfo,
      state,
    };
  }

  /** RFC 9420 § 14: move into the epoch that our own Commit created, once the
   * delivery service accepted it. Never process our own Commit with
   * `process()`: the committer cannot decrypt its own UpdatePath. */
  applyOwnCommit(result: CommitResult): void {
    this.checkAlive();
    if (result.state.context.epoch != this.epoch + 1n) {
      throw new MLSError(`This Commit creates epoch ${result.state.context.epoch}, but we are in epoch ${this.epoch}`);
    }
    this.enterEpoch(result.state);
  }

  /** RFC 9420 § 12.1: an Update, Add or Remove for the others to commit. Our
   * own state does not change; we cache the proposal so that we can apply it
   * when someone commits it by reference. */
  propose(proposal: Proposal): MLSMessage {
    this.checkAlive();
    let wireFormat = this.client.handshakeWireFormat;
    let content = FramedContent.proposal(this.groupID, this.epoch, Sender.member(this.ourLeafIndex), proposal);
    let authenticated = AuthenticatedContent.sign(this.suite, wireFormat, content,
      this.client.signatureKeyPair.privateKey, this.state.context);
    this.cacheProposal(authenticated);
    return new MLSMessage(this.frameHandshake(authenticated));
  }

  /** RFC 9420 § 12.1.2: rotate our own leaf key. The group only moves once
   * another member commits this. */
  proposeUpdate(): MLSMessage {
    let { leaf, encryptionKeyPair } = this.client.createLeafNode(LeafNodeSource.Update,
      this.client.keyPackageLifetimeDays, this.groupID, this.ourLeafIndex);
    this.updateKeys.set(base64Encode(leaf.encryptionKey), encryptionKeyPair.privateKey);
    return this.propose(new UpdateProposal(leaf));
  }

  /** Handle one inbound handshake or application message for this group. */
  process(message: MLSMessage): ProcessResult {
    this.checkAlive();
    if (message.body instanceof PublicMessage) {
      return this.processPublic(message.body);
    }
    if (message.body instanceof PrivateMessage) {
      return this.processPrivate(message.body);
    }
    throw new MLSError(`An MLSMessage of wire format ${message.wireFormat} is not a message to a group`);
  }

  /** RFC 9420 § 6.3: application data, always encrypted and always with our own
   * leaf's next application key, which is then gone. */
  encrypt(plaintext: Uint8Array, authenticatedData: Uint8Array = kNoBytes): MLSMessage {
    this.checkAlive();
    let content = FramedContent.application(this.groupID, this.epoch, Sender.member(this.ourLeafIndex),
      plaintext, authenticatedData);
    let authenticated = AuthenticatedContent.sign(this.suite, WireFormat.PrivateMessage, content,
      this.client.signatureKeyPair.privateKey, this.state.context);
    let key = this.state.secretTree.nextApplicationKey(this.ourLeafIndex);
    this.state.sentApplicationMessages = key.generation + 1;
    let message = PrivateMessage.encrypt(this.suite, authenticated, key, key.generation,
      this.state.senderDataKey, this.paddingLength(authenticated));
    this.client.storage?.saveGroup(this);
    return new MLSMessage(message);
  }

  /** RFC 9420 § 8.5: a secret for the application to use outside MLS, bound to
   * this epoch and to this group. */
  exportSecret(label: string, context: Uint8Array, length: number): Uint8Array {
    return this.state.keySchedule.exportSecret(label, context, length);
  }

  /** RFC 9420 § 8.6: the resumption PSK of an epoch we took part in, for a
   * PreSharedKey proposal that names it. */
  resumptionPSK(epoch: bigint): Uint8Array | null {
    return this.resumptionPSKs.get(epoch.toString()) ?? null;
  }

  /** A GroupInfo for the current epoch, e.g. so that another device of ours can
   * join by external Commit. */
  groupInfo(options: CommitOptions = {}): GroupInfo {
    return this.createGroupInfo(this.state, options);
  }

  toJSON(): any {
    return {
      context: base64Encode(this.state.context.toBytes()),
      tree: base64Encode(this.state.tree.toBytes()),
      leafIndex: this.state.leafIndex,
      joinerSecret: base64Encode(this.state.keySchedule.joinerSecret),
      pskSecret: base64Encode(this.state.pskSecret),
      confirmationTag: base64Encode(this.state.confirmationTag),
      interimTranscriptHash: base64Encode(this.state.interimTranscriptHash),
      sentHandshakeMessages: this.state.sentHandshakeMessages,
      sentApplicationMessages: this.state.sentApplicationMessages,
      privateKeys: [...this.state.privateKeys].map(([nodeIndex, key]) => [nodeIndex, base64Encode(key)]),
      updateKeys: [...this.updateKeys].map(([publicKey, key]) => [publicKey, base64Encode(key)]),
      resumptionPSKs: [...this.resumptionPSKs].map(([epoch, secret]) => [epoch, base64Encode(secret)]),
      proposals: [...this.proposals.values()].map(proposal => base64Encode(proposal.authenticated.toBytes())),
      removed: this.removed,
    };
  }

  /** The counterpart of `toJSON()`. The epochs we had already left are not
   * restored: RFC 9420 § 9.2 wants their keys gone anyway. */
  static fromJSON(client: MLSClient, json: any): MLSGroup {
    let context = GroupContext.fromBytes(base64Decode(json.context));
    let suite = context.suite;
    let tree = RatchetTree.fromBytes(suite, base64Decode(json.tree));
    let pskSecret = base64Decode(json.pskSecret);
    let keySchedule = KeySchedule.fromJoinerSecret(suite, base64Decode(json.joinerSecret), context.toBytes(),
      pskSecret);
    let privateKeys = new Map<number, Uint8Array>(json.privateKeys
      .map(([nodeIndex, key]: [number, string]) => [nodeIndex, base64Decode(key)]));
    let state = new GroupState(context, tree, json.leafIndex, privateKeys, keySchedule, pskSecret,
      base64Decode(json.confirmationTag), base64Decode(json.interimTranscriptHash));
    // The ratchets are where we left off, so that we never send under a key
    // that we already used before the restart, § 9.1
    state.sentHandshakeMessages = json.sentHandshakeMessages ?? 0;
    state.sentApplicationMessages = json.sentApplicationMessages ?? 0;
    let group = new MLSGroup(client, state);
    group.removed = !!json.removed;
    for (let [publicKey, key] of json.updateKeys ?? []) {
      group.updateKeys.set(publicKey, base64Decode(key));
    }
    for (let [epoch, secret] of json.resumptionPSKs ?? []) {
      group.resumptionPSKs.set(epoch, base64Decode(secret));
    }
    for (let proposal of json.proposals ?? []) {
      group.cacheProposal(AuthenticatedContent.fromBytes(base64Decode(proposal)));
    }
    // Not `client.addGroup()`: loading a group is not a change to save again
    client.groups.set(base64Encode(group.groupID), group);
    return group;
  }

  /** RFC 9420 § 6.2: signed, not encrypted, and with a membership tag that
   * proves the sender is in the group. */
  protected processPublic(message: PublicMessage): ProcessResult {
    let state = this.stateFor(message.content.groupID, message.content.epoch, message.content.contentType);
    return this.handle(message.unprotect(this.suite, state.keySchedule.membershipKey, state.context), state);
  }

  /** RFC 9420 § 6.3: the sender is hidden, so the `SenderData` has to be
   * decrypted first, and only then can the message key be looked up. */
  protected processPrivate(message: PrivateMessage): ProcessResult {
    let state = this.stateFor(message.groupID, message.epoch, message.contentType);
    let senderData = message.senderData(this.suite, state.senderDataKey);
    if (!state.tree.leaf(senderData.leafIndex)) {
      throw new MLSError(`A PrivateMessage claims to come from blank leaf ${senderData.leafIndex}`);
    }
    let key = message.contentType == ContentType.Application
      ? state.secretTree.applicationKey(senderData.leafIndex, senderData.generation)
      : state.secretTree.handshakeKey(senderData.leafIndex, senderData.generation);
    return this.handle(message.decrypt(this.suite, key, senderData), state);
  }

  /** RFC 9420 § 6.1: verify the signature, then act on the content. */
  protected handle(content: AuthenticatedContent, state: GroupState): ProcessResult {
    let sender = content.content.sender;
    if (!content.verify(this.suite, this.signatureKeyOf(content, state), state.context)) {
      throw new MLSError(`The signature of a ${ContentType[content.content.contentType]} does not verify`);
    }
    if (content.content.contentType == ContentType.Application) {
      if (content.wireFormat != WireFormat.PrivateMessage) {
        throw new MLSError("Application data must be sent as a PrivateMessage");   // § 6
      }
      return { kind: "application", plaintext: content.content.applicationData, senderLeafIndex: sender.index };
    }
    if (state != this.state) {
      throw new MLSError(`A handshake message for epoch ${state.context.epoch}, but we are in epoch ${this.epoch}`);
    }
    if (content.content.contentType == ContentType.Proposal) {
      this.cacheProposal(content);
      return { kind: "proposal", senderLeafIndex: sender.index };
    }
    return this.processCommit(content);
  }

  /** RFC 9420 § 12.4.2. The whole procedure, in the order the RFC gives it. */
  protected processCommit(content: AuthenticatedContent): ProcessResult {
    let sender = content.content.sender;
    if (sender.type == SenderType.Member && sender.index == this.ourLeafIndex) {
      throw new MLSError("Our own Commit came back to us; apply it with applyOwnCommit() instead");
    }
    let external = sender.type == SenderType.NewMemberCommit;
    if (!external && sender.type != SenderType.Member) {
      throw new MLSError(`A ${SenderType[sender.type]} sender cannot send a Commit`);
    }
    let commit = content.content.commit;
    let committed = this.resolveProposals(commit.proposals, sender);
    committed.validate(this.state.tree, this.groupID, external ? -1 : sender.index, external, null);
    let tree = this.state.tree.clone();
    let privateKeys = new Map(this.state.privateKeys);
    let applied = committed.applyTo(tree, this.state.context.extensions);
    let added = applied.added.map(added => tree.leaf(added.leafIndex));
    let removed = applied.removed.map(leafIndex => this.state.tree.leaf(leafIndex));
    if (applied.removed.includes(this.ourLeafIndex)) {
      // § 12.4.2: we cannot follow this epoch, and there is nothing to verify
      // it against either, because the commit secret was never encrypted to us
      this.removed = true;
      this.client.removeGroup(this);
      return { kind: "commit", added, removed, weWereRemoved: true };
    }
    this.takeOverUpdatedLeaves(tree, applied, privateKeys);

    let provisional = this.state.context.clone();
    provisional.epoch = this.epoch + 1n;
    provisional.extensions = applied.extensions;
    let commitSecret: Uint8Array = new Uint8Array(this.suite.secretLength);
    if (!commit.path) {
      if (committed.requiresPath || !commit.proposals.length) {
        throw new MLSError("This Commit changes the group or is empty, so it must carry an UpdatePath");
      }
      provisional.treeHash = tree.treeHash();
    } else {
      let committerLeafIndex = external ? tree.addLeaf(commit.path.leafNode.clone()) : sender.index;
      this.verifyUpdatePath(tree, commit.path, committerLeafIndex);
      // The HPKE context is the provisional GroupContext, whose tree hash is
      // the one of the tree *after* this path was merged
      let merged = tree.clone();
      merged.mergeUpdatePath(committerLeafIndex, commit.path);
      provisional.treeHash = merged.treeHash();
      commitSecret = tree.applyUpdatePath(committerLeafIndex, commit.path, provisional.toBytes(), this.ourLeafIndex,
        privateKeys, applied.added.map(added => added.leafIndex));
    }

    let initSecret = external
      ? this.suite.hpke.receiveExternalInitSecret(this.state.keySchedule.externalKeyPair().privateKey,
        externalInitOf(committed))
      : this.state.keySchedule.initSecret;
    let state = GroupState.forCommit(this.state.interimTranscriptHash, content, provisional, tree, this.ourLeafIndex,
      privateKeys, commitSecret, this.client.pskSecret(applied.psks), initSecret);
    if (!bytesEqual(state.confirmationTag, content.auth.confirmationTag ?? kNoBytes)) {
      throw new MLSError("The confirmation tag of the Commit does not match the key schedule we derived");
    }
    this.enterEpoch(state);
    return { kind: "commit", added, removed };
  }

  /** RFC 9420 § 12.4.2: what a Commit's UpdatePath has to satisfy before it may
   * be merged. The parent hashes are checked by `mergeUpdatePath()` itself. */
  protected verifyUpdatePath(tree: RatchetTree, path: UpdatePath, committerLeafIndex: number): void {
    let old = this.state.tree.leaf(committerLeafIndex);
    if (path.leafNode.source != LeafNodeSource.Commit) {
      throw new MLSError("The leaf node of an UpdatePath must have leaf_node_source commit");
    }
    if (!path.leafNode.verify(this.suite, this.groupID, committerLeafIndex) ||
      !path.leafNode.isValidAt(new Date())) {
      throw new MLSError(`The new leaf node of committer ${committerLeafIndex} is not valid`);
    }
    if (old && bytesEqual(old.encryptionKey, path.leafNode.encryptionKey)) {
      throw new MLSError(`Committer ${committerLeafIndex} reused the encryption key of its old leaf`);
    }
    // "none of the public keys in the UpdatePath appear in any node of the new
    // ratchet tree" — apart from the committer's own path, which it replaces
    let replaced = new Set([committerLeafIndex * 2, ...tree.directPath(committerLeafIndex * 2)]);
    let known = new Set<string>();
    for (let nodeIndex = 0; nodeIndex < tree.nodeCount; nodeIndex++) {
      let node = nodeIndex % 2 ? tree.parentNode(nodeIndex) : tree.leaf(nodeIndex / 2);
      if (node && !replaced.has(nodeIndex)) {
        known.add(base64Encode(node.encryptionKey));
      }
    }
    for (let key of [path.leafNode.encryptionKey, ...path.nodes.map(node => node.encryptionKey)]) {
      if (known.has(base64Encode(key))) {
        throw new MLSError("An UpdatePath key is already in use elsewhere in the ratchet tree");
      }
    }
  }

  /** RFC 9420 § 12.1.2: an Update that a Commit applied to our own leaf gives
   * us back a leaf whose private key only we know, from when we proposed it. */
  protected takeOverUpdatedLeaves(tree: RatchetTree, applied: AppliedProposals,
    privateKeys: Map<number, Uint8Array>): void {
    for (let leafIndex of applied.updated) {
      if (leafIndex != this.ourLeafIndex) {
        continue;
      }
      let privateKey = this.updateKeys.get(base64Encode(tree.leaf(leafIndex).encryptionKey));
      if (!privateKey) {
        throw new MLSError("A Commit replaced our leaf with an Update whose private key we do not have");
      }
      privateKeys.set(leafIndex * 2, privateKey);
    }
    // Every node a proposal blanked took our private key with it, § 4.2
    for (let nodeIndex of [...privateKeys.keys()]) {
      let node = nodeIndex % 2 ? tree.parentNode(nodeIndex) : tree.leaf(nodeIndex / 2);
      if (!node) {
        privateKeys.delete(nodeIndex);
      }
    }
  }

  /** RFC 9420 § 12.4.1: the proposals our own Commit will cover, the ones we
   * cached this epoch by reference and the caller's by value.
   *
   * § 12.2 forbids some combinations rather than resolving them, and asks the
   * committer to pick: our own Update never goes in, and where several
   * proposals touch one leaf, a Remove wins over an Update and a later Update
   * wins over an earlier one. */
  protected collectProposals(proposals: Proposal[]): ProposalList {
    let cached = [...this.proposals.values()]
      .filter(entry => !(entry.proposal instanceof UpdateProposal && entry.sender.index == this.ourLeafIndex));
    let entries = [...cached, ...proposals.map(proposal =>
      new CommittedProposal(proposal, Sender.member(this.ourLeafIndex), null))];
    let touched = new Map<number, CommittedProposal>();
    for (let entry of entries) {
      let leafIndex = entry.touchedLeafIndex;
      if (leafIndex == null) {
        continue;
      }
      let previous = touched.get(leafIndex);
      if (!previous || !(previous.proposal instanceof RemoveProposal)) {
        touched.set(leafIndex, entry);
      }
    }
    return new ProposalList(entries.filter(entry =>
      entry.touchedLeafIndex == null || touched.get(entry.touchedLeafIndex) == entry));
  }

  /** RFC 9420 § 12.4: what a received Commit's `proposals` vector points at.
   * A proposal by reference must be one we saw in this epoch, and it keeps the
   * sender it had then — an Update replaces *its* sender's leaf, not the
   * committer's. */
  protected resolveProposals(orRefs: readonly ProposalOrRef[], committer: Sender): ProposalList {
    return new ProposalList(orRefs.map(orRef => {
      if (orRef.proposal) {
        return new CommittedProposal(orRef.proposal, committer, null);
      }
      let cached = this.proposals.get(base64Encode(orRef.reference));
      if (!cached) {
        throw new MLSError(`The Commit references proposal ${base64Encode(orRef.reference)}, which we never saw`);
      }
      return cached;
    }));
  }

  /** RFC 9420 § 12.1: keep the proposal under its `MakeProposalRef`, which
   * hashes the whole framed object, so that we can apply it when someone
   * commits it by reference. */
  protected cacheProposal(content: AuthenticatedContent): void {
    let proposal = content.content.proposal;
    let sender = content.content.sender;
    if (sender.type == SenderType.External && !kExternalProposalTypes.includes(proposal.type)) {
      throw new MLSError(`An external sender may not send a ${ProposalType[proposal.type]} proposal`);
    }
    if (sender.type == SenderType.NewMemberProposal && !(proposal instanceof AddProposal)) {
      throw new MLSError("A new member can only propose to add itself");
    }
    let ref = content.ref(this.suite);
    this.proposals.set(base64Encode(ref), new CommittedProposal(proposal, sender, content, ref));
    this.client.storage?.saveGroup(this);
  }

  /** RFC 9420 § 6.1: which key signed a message depends on who sent it. */
  protected signatureKeyOf(content: AuthenticatedContent, state: GroupState): Uint8Array {
    let sender = content.content.sender;
    switch (sender.type) {
      case SenderType.Member: {
        let leaf = state.tree.leaf(sender.index);
        if (!leaf) {
          throw new MLSError(`A message claims to come from blank leaf ${sender.index}`);
        }
        return leaf.signatureKey;
      }
      case SenderType.External: {
        // § 12.1.8.1: a party the group listed in its external_senders extension
        let extension = Extension.find(state.context.extensions, ExtensionType.ExternalSenders);
        let external = extension ? ExternalSender.listFromExtension(extension)[sender.index] : null;
        if (!external) {
          throw new MLSError(`There is no external sender ${sender.index} in this group`);
        }
        return external.signatureKey;
      }
      case SenderType.NewMemberCommit:
        // § 12.4.3.2: an external Commit signs with the key in its own path
        if (!content.content.commit?.path) {
          throw new MLSError("An external Commit must carry an UpdatePath");
        }
        return content.content.commit.path.leafNode.signatureKey;
      default:
        // § 12.1.8: a joiner proposing to add itself
        if (!(content.content.proposal instanceof AddProposal)) {
          throw new MLSError("A new member can only propose to add itself");
        }
        return content.content.proposal.keyPackage.leafNode.signatureKey;
    }
  }

  /** RFC 9420 § 6: the framing the application asked for. A Commit or Proposal
   * is protected with the keys of the epoch it is *sent* in, i.e. the current
   * one, even when it creates the next. Encrypting one consumes a generation of
   * our handshake ratchet even if the Commit is then rejected, which is the one
   * thing about a pending Commit that does touch the current epoch — harmless,
   * because those keys are single use anyway. */
  protected frameHandshake(content: AuthenticatedContent): PublicMessage | PrivateMessage {
    if (content.wireFormat == WireFormat.PublicMessage) {
      return PublicMessage.protect(this.suite, content, this.state.keySchedule.membershipKey, this.state.context);
    }
    let key = this.state.secretTree.nextHandshakeKey(this.ourLeafIndex);
    this.state.sentHandshakeMessages = key.generation + 1;
    return PrivateMessage.encrypt(this.suite, content, key, key.generation, this.state.senderDataKey,
      this.paddingLength(content));
  }

  /** RFC 9420 § 15.1: how many zero bytes to append inside the ciphertext, so
   * that its length says as little as possible about the content. */
  protected paddingLength(content: AuthenticatedContent): number {
    let block = this.client.paddingBlockSize;
    if (!block) {
      return 0;
    }
    let length = tlsSerialize(writer => {
      content.content.writeBodyTo(writer);
      content.auth.writeTo(writer);
    }).length;
    return (block - length % block) % block;
  }

  /** RFC 9420 § 12.4.1: the GroupInfo of an epoch. Wire uploads one with every
   * Commit, so that the next joiner can be welcomed or commit itself in. */
  protected createGroupInfo(state: GroupState, options: CommitOptions): GroupInfo {
    let extensions = [...options.groupInfoExtensions ?? []];
    if (options.ratchetTreeExtension != false) {
      extensions.push(new Extension(ExtensionType.RatchetTree, state.tree.toBytes()));
    }
    if (options.externalPubExtension != false) {
      // § 12.4.3.2 `ExternalPub`, the key an external Commit encrypts to
      let externalPub = state.keySchedule.externalKeyPair().publicKey;
      extensions.push(new Extension(ExtensionType.ExternalPub,
        tlsSerialize(writer => writer.opaque(externalPub))));
    }
    let groupInfo = new GroupInfo(state.context, extensions, state.confirmationTag, state.leafIndex);
    groupInfo.sign(this.client.signatureKeyPair.privateKey);
    return groupInfo;
  }

  /** RFC 9420 § 12.4.3.1: one Welcome for everybody the Commit added. The
   * GroupInfo has to be encrypted first — it is the HPKE context of each
   * member's `EncryptedGroupSecrets`. */
  protected createWelcome(state: GroupState, applied: AppliedProposals, path: CreatedUpdatePath | null,
    groupInfo: GroupInfo): MLSMessage | null {
    if (!applied.added.length) {
      return null;
    }
    let encryptedGroupInfo = Welcome.encryptGroupInfo(this.suite, groupInfo, state.keySchedule.welcomeKeyAndNonce());
    let secrets = applied.added.map(({ leafIndex, keyPackage }) => EncryptedGroupSecrets.encrypt(this.suite,
      keyPackage.ref(this.suite), keyPackage.initKey, encryptedGroupInfo,
      new GroupSecrets(state.keySchedule.joinerSecret, path?.pathSecrets.get(leafIndex) ?? null, applied.psks)));
    return new MLSMessage(new Welcome(this.suite, secrets, encryptedGroupInfo));
  }

  /** The epoch a message belongs to. An application message may still arrive
   * from an epoch we just left, RFC 9420 § 15.3; a handshake message may not. */
  protected stateFor(groupID: Uint8Array, epoch: bigint, contentType: ContentType): GroupState {
    if (!bytesEqual(groupID, this.groupID)) {
      throw new MLSError("The message is for another group");
    }
    if (epoch == this.epoch) {
      return this.state;
    }
    // A handshake message of an epoch we left is worthless: the group moved on
    let past = contentType == ContentType.Application
      ? this.pastEpochs.find(state => state.context.epoch == epoch)
      : null;
    if (!past) {
      throw new MLSError(`The message is for epoch ${epoch}, but the group is in epoch ${this.epoch}`);
    }
    return past;
  }

  protected enterEpoch(state: GroupState): void {
    this.pastEpochs.push(this.state);
    while (this.pastEpochs.length > kMaxPastEpochs) {
      this.pastEpochs.shift();
    }
    this.state = state;
    this.proposals.clear();
    this.updateKeys.clear();
    this.enteredEpoch();
  }

  protected enteredEpoch(): void {
    this.resumptionPSKs.set(this.epoch.toString(), this.state.keySchedule.resumptionPSK);
    while (this.resumptionPSKs.size > kMaxResumptionPSKs) {
      this.resumptionPSKs.delete(this.resumptionPSKs.keys().next().value);
    }
    this.client.storage?.saveGroup(this);
  }

  protected checkAlive(): void {
    if (this.removed) {
      throw new MLSError("A Commit removed us from this group");
    }
  }

  /** RFC 9420 § 12.4.3.1: the new member derives the private keys of the nodes
   * from the lowest common ancestor of itself and the committer upwards, from
   * the one path secret the Welcome carries. */
  protected static recoverPathSecret(tree: RatchetTree, pathSecret: Uint8Array, leafIndex: number,
    signerLeafIndex: number, privateKeys: Map<number, Uint8Array>): void {
    let suite = tree.suite;
    let filtered = tree.filteredDirectPath(signerLeafIndex);
    let position = filtered.indexOf(tree.commonAncestor(leafIndex * 2, signerLeafIndex * 2));
    if (position < 0) {
      throw new MLSError("The Welcome path secret is for a node that the committer did not re-key");
    }
    let secret = pathSecret;
    for (let i = position; i < filtered.length; i++) {
      let keyPair = suite.kem.deriveKeyPair(suite.deriveSecret(secret, "node"));
      if (!bytesEqual(keyPair.publicKey, tree.parentNode(filtered[i]).encryptionKey)) {
        throw new MLSError(`The Welcome path secret does not match the key of node ${filtered[i]}`);
      }
      privateKeys.set(filtered[i], keyPair.privateKey);
      secret = suite.deriveSecret(secret, "path");
    }
  }

  /** RFC 9420 § 12.4.3.1 "Verify the integrity of the ratchet tree", for a tree
   * we are handed rather than one we followed along. Everything in it has to be
   * checked: the delivery service that stores it is not trusted. */
  protected static verifyTree(tree: RatchetTree, context: GroupContext): void {
    if (!bytesEqual(tree.treeHash(), context.treeHash)) {
      throw new MLSError("The ratchet tree does not have the tree hash of the GroupContext");
    }
    if (!tree.verifyParentHashes()) {
      throw new MLSError("The parent hashes of the ratchet tree do not verify");
    }
    // No lifetimes: § 7.3 only recommends checking them on a leaf we receive,
    // and a member whose KeyPackage expired while we were being welcomed must
    // not cost us the whole group
    if (!tree.verifyLeaves(context.groupID)) {
      throw new MLSError("A leaf node of the ratchet tree does not verify");
    }
    let encryptionKeys = new Set<string>();
    let signatureKeys = new Set<string>();
    for (let leafIndex of tree.memberLeafIndices()) {
      let leaf = tree.leaf(leafIndex);
      if (!encryptionKeys.add(base64Encode(leaf.encryptionKey)) ||
        !signatureKeys.add(base64Encode(leaf.signatureKey))) {
        throw new MLSError(`Leaf ${leafIndex} reuses a key of another member`);   // § 7.3
      }
    }
    for (let nodeIndex = 1; nodeIndex < tree.nodeCount; nodeIndex += 2) {
      let parent = tree.parentNode(nodeIndex);
      if (!parent) {
        continue;
      }
      if (!encryptionKeys.add(base64Encode(parent.encryptionKey))) {
        throw new MLSError(`Node ${nodeIndex} reuses an encryption key of another node`);
      }
      for (let leafIndex of parent.unmergedLeaves) {
        let path = tree.leaf(leafIndex) ? tree.directPath(leafIndex * 2) : [];
        let end = path.indexOf(nodeIndex);
        if (end < 0) {
          throw new MLSError(`Node ${nodeIndex} lists leaf ${leafIndex}, which is blank or not below it`);
        }
        if (path.slice(0, end).some(between => tree.parentNode(between) &&
          !tree.parentNode(between).unmergedLeaves.includes(leafIndex))) {
          throw new MLSError(`Leaf ${leafIndex} is unmerged at node ${nodeIndex} but merged below it`);
        }
      }
    }
  }
}

/** What `commit()` produced, RFC 9420 § 12.4.1. Send `commit` to the group,
 * `welcome` to the members it adds, and `groupInfo` to the delivery service if
 * it caches one; then `applyOwnCommit()`. */
export interface CommitResult {
  /** The Commit, framed and ready to send */
  commit: MLSMessage;
  /** Present when the Commit added members */
  welcome: MLSMessage | null;
  /** The new epoch's GroupInfo, which Wire uploads with every commit bundle */
  groupInfo: GroupInfo;
  /** The epoch this Commit creates, still unapplied. @see `MLSGroup.applyOwnCommit()` */
  state: GroupState;
}

export interface CommitOptions {
  /** `false` leaves out the UpdatePath where RFC 9420 § 12.4 allows it, i.e.
   * for a Commit of nothing but Add and PreSharedKey proposals. Default is to
   * always send one, which is what gives the new epoch post-compromise
   * security with regard to us. */
  path?: boolean;
  /** RFC 9420 § 12.4.3.3: ship the whole ratchet tree in the GroupInfo, which
   * is what Wire does. Default true. */
  ratchetTreeExtension?: boolean;
  /** RFC 9420 § 12.4.3.2: publish `external_pub`, so that another client can
   * join by external Commit. Default true. */
  externalPubExtension?: boolean;
  groupInfoExtensions?: Extension[];
  /** Data that the delivery service may read, but that the signature covers */
  authenticatedData?: Uint8Array;
}

export interface ProcessResult {
  kind: "application" | "proposal" | "commit";
  /** For "application" */
  plaintext?: Uint8Array;
  /** -1 for a sender that is not a member of the group */
  senderLeafIndex?: number;
  /** For "commit": what changed, so that the application can show it */
  added?: LeafNode[];
  removed?: LeafNode[];
  /** The Commit removed us; the group is dead afterwards */
  weWereRemoved?: boolean;
}

/**
 * Everything one epoch of a group defines, RFC 9420 § 8.
 *
 * A Commit does not edit any of this: it builds a whole new `GroupState` from a
 * clone of the tree, and the group swaps the new one in when the Commit is
 * accepted. That is what § 14 requires of a committer whose Commit may still
 * lose a race, and it is what lets a message from the epoch we just left still
 * be decrypted.
 */
export class GroupState {
  readonly context: GroupContext;
  readonly tree: RatchetTree;
  /** Our own leaf. It only changes when we join, or rejoin by external Commit. */
  readonly leafIndex: number;
  /** Node index → our HPKE private key, for the nodes above us that we know,
   * the tree invariant of § 4.2 */
  readonly privateKeys: Map<number, Uint8Array>;
  readonly keySchedule: KeySchedule;
  /** The `psk_secret` this epoch was derived with, § 8.4. Kept so that the key
   * schedule can be rebuilt from the joiner secret after a restart. */
  readonly pskSecret: Uint8Array;
  /** The confirmation tag of the Commit that started this epoch */
  readonly confirmationTag: Uint8Array;
  readonly interimTranscriptHash: Uint8Array;
  /** Generations of our own ratchets that we already sent under, so that a
   * restart does not reuse a key, § 9.1 */
  sentHandshakeMessages = 0;
  sentApplicationMessages = 0;
  protected secretTreeCache: SecretTree | null = null;

  constructor(context: GroupContext, tree: RatchetTree, leafIndex: number, privateKeys: Map<number, Uint8Array>,
    keySchedule: KeySchedule, pskSecret: Uint8Array, confirmationTag: Uint8Array, interimTranscriptHash: Uint8Array) {
    this.context = context;
    this.tree = tree;
    this.leafIndex = leafIndex;
    this.privateKeys = privateKeys;
    this.keySchedule = keySchedule;
    this.pskSecret = pskSecret;
    this.confirmationTag = confirmationTag;
    this.interimTranscriptHash = interimTranscriptHash;
  }

  /**
   * RFC 9420 § 12.4.1 and § 12.4.2: the epoch that a Commit starts.
   *
   * @param context the *provisional* GroupContext that the UpdatePath was
   *   encrypted under — new epoch, new tree hash, old confirmed transcript
   *   hash. Filling in the new confirmed transcript hash here is what turns it
   *   into the GroupContext of the new epoch.
   * @param signed the Commit, without its confirmation tag, which is computed
   *   from the very transcript hash that this signature feeds
   * @param initSecret of the previous epoch, or, for an external Commit, the
   *   one the ExternalInit proposal carries (§ 8.3)
   */
  static forCommit(previousInterim: Uint8Array, signed: AuthenticatedContent, context: GroupContext,
    tree: RatchetTree, leafIndex: number, privateKeys: Map<number, Uint8Array>, commitSecret: Uint8Array,
    pskSecret: Uint8Array, initSecret: Uint8Array): GroupState {
    let suite = context.suite;
    context.confirmedTranscriptHash = TranscriptHash.confirmed(suite, previousInterim,
      signed.confirmedTranscriptHashInput());
    let keySchedule = KeySchedule.advance(suite, initSecret, commitSecret, context.toBytes(), pskSecret);
    let confirmationTag = suite.mac(keySchedule.confirmationKey, context.confirmedTranscriptHash);
    return new GroupState(context, tree, leafIndex, privateKeys, keySchedule, pskSecret, confirmationTag,
      TranscriptHash.interim(suite, context.confirmedTranscriptHash, confirmationTag));
  }

  /** RFC 9420 § 9: the message keys of this epoch, derived on first use. */
  get secretTree(): SecretTree {
    if (!this.secretTreeCache) {
      this.secretTreeCache = new SecretTree(this.context.suite, this.tree.leafCount,
        this.keySchedule.encryptionSecret, this.keySchedule.senderDataSecret);
      for (let i = 0; i < this.sentHandshakeMessages; i++) {
        this.secretTreeCache.nextHandshakeKey(this.leafIndex);
      }
      for (let i = 0; i < this.sentApplicationMessages; i++) {
        this.secretTreeCache.nextApplicationKey(this.leafIndex);
      }
    }
    return this.secretTreeCache;
  }

  /** RFC 9420 § 6.3.2, as `PrivateMessage` wants it: a function, because the
   * key depends on a sample of the ciphertext it protects. */
  get senderDataKey(): (ciphertext: Uint8Array) => MessageKey {
    return ciphertext => this.secretTree.senderDataKey(ciphertext);
  }
}

/**
 * The proposals that one Commit covers, RFC 9420 § 12.2 and § 12.3.
 *
 * The list is a thing of its own because both halves of a Commit work on it:
 * the committer validates it before building the Commit, and every receiver
 * validates the very same list again, and both then apply it in the fixed order
 * of § 12.3 — GroupContextExtensions, Updates, Removes, Adds — which is not the
 * order the proposals are in.
 */
class ProposalList {
  readonly entries: CommittedProposal[];

  constructor(entries: CommittedProposal[]) {
    this.entries = entries;
  }

  get orRefs(): ProposalOrRef[] {
    return this.entries.map(entry => entry.orRef);
  }

  /** RFC 9420 § 12.4: a Commit that changes who is in the group, or that
   * covers nothing at all, must re-key the committer's path. */
  get requiresPath(): boolean {
    return !this.entries.length || this.entries.some(entry => entry.proposal.requiresPath);
  }

  of<T extends Proposal>(type: new (...args: any[]) => T): CommittedProposal[] {
    return this.entries.filter(entry => entry.proposal instanceof type);
  }

  /**
   * RFC 9420 § 12.2. The committer and every receiver run this, so that a
   * Commit whose proposals do not add up is rejected by everybody rather than
   * splitting the group.
   *
   * @param committerLeafIndex -1 for an external Commit, whose sender has no
   *   leaf in the group yet
   * @throws `MLSError` naming the rule that the list breaks
   */
  validate(tree: RatchetTree, groupID: Uint8Array, committerLeafIndex: number, external: boolean,
    now: Date | null): void {
    if (external) {
      this.validateExternal();
    } else if (this.of(ExternalInitProposal).length) {
      throw new MLSError("An ExternalInit proposal is only allowed in an external Commit");
    }
    if (this.entries.some(entry => entry.proposal.type == ProposalType.ReInit)) {
      throw new MLSError("ReInit proposals are not supported");   // § 11.2
    }
    if (this.of(GroupContextExtensionsProposal).length > 1) {
      throw new MLSError("A Commit may carry only one GroupContextExtensions proposal");
    }
    let touched = new Set<number>();
    for (let entry of this.of(UpdateProposal).concat(this.of(RemoveProposal))) {
      let leafIndex = entry.touchedLeafIndex;
      if (!touched.add(leafIndex)) {
        throw new MLSError(`Two proposals of this Commit apply to leaf ${leafIndex}`);
      }
      if (leafIndex == committerLeafIndex) {
        throw new MLSError(`The ${ProposalType[entry.proposal.type]} proposal of this Commit applies to its own sender`);
      }
      if (!tree.leaf(leafIndex)) {
        throw new MLSError(`A proposal of this Commit applies to blank leaf ${leafIndex}`);
      }
    }
    for (let entry of this.of(UpdateProposal)) {
      let proposal = entry.proposal as UpdateProposal;
      if (entry.sender.type != SenderType.Member) {
        throw new MLSError("An Update proposal must come from a member");
      }
      if (proposal.leafNode.source != LeafNodeSource.Update) {
        throw new MLSError("The leaf node of an Update proposal must have leaf_node_source update");
      }
      if (!proposal.leafNode.verify(tree.suite, groupID, entry.sender.index) ||
        !proposal.leafNode.isValidAt(new Date())) {
        throw new MLSError(`The leaf node of the Update of leaf ${entry.sender.index} is not valid`);
      }
      if (bytesEqual(proposal.leafNode.encryptionKey, tree.leaf(entry.sender.index).encryptionKey)) {
        throw new MLSError(`The Update of leaf ${entry.sender.index} reuses its old encryption key`);
      }
    }
    let removed = new Set(this.of(RemoveProposal).map(entry => entry.touchedLeafIndex));
    let signatureKeys = new Set(tree.memberLeafIndices().filter(leafIndex => !removed.has(leafIndex))
      .map(leafIndex => base64Encode(tree.leaf(leafIndex).signatureKey)));
    for (let entry of this.of(AddProposal)) {
      let keyPackage = (entry.proposal as AddProposal).keyPackage;
      if (keyPackage.suite != tree.suite) {
        throw new MLSError(`An Add proposal offers a KeyPackage for ${keyPackage.suite.name}`);   // § 10.1
      }
      keyPackage.validate(groupID, now ?? ignoringLifetime(keyPackage.leafNode));
      if (!signatureKeys.add(base64Encode(keyPackage.leafNode.signatureKey))) {
        throw new MLSError("An Add proposal adds a client that is already in the group");
      }
    }
    let pskIDs = new Set<string>();
    for (let entry of this.of(PreSharedKeyProposal)) {
      if (!pskIDs.add(base64Encode((entry.proposal as PreSharedKeyProposal).psk.toBytes()))) {
        throw new MLSError("Two PreSharedKey proposals of this Commit name the same PSK");
      }
    }
  }

  /** RFC 9420 § 12.2: an external Commit may do nothing but let its sender in,
   * because a joiner cannot judge whether a proposal of the group is valid. */
  protected validateExternal(): void {
    if (this.of(ExternalInitProposal).length != 1) {
      throw new MLSError("An external Commit must carry exactly one ExternalInit proposal");
    }
    if (this.of(RemoveProposal).length > 1) {
      throw new MLSError("An external Commit may remove at most one member");
    }
    if (this.entries.some(entry => entry.orRef.reference)) {
      throw new MLSError("An external Commit cannot reference proposals of the group");
    }
    let allowed = this.of(ExternalInitProposal).length + this.of(RemoveProposal).length +
      this.of(PreSharedKeyProposal).length;
    if (allowed != this.entries.length) {
      throw new MLSError("An external Commit may only carry ExternalInit, Remove and PreSharedKey proposals");
    }
  }

  /** RFC 9420 § 12.3, in exactly the order given there: the extensions first,
   * because the other proposals are judged against them, then Updates, then
   * Removes — which free up leaves — and only then the Adds that fill them. */
  applyTo(tree: RatchetTree, extensions: Extension[]): AppliedProposals {
    let applied = new AppliedProposals([...extensions]);
    for (let entry of this.of(GroupContextExtensionsProposal)) {
      applied.extensions = (entry.proposal as GroupContextExtensionsProposal).extensions;
    }
    for (let entry of this.of(UpdateProposal)) {
      tree.updateLeaf(entry.sender.index, (entry.proposal as UpdateProposal).leafNode.clone());
      applied.updated.push(entry.sender.index);
    }
    for (let entry of this.of(RemoveProposal)) {
      tree.removeLeaf(entry.touchedLeafIndex);
      applied.removed.push(entry.touchedLeafIndex);
    }
    for (let entry of this.of(AddProposal)) {
      let keyPackage = (entry.proposal as AddProposal).keyPackage;
      applied.added.push({ leafIndex: tree.addLeaf(keyPackage.leafNode.clone()), keyPackage });
    }
    for (let entry of this.of(PreSharedKeyProposal)) {
      applied.psks.push((entry.proposal as PreSharedKeyProposal).psk);
    }
    return applied;
  }
}

/** One proposal that a Commit applies, with the sender it had, RFC 9420 § 12.1.
 * An Update replaces *its own sender's* leaf, and a proposal committed by
 * reference was sent by somebody other than the committer, so the two cannot be
 * separated. */
class CommittedProposal {
  readonly proposal: Proposal;
  readonly sender: Sender;
  /** The framed proposal, for one that reached us in a message: it is what
   * `MakeProposalRef` hashes, and what we persist. Null for a proposal that the
   * committer makes up on the spot and puts into the Commit by value. */
  readonly authenticated: AuthenticatedContent | null;
  /** `MakeProposalRef(authenticated)`, RFC 9420 § 5.2 */
  readonly ref: Uint8Array | null;

  constructor(proposal: Proposal, sender: Sender, authenticated: AuthenticatedContent | null,
    ref: Uint8Array | null = null) {
    this.proposal = proposal;
    this.sender = sender;
    this.authenticated = authenticated;
    this.ref = ref;
  }

  /** RFC 9420 § 12.4: by reference for a proposal the group has already seen,
   * by value for one the committer makes up on the spot. */
  get orRef(): ProposalOrRef {
    return this.ref ? ProposalOrRef.forReference(this.ref) : ProposalOrRef.forProposal(this.proposal);
  }

  /** The leaf that an Update or a Remove changes, or null for the rest. */
  get touchedLeafIndex(): number | null {
    if (this.proposal instanceof RemoveProposal) {
      return this.proposal.removed;
    }
    return this.proposal instanceof UpdateProposal ? this.sender.index : null;
  }
}

/** What applying a Commit's proposal list did, RFC 9420 § 12.3. */
class AppliedProposals {
  /** The leaves the Adds filled, in the order the Adds appear */
  readonly added: { leafIndex: number, keyPackage: KeyPackage }[] = [];
  readonly removed: number[] = [];
  readonly updated: number[] = [];
  /** In the order the proposals name them, which is the order § 8.4 chains them */
  readonly psks: PreSharedKeyID[] = [];
  /** The new `GroupContext.extensions`, replaced wholesale by a
   * GroupContextExtensions proposal, § 12.1.7 */
  extensions: Extension[];

  constructor(extensions: Extension[]) {
    this.extensions = extensions;
  }
}

/** A moment at which a leaf's own lifetime holds, i.e. the way to run the rest
 * of `KeyPackage.validate()` without its lifetime check. RFC 9420 § 7.3 only
 * *recommends* that check for a leaf we receive: a KeyPackage that expired
 * while the Commit carrying it was in flight is not a reason to reject the
 * Commit, and everybody who does reject it forks the group. What we put into
 * our own Commit is checked against the real clock. */
function ignoringLifetime(leaf: LeafNode): Date {
  return new Date(Number(leaf.lifetime?.notBefore ?? 0n) * 1000);
}

/** RFC 9420 § 12.1.6: the KEM output that an external Commit's init secret
 * comes from. */
function externalInitOf(committed: ProposalList): Uint8Array {
  return (committed.of(ExternalInitProposal)[0].proposal as ExternalInitProposal).kemOutput;
}

/** RFC 9420 § 12.1.8: the only proposals a party outside the group may send */
const kExternalProposalTypes: number[] = [
  ProposalType.Add, ProposalType.Remove, ProposalType.PreSharedKey, ProposalType.ReInit,
  ProposalType.GroupContextExtensions,
];
/** RFC 9420 § 15.3: how many epochs we keep the secret tree of, so that an
 * application message that a Commit overtook is not lost. */
const kMaxPastEpochs = 3;
/** How many epochs' resumption PSKs we keep, RFC 9420 § 8.6 */
const kMaxResumptionPSKs = 32;
const kNoBytes = new Uint8Array(0);
