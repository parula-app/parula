/** The Wire side of MLS: the delivery service, and nothing else.
 *
 * `MLSClient` and `MLSGroup` in `Chat/MLS/` are generic RFC 9420 and never
 * learn what a conversation is; `WireAPI` never learns what an epoch is. This
 * is the one class that knows both, so it is also the one place that can
 * enforce the rules of `Protocol/07-MLS-in-Wire.md`, Appendix B. Every one of
 * them fails *silently*: the group keeps working for weeks, and then cannot be
 * recovered.
 *
 * - A commit is merged only once the delivery service answered 201. Merging it
 *   before forks us out of the group for good whenever a concurrent commit won
 *   the race, and nothing tells us until we can no longer decrypt anything.
 * - Handshakes go out as `PublicMessage`. The backend files a `PrivateMessage`
 *   as the bundle's optional application message and then rejects the bundle
 *   for a missing commit.
 * - The backend's removal key is entry 0 of `external_senders`, or the server
 *   can never evict anybody and our member list drifts away from its.
 * - Every GroupInfo carries the `ratchet_tree` extension, or nobody can join by
 *   external commit — which is the only recovery there is.
 * - `mls_public_keys` is registered on our device before the first key package
 *   upload, which is why `setup()` does both, in that order.
 * - The credential identity is `<uuid-36>:<clientID-hex>@<domain>` to the byte;
 *   see `WireMLSIdentity`. */
import type { WireAPI } from "./WireAPI";
import type { WireSession } from "./WireSession";
import type { TWireConversation, TWireMLSMessageSendingStatus, TWirePrekey, TWireQualifiedID } from "./TWire";
import { MLSClient } from "../MLS/MLSClient";
import { MLSGroup, type ProcessResult } from "../MLS/MLSGroup";
import type { MLSStorage } from "../MLS/MLSStorage";
import { BasicCredential, CredentialType } from "../MLS/Messages/Credential";
import { Extension, ExtensionType, ExternalSender, RequiredCapabilities } from "../MLS/Messages/Extension";
import type { GroupInfo } from "../MLS/Messages/GroupInfo";
import { KeyPackage } from "../MLS/Messages/KeyPackage";
import { MLSMessage } from "../MLS/Messages/MLSMessage";
import { AddProposal, Proposal, RemoveProposal } from "../MLS/Messages/Proposal";
import { PrivateMessage, PublicMessage, WireFormat } from "../MLS/Messages/Framing";
import { RatchetTree } from "../MLS/Tree/RatchetTree";
import type { LeafNode } from "../MLS/Tree/LeafNode";
import { CipherSuite } from "../MLS/Crypto/CipherSuite";
import type { KeyPair } from "../MLS/Crypto/KEM";
import { MLSError } from "../MLS/util";
import { base64Decode, base64Encode, bytesEqual, concatBytes } from "../Signal/Crypto/primitives";
import { Debounce } from "../../util/flow/Debounce";
import { retryOnTransientError } from "../../util/netUtil";
import { assert } from "../../util/util";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

export class WireMLSService implements MLSStorage {
  readonly api: WireAPI;
  readonly session: WireSession;
  /** Our MLS identity and its groups. Null until `setup()` or `fromJSON()`. */
  client: MLSClient | null = null;
  /** The suite of every group we create, from the team's feature config */
  suite = CipherSuite.forID(kDefaultCipherSuite);
  /** `GET /mls/public-keys`: signature scheme → the backend's removal key,
   * base64. A 1:1 uses the key of the backend that owns it instead. */
  removalKeys: Record<string, string> = {};
  /** A Welcome can be the first we hear of a conversation, so the account has
   * to be able to make a room for one we do not know yet.
   * @param conversation the conversation, where we were handed it already. An
   *   MLS 1:1 has to be passed in: until its first commit it exists only in
   *   the `/one2one-conversations` answer, and `GET /conversations` 404s.
   * @param peerID the other person in a 1:1. That same unestablished 1:1 has
   *   nobody in its member list yet, so it does not say who it is with. */
  onRoomForConversation: ((conversationID: TWireQualifiedID,
    conversation?: TWireConversation, peerID?: TWireQualifiedID) => Promise<WireMLSRoom>) | null = null;
  /** Our signature key or our published key packages changed: persist
   * `toJSON()`. Their private keys are the only copy there is. */
  onClientChanged: (() => Promise<void>) | null = null;
  /** Base64 group ID → room, so that MLS state lands in the right conversation */
  protected readonly rooms = new Map<string, WireMLSRoom>();
  protected signatureKeyPair: KeyPair | null = null;
  protected readonly saveClientSoon = new Debounce(kSaveClientDelaySeconds);

  constructor(api: WireAPI, session: WireSession) {
    this.api = api;
    this.session = session;
  }

  /** At login. The order is the point: §4.1 rule 9 rejects every key package
   * whose signature key the backend has not seen on our device before, so the
   * device registration that carries `mls_public_keys` happens here and not
   * next to it.
   * @param prekeys Proteus prekeys, which the backend demands even of an
   *   MLS-only client, so whoever owns them passes them through */
  async setup(prekeys?: TWirePrekey[], lastPrekey?: TWirePrekey): Promise<void> {
    this.removalKeys = (await retryOnTransientError(() => this.api.getMLSPublicKeys())).removal;
    if (!this.client) {
      this.suite = await this.pickCipherSuite();
      this.signatureKeyPair = this.suite.generateSignatureKeyPair();
    }
    await this.session.ensureClient(this.mlsPublicKeys, prekeys, lastPrekey);
    this.client ??= this.createClient();
    // §2.6: a leaf that does not advertise its own credential type is rejected,
    // and with it every key package we would upload below
    assert(this.client.capabilities.credentials.includes(CredentialType.Basic),
      "Wire: Our MLS capabilities must list the basic credential type");
    await this.replenishKeyPackages();
  }

  /** §4.7: keep ~100 unclaimed key packages on the server and top them back up
   * once half of them are gone. Each is single use — a Welcome consumes exactly
   * one — and we must keep its private keys until it is used. */
  async replenishKeyPackages(): Promise<void> {
    assert(this.client, "Wire: Need our MLS identity first");
    let count = await retryOnTransientError(() =>
      this.api.countKeyPackages(this.session.clientID, this.suite.id));
    if (count > kKeyPackageMinimum) {
      return;
    }
    let fresh: string[] = [];
    for (let i = 0; i < kKeyPackageCount; i++) {
      fresh.push(base64Encode(this.client.createKeyPackage(kKeyPackageLifetimeDays).keyPackage.toBytes()));
    }
    await this.api.uploadKeyPackages(this.session.clientID, fresh);
    await this.onClientChanged?.();
  }

  /** §6.1 steps 4 to 7, for a conversation the backend just minted for us. The
   * group only exists once its first commit landed, so this creates it *and*
   * commits the members in — a group of one needs an empty commit to reach
   * epoch 1 just the same.
   * @param removalKeys of the backend that owns the conversation, which for a
   *   federated 1:1 is not ours (§11.1) */
  async createGroup(room: WireMLSRoom, invite: TWireQualifiedID[],
    removalKeys = this.removalKeys): Promise<void> {
    assert(this.client, "Wire: Need our MLS identity first");
    assert(room.groupID, "Wire: The backend did not give us a group ID");
    this.rooms.set(room.groupID, room);
    let group = MLSGroup.create(this.client, base64Decode(room.groupID), this.suite,
      this.groupExtensions(removalKeys));
    try {
      await this.commitWith(room, () => this.addProposals(room, invite));
    } catch (ex) {
      // §11.3: somebody else established the group first, so ours is worthless.
      // A recovery may already have replaced it with theirs; keep that one.
      if (this.groupFor(room) == group) {
        this.wipe(room);
      }
      throw ex;
    }
  }

  /** One commit with an Add per device of those users, §6.1 steps 5 and 6.
   * A user without key packages has no MLS device and is left out. */
  async addMembers(room: WireMLSRoom, users: TWireQualifiedID[]): Promise<void> {
    await this.commitWith(room, () => this.addProposals(room, users));
  }

  /** One commit with a Remove per device of those users. Not a way to leave
   * ourselves: §9.3 `mls-self-removal-not-allowed`. Leave through
   * `WireAPI.removeMember()` and let the backend evict our leaf. */
  async removeMembers(room: WireMLSRoom, users: TWireQualifiedID[]): Promise<void> {
    await this.commitWith(room, async () => this.removeProposals(room, users));
  }

  /** §14: an empty commit, whose UpdatePath re-keys our leaf and with it the
   * whole epoch. Due every 30 days, and after anything that may have exposed
   * our key material. */
  async rotateOurKey(room: WireMLSRoom): Promise<void> {
    await this.commitWith(room, async () => []);
  }

  /** §8. `plaintext` is an encoded `GenericMessage`, the same payload Proteus
   * carries, so that the message layer above is written once. */
  async sendMessage(room: WireMLSRoom, plaintext: Uint8Array): Promise<TWireMLSMessageSendingStatus> {
    // §6.2: application data is encrypted, unlike our handshakes
    let message = this.groupOf(room).encrypt(plaintext);
    return await this.api.sendMLSMessage(message.toBytes());
  }

  /** One `conversation.mls-message-add`: an application message, a proposal, or
   * somebody else's commit. We never receive our own. */
  async processMessage(room: WireMLSRoom, message: Uint8Array): Promise<ProcessResult> {
    let group = this.groupOf(room);
    let parsed = MLSMessage.fromBytes(message);
    try {
      return group.process(parsed);
    } catch (ex) {
      // §9.2: a message from an epoch we never reached means we missed a
      // commit, and no amount of retrying gets us there — only a fresh
      // GroupInfo does. This message stays lost either way.
      if (epochOf(parsed) > group.epoch) {
        await this.rejoin(room);
      }
      throw ex;
    }
  }

  /** One `conversation.mls-welcome`: somebody's commit added us to a group,
   * possibly of a conversation we have never seen.
   * @param message the raw `MLSMessage` of the event's `data` */
  async processWelcome(conversationID: TWireQualifiedID, message: Uint8Array): Promise<WireMLSRoom> {
    assert(this.client, "Wire: Need our MLS identity first");
    let welcome = MLSMessage.fromBytes(message).welcome;
    assert(welcome, "Wire: This is not an MLS Welcome");
    let room = await this.roomFor(conversationID);
    let group: MLSGroup;
    try {
      group = MLSGroup.fromWelcome(this.client, welcome);
    } catch (ex) {
      // The notification stream replays, and a Welcome whose key package we
      // already consumed is exactly what a replay looks like.
      if (this.groupFor(room)) {
        return room;
      }
      throw ex;
    }
    room.groupID = base64Encode(group.groupID);
    room.mlsGroupJSON = group.toJSON();
    this.rooms.set(room.groupID, room);
    await room.save();
    // §9.2 step 1: this Welcome consumed one of our key packages
    await this.replenishKeyPackages();
    return room;
  }

  /** §10: our epoch is lost. Throw the local group away and commit ourselves
   * back into the group from a fresh GroupInfo. Needs the `ratchet_tree`
   * extension that §6.2 puts into every GroupInfo we publish. */
  async rejoin(room: WireMLSRoom): Promise<void> {
    assert(this.client, "Wire: Need our MLS identity first");
    let groupInfo = MLSMessage.fromBytes(
      await retryOnTransientError(() => this.api.getGroupInfo(room.qualifiedID))).groupInfo;
    assert(groupInfo, "Wire: The backend did not answer with a GroupInfo");
    let tree = groupInfo.ratchetTree
      ? RatchetTree.fromBytes(groupInfo.suite, groupInfo.ratchetTree) : null;
    // §12.2: an external commit may remove one leaf and only our own, and it
    // *must* remove it when we are still in the tree. Our old leaf index means
    // nothing after a desync, so find the leaf by our signature key.
    let { group, commit } = MLSGroup.externalCommit(this.client, groupInfo, tree,
      tree ? this.ourLeafIn(tree) : null);
    room.groupID = base64Encode(group.groupID);
    room.mlsGroupJSON = group.toJSON();
    this.rooms.set(room.groupID, room);
    try {
      // No Welcome: an external commit adds nobody but us
      await this.api.sendCommitBundle(this.bundle(commit, group.groupInfo(), null));
    } catch (ex) {
      // Unlike an ordinary commit, an external one is applied the moment it is
      // built, so a rejection leaves us in a group nobody else is in.
      this.wipe(room);
      throw ex;
    }
    await room.save();
  }

  /** §11: the MLS 1:1 with one person. Both sides derive the same conversation
   * and group ID, so both may try to create it; the first commit wins, and the
   * loser joins the winner's group instead of its own. */
  async oneToOneGroup(user: TWireQualifiedID): Promise<WireMLSRoom> {
    let answer = await retryOnTransientError(() => this.api.getMLSOneToOne(user));
    let room = await this.roomFor(answer.conversation.qualified_id, answer.conversation, user);
    room.groupID = answer.conversation.group_id;
    if (this.groupFor(room)) {
      return room;
    }
    if ((answer.conversation.epoch ?? 0) > 0) {
      await this.rejoin(room); // Established while we were away
      return room;
    }
    try {
      // §11.3: the other user's devices and our own others, in one commit. The
      // backend leaves this device out of the key packages it hands us.
      await this.createGroup(room, [user, this.identity.qualifiedID],
        answer.public_keys?.removal ?? this.removalKeys);
    } catch (ex) {
      // The other side won the race and its Welcome is already on its way.
      console.error(ex);
    }
    return room;
  }

  /** Who we are in MLS: §2.2's identity, to the byte */
  get identity(): WireMLSIdentity {
    assert(this.session.userID && this.session.clientID, "Wire: Need our user and device ID");
    return new WireMLSIdentity(this.session.userID, this.session.clientID, this.session.domain);
  }

  /** `{ "<signature scheme>": "<base64 public key>" }` for `POST /clients`.
   * §4.1 rule 9: the backend rejects every key package whose signature key it
   * has not seen here first. */
  get mlsPublicKeys(): Record<string, string> {
    assert(this.signatureKeyPair, "Wire: Need our MLS signature key first");
    return { [signatureSchemeName(this.suite)]: base64Encode(this.signatureKeyPair.publicKey) };
  }

  /** Our group state for a conversation, or null while we are not in it.
   * `MLSClient.groups` is the one registry; the room only holds its JSON. */
  groupFor(room: WireMLSRoom): MLSGroup | null {
    return room.groupID ? this.client?.group(base64Decode(room.groupID)) ?? null : null;
  }

  /** The account tells us about a room at startup. `MLSClient.fromJSON()`
   * deliberately leaves the groups out, so each room brings its own back. */
  addRoom(room: WireMLSRoom): void {
    if (!room.groupID) {
      return;
    }
    this.rooms.set(room.groupID, room);
    if (room.mlsGroupJSON) {
      assert(this.client, "Wire: Need our MLS identity first");
      MLSGroup.fromJSON(this.client, room.mlsGroupJSON); // registers itself
    }
  }

  /** Throw our local group away. Everything it could decrypt is lost with it,
   * so only for a group that is already worthless: one we lost a race for, or
   * one the backend refused our external commit into. */
  wipe(room: WireMLSRoom): void {
    let group = this.groupFor(room);
    if (group) {
      this.client.removeGroup(group);
    }
  }

  /** `MLSStorage`: our key packages or our signature key changed. Debounced,
   * because generating a batch of 100 key packages changes it 100 times. */
  saveClient(_client: MLSClient): void {
    this.saveClientSoon.debounce(() => this.onClientChanged?.())
      .catch(ex => console.error(ex));
  }

  /** `MLSStorage`: a new epoch, or a proposal we still have to commit. The
   * background path; the places that must not lose the write await
   * `room.save()` themselves. */
  saveGroup(group: MLSGroup): void {
    let room = this.roomOf(group);
    if (!room) {
      return;
    }
    room.mlsGroupJSON = group.toJSON();
    room.save().catch(ex => console.error(ex));
  }

  deleteGroup(group: MLSGroup): void {
    let room = this.roomOf(group);
    if (!room) {
      return;
    }
    room.mlsGroupJSON = null;
    room.save().catch(ex => console.error(ex));
  }

  toJSON(): any {
    return {
      cipherSuite: this.suite.id,
      client: this.client?.toJSON() ?? null,
    };
  }

  /** The groups are not in here: every room restores its own with `addRoom()`,
   * out of its own `json` column. */
  fromJSON(json: any): void {
    if (!json?.client) {
      return;
    }
    this.client = MLSClient.fromJSON(json.client);
    this.client.storage = this;
    this.suite = this.client.suite;
    this.signatureKeyPair = this.client.signatureKeyPair;
  }

  /** §7 and Appendix B rule 10: build the commit, send the bundle, and only
   * then move into the new epoch. A commit merged before the 201 forks us out
   * of the group beyond repair whenever somebody else's commit won the race.
   *
   * @param proposals rebuilt for every attempt, because a recovery moves the
   *   group and with it every leaf index and every membership decision
   * @returns null when the recovery made the commit unnecessary, i.e. somebody
   *   else already did what we wanted */
  protected async commitWith(room: WireMLSRoom, proposals: () => Promise<Proposal[]>,
    isRetry = false): Promise<TWireMLSMessageSendingStatus | null> {
    let group = this.groupOf(room);
    let list = await proposals();
    if (isRetry && !list.length) {
      return null;
    }
    let result = group.commit(list);
    let status: TWireMLSMessageSendingStatus;
    try {
      status = await this.api.sendCommitBundle(this.bundle(result.commit, result.groupInfo, result.welcome));
    } catch (ex) {
      let extra = isRetry ? null : await this.repair(room, ex);
      if (!extra) {
        throw ex;
      }
      return await this.commitWith(room,
        async () => withoutDuplicateAdds([...await proposals(), ...extra]), true);
    }
    group.applyOwnCommit(result);
    room.mlsGroupJSON = group.toJSON();
    await room.save();
    // `failed_to_send` means one federated backend was unreachable. The commit
    // itself was accepted, so we keep the epoch and re-add those users later.
    return status;
  }

  /** §9.3: what an error from the delivery service means for our state.
   * @returns the proposals to add to the second attempt, or null when trying
   *   again cannot help */
  protected async repair(room: WireMLSRoom, ex: any): Promise<Proposal[] | null> {
    switch (wireMLSRecovery(typeof (ex?.label) == "string" ? ex.label : "")) {
      case "rejoin":
        await this.rejoin(room);
        return [];
      case "rebuild":
        // `mls-group-out-of-sync` names the users our tree is missing
        return await this.addProposals(room, missingUsers(ex));
      default:
        return null;
    }
  }

  /** §4.4: one key package per device of each user, minus the devices that are
   * in the group already — one duplicate Add invalidates the whole commit. */
  protected async addProposals(room: WireMLSRoom, users: TWireQualifiedID[]): Promise<Proposal[]> {
    let known = new Set(this.groupOf(room).members.map(leaf => base64Encode(leaf.signatureKey)));
    let proposals: Proposal[] = [];
    for (let user of users) {
      // An empty list means that user has no MLS device at all
      let claimed = await retryOnTransientError(() => this.api.claimKeyPackages(user, this.suite.id));
      for (let each of claimed) {
        let keyPackage = KeyPackage.fromBytes(base64Decode(each.key_package));
        if (known.add(base64Encode(keyPackage.leafNode.signatureKey))) {
          proposals.push(new AddProposal(keyPackage));
        }
      }
    }
    return proposals;
  }

  /** Every leaf of those users, found by the identity in its credential. Ours
   * is never among them, and neither is anything that is not a Wire client. */
  protected removeProposals(room: WireMLSRoom, users: TWireQualifiedID[]): Proposal[] {
    let group = this.groupOf(room);
    let wanted = users.map(user => `${user.id}@${user.domain}`);
    let proposals: Proposal[] = [];
    for (let leafIndex of group.tree.memberLeafIndices()) {
      let identity = WireMLSIdentity.of(group.tree.leaf(leafIndex));
      if (identity && leafIndex != group.ourLeafIndex &&
        wanted.includes(`${identity.userID}@${identity.domain}`)) {
        proposals.push(new RemoveProposal(leafIndex));
      }
    }
    return proposals;
  }

  /** §7.2: what `POST /mls/commit-bundles` parses — whole `MLSMessage`s, one
   * after the other, with nothing between them and no length prefixes. The
   * backend sorts them by their wire format, so this is the order the official
   * client sends and not a requirement. */
  protected bundle(commit: MLSMessage, groupInfo: GroupInfo, welcome: MLSMessage | null): Uint8Array {
    // Appendix B rule 2: a PrivateMessage here is filed as the bundle's
    // application message, and the bundle is then rejected for a missing commit
    assert(commit.wireFormat == WireFormat.PublicMessage, "Wire: An MLS commit must be a PublicMessage");
    // Appendix B rule 4: without it nobody can ever join by external commit,
    // and external commits are all the recovery there is
    assert(Extension.find(groupInfo.extensions, ExtensionType.RatchetTree),
      "Wire: The GroupInfo needs the ratchet_tree extension");
    return concatBytes(commit.toBytes(), new MLSMessage(groupInfo).toBytes(),
      welcome?.toBytes() ?? kNoBytes);
  }

  /** §6.2: what every Wire group carries in its GroupContext. */
  protected groupExtensions(removalKeys: Record<string, string>): Extension[] {
    let scheme = signatureSchemeName(this.suite);
    let removalKey = removalKeys[scheme];
    assert(removalKey, `Wire: The backend published no MLS removal key for ${scheme}`);
    return [
      /* §5.2: the backend signs its Remove proposals as `external(0)`, i.e. as
       * the first entry of this list. Put anything else first, or leave the
       * extension out, and every server-side removal silently does nothing. */
      ExternalSender.listToExtension([new ExternalSender(base64Decode(removalKey),
        BasicCredential.fromString(kBackendIdentity))]),
      new RequiredCapabilities([], [], [CredentialType.Basic, CredentialType.X509]).toExtension(),
    ];
  }

  /** §1.3: the team's feature config decides, but only among the suites we
   * implement and for which the backend published a removal key. */
  protected async pickCipherSuite(): Promise<CipherSuite> {
    let config = (await retryOnTransientError(() => this.api.getFeatureConfigs())).mls?.config;
    let allowed = Array.isArray(config?.allowedCipherSuites) ? config.allowedCipherSuites : [];
    let wanted = [config?.defaultCipherSuite, ...allowed, kDefaultCipherSuite]
      .map(id => sanitize.integer(id, 0));
    for (let id of wanted) {
      let suite = CipherSuite.all.find(suite => suite.id == id);
      if (suite && this.removalKeys[signatureSchemeName(suite)]) {
        return suite;
      }
    }
    throw new MLSError("This backend offers no MLS cipher suite that we implement");
  }

  protected createClient(): MLSClient {
    // §2.2: the identity names our device, which the backend only assigned in
    // `ensureClient()` above, so the credential cannot be built any earlier
    let client = new MLSClient(this.suite, BasicCredential.fromString(this.identity.toString()),
      this.signatureKeyPair);
    client.keyPackageLifetimeDays = kKeyPackageLifetimeDays;
    client.paddingBlockSize = kPaddingBlockSize;
    client.storage = this;
    return client;
  }

  /** Our own leaf in a tree the backend sent us. By signature key, because
   * after a desync our old leaf index means nothing. */
  protected ourLeafIn(tree: RatchetTree): number | null {
    let ours = this.client.signatureKeyPair.publicKey;
    return tree.memberLeafIndices()
      .find(leafIndex => bytesEqual(tree.leaf(leafIndex).signatureKey, ours)) ?? null;
  }

  protected groupOf(room: WireMLSRoom): MLSGroup {
    let group = this.groupFor(room);
    assert(group, "Wire: We are not in the MLS group of this conversation");
    return group;
  }

  protected roomOf(group: MLSGroup): WireMLSRoom | null {
    return this.rooms.get(base64Encode(group.groupID)) ?? null;
  }

  protected async roomFor(conversationID: TWireQualifiedID,
    conversation?: TWireConversation, peerID?: TWireQualifiedID): Promise<WireMLSRoom> {
    assert(this.onRoomForConversation, "Wire: Need a way to find the room of a conversation");
    return await this.onRoomForConversation(conversationID, conversation, peerID);
  }
}

/**
 * Who a leaf node belongs to: §2.2's `<user-uuid>:<client-id>@<domain>`, as
 * ASCII and nothing else — no length prefix, no trailing NUL, and the
 * separators in that order.
 *
 * The user ID is the lower-case hyphenated 36-character UUID and the client ID
 * is lower-case hex without a `0x` prefix and without leading zeros. The x509
 * credentials of §2.5 encode the very same two IDs differently, on purpose;
 * mixing the encodings up is what `mls-identity-mismatch` means.
 */
export class WireMLSIdentity {
  readonly userID: string;
  readonly clientID: string;
  readonly domain: string;

  constructor(userID: string, clientID: string, domain: string) {
    this.userID = userID.toLowerCase();
    this.clientID = clientID.toLowerCase().replace(/^0+(?=.)/, "");
    this.domain = domain.toLowerCase();
  }

  /** null for a leaf that is not a Wire client: the backend's own
   * `wire-server` external sender (§2.3), a history-sharing client (§2.4), or
   * an x509 credential (§2.5). */
  static of(leaf: LeafNode): WireMLSIdentity | null {
    if (!(leaf.credential instanceof BasicCredential)) {
      return null;
    }
    let parts = kIdentity.exec(leaf.credential.identityString);
    return parts ? new WireMLSIdentity(parts[1], parts[2], parts[3]) : null;
  }

  get qualifiedID(): TWireQualifiedID {
    return { id: this.userID, domain: this.domain };
  }

  toString(): string {
    return `${this.userID}:${this.clientID}@${this.domain}`;
  }
}

/** What `WireMLSService` needs of a conversation, which `WireChatRoom`
 * implements. Nothing here is MLS: the live group lives in `MLSClient.groups`,
 * and the room only carries the state that a restart would lose. */
export interface WireMLSRoom {
  /** The conversation's `qualified_id` */
  readonly qualifiedID: TWireQualifiedID;
  /** The backend's `group_id`, base64 as it sends it. Arbitrary bytes, never
   * text, and a conversation reset replaces it. */
  groupID: string | null;
  /** `MLSGroup.toJSON()`, which `toExtraJSON()` persists and `addRoom()` reads
   * back. Null while we are not in the group. */
  mlsGroupJSON: any;
  save(): Promise<void>;
}

/** §9.3: what an MLS error from the delivery service means for our state.
 * `rejoin` = our view of the group is behind or wrong and only a fresh
 * GroupInfo fixes it; `rebuild` = build the commit again from the state we have
 * now; `reset` = the conversation is broken for everybody in it; `fatal` =
 * trying again cannot help. */
export type WireMLSRecovery = "rejoin" | "rebuild" | "reset" | "fatal";

export function wireMLSRecovery(label: string): WireMLSRecovery {
  return kRecovery[label] ?? "fatal";
}

/** §9.3, the whole table. Anything not listed is `fatal`. */
const kRecovery: Record<string, WireMLSRecovery> = {
  // Somebody's commit landed before ours: our epoch is behind
  "mls-stale-message": "rejoin",
  // A proposal points at a leaf that is not there: our tree is desynchronised
  "mls-invalid-leaf-node-index": "rejoin",
  // Proposals we never saw, or that the backend never saw: rebuild the commit
  "mls-commit-missing-references": "rebuild",
  "mls-proposal-not-found": "rebuild",
  // An Add or Remove must cover every device of a user: re-claim and redo
  "mls-client-mismatch": "rebuild",
  // Our leaves do not match the backend's member list; `missing_users` says who
  "mls-group-out-of-sync": "rebuild",
  // The Welcome did not address exactly the clients the commit added
  "mls-welcome-mismatch": "rebuild",
  // The group's own leaves no longer verify: nothing short of a reset helps
  "mls-invalid-leaf-node-signature": "reset",
  // Our own doing, and repeating it changes nothing
  "mls-protocol-error": "fatal",
  "mls-self-removal-not-allowed": "fatal",
  "mls-group-conversation-mismatch": "fatal",
  "mls-client-sender-user-mismatch": "fatal",
  "mls-identity-mismatch": "fatal",
  "mls-unsupported-message": "fatal",
  "mls-unsupported-proposal": "fatal",
  "non-empty-member-list": "fatal",
  "mls-missing-group-info": "fatal",
  "mls-legal-hold-not-allowed": "fatal",
  "mls-not-enabled": "fatal",
  "mls-duplicate-public-key": "fatal",
  "mls-migration-criteria-not-satisfied": "fatal",
  "mls-federated-one2one-not-supported": "fatal",
  "mls-federated-reset-not-supported": "fatal",
  "mls-subconv-unsupported-convtype": "fatal",
  "mls-subconv-join-parent-missing": "fatal",
  "mls-receipts-not-allowed": "fatal",
  "mls-history-client-conflict": "fatal",
  "mls-history-client-duplication": "fatal",
};

/** §9.3: the only Wire error with a structured body. Straight off the network,
 * so unlike the rest of `TWire*` it still has to be sanitized. */
function missingUsers(ex: any): TWireQualifiedID[] {
  let users = ex?.data?.missing_users;
  if (!Array.isArray(users)) {
    return [];
  }
  return users.map(user => ({
    id: sanitize.alphanumdash(user?.id),
    domain: sanitize.hostname(user?.domain),
  }));
}

/** The recovery and the original intent can name the same device, and one
 * duplicate Add makes the whole commit invalid. */
function withoutDuplicateAdds(proposals: Proposal[]): Proposal[] {
  let seen = new Set<string>();
  return proposals.filter(proposal => !(proposal instanceof AddProposal) ||
    seen.add(base64Encode(proposal.keyPackage.leafNode.signatureKey)));
}

/** The epoch a message claims, before we have decrypted anything of it. */
function epochOf(message: MLSMessage): bigint | null {
  if (message.body instanceof PublicMessage) {
    return message.body.content.epoch;
  }
  if (message.body instanceof PrivateMessage) {
    return message.body.epoch;
  }
  return null;
}

/** §1.1: the JSON key the backend uses for a signature scheme, both in
 * `mls_public_keys` and in `GET /mls/public-keys`. */
function signatureSchemeName(suite: CipherSuite): string {
  let name = kSignatureSchemeNames[suite.signatureScheme.id];
  assert(name, `Wire: No Wire name for signature scheme ${suite.signatureScheme.id}`);
  return name;
}

/** TLS `SignatureScheme` code point → Wire's name for it */
const kSignatureSchemeNames: Record<number, string> = {
  0x0807: "ed25519",
  0x0403: "ecdsa_secp256r1_sha256",
  0x0503: "ecdsa_secp384r1_sha384",
  0x0603: "ecdsa_secp521r1_sha512",
};

/** §2.2 */
const kIdentity = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9a-f]{1,16})@(.+)$/i;
/** §2.3: the identity of the backend's external-sender credential */
const kBackendIdentity = "wire-server";
/** §1.3: what `core-crypto` defaults to, and our fallback when the team's
 * feature config does not say. */
const kDefaultCipherSuite = 0x0001;
/** §4.7: the official clients' key package policy */
const kKeyPackageCount = 100;
const kKeyPackageMinimum = 50;
const kKeyPackageLifetimeDays = 84;
/** §6.2: `padding_size` of every official client */
const kPaddingBlockSize = 128;
const kSaveClientDelaySeconds = 1;
const kNoBytes = new Uint8Array(0);
