import type { WireTransport } from "./WireTransport";
import type { TWireAsset, TWireAssetUploadOptions, TWireClaimedKeyPackage, TWireClient, TWireContact, TWireConnection, TWireConnectionStatus, TWireConversation, TWireConversationCode, TWireConversationPreview, TWireConversationRole, TWireCreatedConversation, TWireEvent, TWireFeature, TWireFeatureConfigs, TWireFound, TWireMLSMessageSendingStatus, TWireMLSOneToOne, TWireMLSPublicKeys, TWireNewConversation, TWireNotification, TWireNotifications, TWireOtherMember, TWirePrekey, TWirePrekeyBundle, TWireProtocol, TWireQualifiedUserClients, TWireClaimedPrekeys, TWireClientPrekey, TWireClientPrekeyMap, TWireMessageSendingStatus, TWireQualifiedHandle, TWireQualifiedID, TWireSearchResult, TWireSelf, TWireSelfMember, TWireSelfMemberUpdate, TWireSelfUpdate, TWireServiceRef, TWireSubconversation, TWireSubconversationMember, TWireTeam, TWireTeamMember, TWireUser, TWireUserAsset, TWireUserClients } from "./TWire";
import { base64Encode, concatBytes, md5, randomBytes } from "../Signal/Crypto/primitives";
import { assert } from "../../util/util";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

/** Every REST call the Wire backend offers us, typed and sanitized.
 *
 * Holds no state apart from the transport. The paths here have no `/vN`
 * prefix - `WireTransport` adds it.
 *
 * 2 things happen here and nowhere else:
 * - **Sanitizing.** Everything the server sends passes `sanitize.*` once, here.
 *   The rest of the app trusts `TWire*` values. Base64 payloads are validated
 *   but never rewritten, so they stay byte-exact.
 * - **Paging and chunking.** Callers pass any number of IDs and get the whole
 *   list back; they never loop.
 *
 * Federated calls answer with 3 buckets: `found`, `notFound` (gone) and
 * `failed` (that backend was unreachable). All 3 are returned. An unreachable
 * remote backend is normal and never throws. */
export class WireAPI {
  readonly transport: WireTransport;

  constructor(transport: WireTransport) {
    this.transport = transport;
  }

  ///////////////////////////////////////////////////////////
  // Self and users

  async getSelf(): Promise<TWireSelf> {
    return sanitizeSelf(await this.transport.get("/self"));
  }

  /** Fields left out stay as they are. Handle, locale, email and password each
   * have their own sub-resource and cannot be set here. */
  async updateSelf(update: TWireSelfUpdate): Promise<void> {
    await this.transport.put("/self", update);
  }

  async getUser(userID: TWireQualifiedID): Promise<TWireUser> {
    return sanitizeUser(await this.transport.get(`/users/${segment(userID.domain)}/${segment(userID.id)}`));
  }

  /** Any number of users, in chunks the server accepts. */
  async listUsers(userIDs: TWireQualifiedID[]): Promise<TWireFound<TWireUser>> {
    let result: TWireFound<TWireUser> = { found: [], notFound: [], failed: [] };
    for (let chunk of chunks(userIDs, kListUsersChunkSize)) {
      let json = await this.transport.post("/list-users", { qualified_ids: chunk });
      addFound(result, json, sanitizeUser);
    }
    return result;
  }

  /** Exact lookup by handle. The server allows only 4 handles per call. */
  async listUsersByHandle(handles: TWireQualifiedHandle[]): Promise<TWireFound<TWireUser>> {
    let result: TWireFound<TWireUser> = { found: [], notFound: [], failed: [] };
    for (let chunk of chunks(handles, kListHandlesChunkSize)) {
      let json = await this.transport.post("/list-users", { qualified_handles: chunk });
      addFound(result, json, sanitizeUser);
    }
    return result;
  }

  async getUserClients(userID: TWireQualifiedID): Promise<TWireClient[]> {
    let json = await this.transport.get(`/users/${segment(userID.domain)}/${segment(userID.id)}/clients`);
    return sanitizeArray(json, sanitizeClient);
  }

  /** domain -> user ID -> devices. A user whose backend was unreachable is
   * simply missing from the result - there is no `failed` bucket here. */
  async listUserClients(userIDs: TWireQualifiedID[]): Promise<TWireUserClients> {
    let result: TWireUserClients = {};
    for (let chunk of chunks(userIDs, kListClientsChunkSize)) {
      let json = await this.transport.post("/users/list-clients", { qualified_users: chunk });
      let map = sanitizeUserMap(json?.qualified_user_map,
        (clients: any) => sanitizeArray(clients, sanitizeClient));
      for (let domain of Object.keys(map)) {
        result[domain] = { ...result[domain], ...map[domain] };
      }
    }
    return result;
  }

  /** The cheap way to re-check one peer, instead of refetching the profile */
  async getSupportedProtocols(userID: TWireQualifiedID): Promise<TWireProtocol[]> {
    let json = await this.transport.get(`/users/${segment(userID.domain)}/${segment(userID.id)}/supported-protocols`);
    return sanitizeProtocols(json);
  }

  /** We may add `mls`, but never take it away again. */
  async setSupportedProtocols(protocols: TWireProtocol[]): Promise<void> {
    await this.transport.put("/self/supported-protocols", { supported_protocols: protocols });
  }

  /** Fuzzy search by handle and display name. Pass `domain` to search another
   * backend; how much it answers depends on `search_policy`. */
  async searchContacts(query: string, domain: string | null = null, size: number = kSearchSize): Promise<TWireSearchResult> {
    let params: Record<string, string | number> = { q: query, size: size };
    if (domain) {
      params.domain = domain;
    }
    let json = await this.transport.get("/search/contacts", { query: params });
    return {
      found: sanitize.integer(json?.found, 0),
      returned: sanitize.integer(json?.returned, 0),
      took: sanitize.integer(json?.took, 0),
      search_policy: sanitize.enum(json?.search_policy, ["no_search", "exact_handle_search", "full_search"], null),
      documents: sanitizeArray(json?.documents, sanitizeContact),
    };
  }

  ///////////////////////////////////////////////////////////
  // Connections

  /** Our contacts, minus the team members. Pages through the whole list. */
  async listConnections(): Promise<TWireConnection[]> {
    let connections: TWireConnection[] = [];
    let pagingState: string | null = null;
    let hasMore = true;
    while (hasMore) {
      let request: any = { size: kConnectionsPageSize };
      if (pagingState) {
        request.paging_state = pagingState;
      }
      let json = await this.transport.post("/list-connections", request);
      connections.push(...sanitizeArray(json?.connections, sanitizeConnection));
      pagingState = base64OrNull(json?.paging_state);
      hasMore = sanitize.boolean(json?.has_more, false) && !!pagingState;
    }
    return connections;
  }

  /** `null` when there is no connection with that user */
  async getConnection(userID: TWireQualifiedID): Promise<TWireConnection | null> {
    let json = await this.notFoundAsNull(
      this.transport.get(`/connections/${segment(userID.domain)}/${segment(userID.id)}`));
    return json ? sanitizeConnection(json) : null;
  }

  /** Sends the contact request. Also creates the Proteus 1:1 conversation. */
  async createConnection(userID: TWireQualifiedID): Promise<TWireConnection> {
    return sanitizeConnection(
      await this.transport.post(`/connections/${segment(userID.domain)}/${segment(userID.id)}`, null));
  }

  /** Accept, ignore, cancel, block or unblock. `null` when nothing changed. */
  async updateConnection(userID: TWireQualifiedID, status: TWireConnectionStatus): Promise<TWireConnection | null> {
    let json = await this.transport.put(
      `/connections/${segment(userID.domain)}/${segment(userID.id)}`, { status: status });
    return json ? sanitizeConnection(json) : null;
  }

  ///////////////////////////////////////////////////////////
  // Teams

  async getTeam(teamID: string): Promise<TWireTeam> {
    let json = await this.transport.get(`/teams/${segment(teamID)}`);
    return {
      id: sanitize.alphanumdash(json?.id),
      creator: sanitize.alphanumdash(json?.creator, null),
      name: sanitize.label(json?.name, null),
      icon: sanitize.alphanumdash(json?.icon, null),
      icon_key: sanitize.label(json?.icon_key, null),
      splash_screen: sanitize.alphanumdash(json?.splash_screen, null),
    };
  }

  /** Team members are contacts too, without any connection row.
   * Note this endpoint pages in camelCase, unlike `/list-connections`. */
  async listTeamMembers(teamID: string): Promise<TWireTeamMember[]> {
    let members: TWireTeamMember[] = [];
    let pagingState: string | null = null;
    let hasMore = true;
    while (hasMore) {
      let params: Record<string, string | number> = { maxResults: kTeamMembersPageSize };
      if (pagingState) {
        params.pagingState = pagingState;
      }
      let json = await this.transport.get(`/teams/${segment(teamID)}/members`, { query: params });
      members.push(...sanitizeArray(json?.members, sanitizeTeamMember));
      pagingState = base64OrNull(json?.pagingState);
      hasMore = sanitize.boolean(json?.hasMore, false) && !!pagingState;
    }
    return members;
  }

  /** Which features this account may use, e.g. whether MLS is on and which
   * protocol new conversations default to. Works for personal accounts, too. */
  async getFeatureConfigs(): Promise<TWireFeatureConfigs> {
    let json = sanitize.object(await this.transport.get("/feature-configs"), {}) as Record<string, any>;
    let features: TWireFeatureConfigs = {};
    for (let name of Object.keys(json)) {
      features[sanitize.alphanumdash(name)] = sanitizeFeature(json[name]);
    }
    return features;
  }

  ///////////////////////////////////////////////////////////
  // Conversations

  /** Every conversation we are in, local and remote. Pages internally. */
  async listConversationIDs(): Promise<TWireQualifiedID[]> {
    let conversationIDs: TWireQualifiedID[] = [];
    let pagingState: string | null = null;
    let hasMore = true;
    while (hasMore) {
      let request: any = { size: kConversationIDsPageSize };
      if (pagingState) {
        request.paging_state = pagingState;
      }
      let json = await this.transport.post("/conversations/list-ids", request);
      conversationIDs.push(...sanitizeArray(json?.qualified_conversations, sanitizeQualifiedID));
      pagingState = base64OrNull(json?.paging_state);
      hasMore = sanitize.boolean(json?.has_more, false) && !!pagingState;
    }
    return conversationIDs;
  }

  /** Any number of conversations, in chunks the server accepts. */
  async listConversations(conversationIDs: TWireQualifiedID[]): Promise<TWireFound<TWireConversation>> {
    let result: TWireFound<TWireConversation> = { found: [], notFound: [], failed: [] };
    for (let chunk of chunks(conversationIDs, kListConversationsChunkSize)) {
      let json = await this.transport.post("/conversations/list", { qualified_ids: chunk });
      addFound(result, json, sanitizeConversation);
    }
    return result;
  }

  /** List the IDs, then fetch them all. What a client does after login. */
  async listAllConversations(): Promise<TWireFound<TWireConversation>> {
    return await this.listConversations(await this.listConversationIDs());
  }

  async getConversation(conversationID: TWireQualifiedID): Promise<TWireConversation> {
    return sanitizeConversation(await this.transport.get(
      `/conversations/${segment(conversationID.domain)}/${segment(conversationID.id)}`));
  }

  /** `failed_to_add` lists the members whose backend was unreachable; the
   * conversation was created without them. */
  async createConversation(conversation: TWireNewConversation): Promise<TWireCreatedConversation> {
    let json = await this.transport.post("/conversations", conversation);
    return {
      ...sanitizeConversation(json),
      failed_to_add: sanitizeArray(json?.failed_to_add, sanitizeQualifiedID),
    };
  }

  /** The members are added afterwards, by an Add commit: the backend rejects a
   * non-empty member list here. The answer carries the `group_id` to build the
   * group with. */
  async createMLSConversation(conversation: TWireNewConversation): Promise<TWireCreatedConversation> {
    return await this.createConversation({ ...conversation, protocol: "mls", qualified_users: [] });
  }

  /** Conjured on demand, with a conversation ID both backends derive from the
   * 2 user IDs. `public_keys` belongs to the backend owning it, which need not
   * be ours - prefer it over `getMLSPublicKeys()`. */
  async getMLSOneToOne(userID: TWireQualifiedID): Promise<TWireMLSOneToOne> {
    let json = await this.transport.get(
      `/one2one-conversations/${segment(userID.domain)}/${segment(userID.id)}`);
    return {
      conversation: sanitizeConversation(json?.conversation),
      public_keys: json?.public_keys ? sanitizeMLSPublicKeys(json.public_keys) : null,
    };
  }

  /** Our own single-member MLS group, for talking to our other devices */
  async getMLSSelfConversation(): Promise<TWireConversation> {
    return sanitizeConversation(await this.transport.get("/conversations/mls-self"));
  }

  /** Proteus only. MLS membership follows from the group, so use an Add commit. */
  async addMembers(conversationID: TWireQualifiedID, userIDs: TWireQualifiedID[],
    role: string = "wire_member"): Promise<TWireEvent | null> {
    let json = await this.transport.post(
      `/conversations/${segment(conversationID.domain)}/${segment(conversationID.id)}/members`,
      { qualified_users: userIDs, conversation_role: role });
    return sanitizeEvent(json);
  }

  /** Also how we leave: remove ourselves. There is no `leave` endpoint. */
  async removeMember(conversationID: TWireQualifiedID, userID: TWireQualifiedID): Promise<TWireEvent | null> {
    let json = await this.transport.delete(
      `/conversations/${segment(conversationID.domain)}/${segment(conversationID.id)}` +
      `/members/${segment(userID.domain)}/${segment(userID.id)}`);
    return sanitizeEvent(json);
  }

  async updateMemberRole(conversationID: TWireQualifiedID, userID: TWireQualifiedID, role: string): Promise<void> {
    await this.transport.put(
      `/conversations/${segment(conversationID.domain)}/${segment(conversationID.id)}` +
      `/members/${segment(userID.domain)}/${segment(userID.id)}`,
      { conversation_role: role });
  }

  /** Mute and archive. Our other devices hear about it as a member-update event.
   * The `_ref` timestamps decide which device's setting is the newest. */
  async updateSelfMember(conversationID: TWireQualifiedID, update: TWireSelfMemberUpdate): Promise<void> {
    assert(Object.keys(update).length > 0, "Wire: Need at least one field to update");
    await this.transport.put(
      `/conversations/${segment(conversationID.domain)}/${segment(conversationID.id)}/self`, update);
  }

  async renameConversation(conversationID: TWireQualifiedID, name: string): Promise<TWireEvent | null> {
    let json = await this.transport.put(
      `/conversations/${segment(conversationID.domain)}/${segment(conversationID.id)}/name`, { name: name });
    return sanitizeEvent(json);
  }

  /** Self-deleting messages. In milliseconds, `null` switches it off. */
  async setMessageTimer(conversationID: TWireQualifiedID, milliseconds: number | null): Promise<TWireEvent | null> {
    let json = await this.transport.put(
      `/conversations/${segment(conversationID.domain)}/${segment(conversationID.id)}/message-timer`,
      { message_timer: milliseconds });
    return sanitizeEvent(json);
  }

  /** Read receipts: 0 = off, 1 = on */
  async setReceiptMode(conversationID: TWireQualifiedID, receiptMode: number): Promise<TWireEvent | null> {
    let json = await this.transport.put(
      `/conversations/${segment(conversationID.domain)}/${segment(conversationID.id)}/receipt-mode`,
      { receipt_mode: receiptMode });
    return sanitizeEvent(json);
  }

  /** Creates the guest link, or returns the existing one. The 201 wraps it in
   * a `conversation.code-update` event, the 200 does not. */
  async createGuestLink(conversationID: TWireQualifiedID, password: string | null = null): Promise<TWireConversationCode> {
    let request: any = {};
    if (password) {
      request.password = password;
    }
    let json = await this.transport.post(`/conversations/${segment(conversationID.id)}/code`, request);
    return sanitizeConversationCode(json?.data ?? json);
  }

  /** `null` when this conversation has no guest link */
  async getGuestLink(conversationID: TWireQualifiedID): Promise<TWireConversationCode | null> {
    let json = await this.notFoundAsNull(
      this.transport.get(`/conversations/${segment(conversationID.id)}/code`));
    return json ? sanitizeConversationCode(json) : null;
  }

  async revokeGuestLink(conversationID: TWireQualifiedID): Promise<void> {
    await this.transport.delete(`/conversations/${segment(conversationID.id)}/code`);
  }

  /** What the joiner sees before joining, without being a member yet */
  async getGuestLinkPreview(key: string, code: string): Promise<TWireConversationPreview> {
    let json = await this.transport.get("/conversations/join", { query: { key: key, code: code } });
    return {
      id: sanitize.alphanumdash(json?.id),
      name: sanitize.label(json?.name, null),
      has_password: sanitize.boolean(json?.has_password, false),
    };
  }

  async joinByGuestLink(key: string, code: string, password: string | null = null): Promise<TWireEvent | null> {
    let request: any = { key: key, code: code };
    if (password) {
      request.password = password;
    }
    return sanitizeEvent(await this.transport.post("/conversations/join", request));
  }

  /** Which actions each role may take. This path has no domain segment. */
  async getConversationRoles(conversationID: TWireQualifiedID): Promise<TWireConversationRole[]> {
    let json = await this.transport.get(`/conversations/${segment(conversationID.id)}/roles`);
    return sanitizeArray(json?.conversation_roles, sanitizeConversationRole);
  }

  ///////////////////////////////////////////////////////////
  // MLS

  /** The backend's own signature keys. The removal key for our ciphersuite
   * must be entry 0 of the group's `external_senders`, or the backend can
   * never evict anybody. */
  async getMLSPublicKeys(): Promise<TWireMLSPublicKeys> {
    return sanitizeMLSPublicKeys(await this.transport.get("/mls/public-keys"));
  }

  /** Our signature public key must be registered on the client before this,
   * otherwise the backend rejects every key package. */
  async uploadKeyPackages(clientID: string, keyPackages: string[]): Promise<void> {
    await this.transport.post(`/mls/key-packages/self/${segment(clientID)}`, { key_packages: keyPackages });
  }

  /** Drops the unclaimed key packages of those ciphersuites and installs these.
   * Only needed when the credential changed; use sparingly. */
  async replaceKeyPackages(clientID: string, keyPackages: string[], ciphersuites: number[]): Promise<void> {
    await this.transport.put(`/mls/key-packages/self/${segment(clientID)}`,
      { key_packages: keyPackages },
      { query: { ciphersuites: ciphersuites.map(cipherSuiteParam).join(",") } });
  }

  /** How many unclaimed key packages we still have. Refill below half. */
  async countKeyPackages(clientID: string, ciphersuite: number): Promise<number> {
    let json = await this.transport.get(`/mls/key-packages/self/${segment(clientID)}/count`,
      { query: { ciphersuite: cipherSuiteParam(ciphersuite) } });
    return sanitize.integer(json?.count, 0);
  }

  /** One key package per device of that user, consumed atomically. An empty
   * list means the user is not MLS capable. Our own device is left out. */
  async claimKeyPackages(userID: TWireQualifiedID, ciphersuite: number): Promise<TWireClaimedKeyPackage[]> {
    let json = await this.transport.post(
      `/mls/key-packages/claim/${segment(userID.domain)}/${segment(userID.id)}`, null,
      { query: { ciphersuite: cipherSuiteParam(ciphersuite) } });
    return sanitizeArray(json?.key_packages, sanitizeClaimedKeyPackage);
  }

  /** Takes key package *refs*, not key packages */
  async deleteKeyPackages(clientID: string, keyPackageRefs: string[], ciphersuite: number): Promise<void> {
    await this.transport.delete(`/mls/key-packages/self/${segment(clientID)}`,
      { key_packages: keyPackageRefs },
      { query: { ciphersuite: cipherSuiteParam(ciphersuite) } });
  }

  /** The commit, its group info, and the welcome if the commit adds anybody -
   * their `MLSMessage`s simply concatenated, no framing. The group ID and
   * epoch are read out of the messages, so there is no conversation in the URL. */
  async sendCommitBundle(bundle: Uint8Array): Promise<TWireMLSMessageSendingStatus> {
    return sanitizeMLSSendingStatus(
      await this.transport.postBinary("/mls/commit-bundles", bundle, kContentTypeMLS));
  }

  /** One raw `MLSMessage`. Commits must go through `sendCommitBundle()`. */
  async sendMLSMessage(message: Uint8Array): Promise<TWireMLSMessageSendingStatus> {
    return sanitizeMLSSendingStatus(
      await this.transport.postBinary("/mls/messages", message, kContentTypeMLS));
  }

  /** The raw `mls_group_info` message, to join the group by external commit */
  async getGroupInfo(conversationID: TWireQualifiedID): Promise<Uint8Array> {
    return await this.transport.getBinary(
      `/conversations/${segment(conversationID.domain)}/${segment(conversationID.id)}/groupinfo`);
  }

  /** Last resort for a group that can no longer be decrypted */
  async resetConversation(groupID: string, epoch: number): Promise<void> {
    await this.transport.post("/mls/reset-conversation", { group_id: groupID, epoch: epoch });
  }

  async getSubconversation(conversationID: TWireQualifiedID,
    subconversationID: string = kConferenceSubconversation): Promise<TWireSubconversation> {
    return sanitizeSubconversation(await this.transport.get(
      `${this.subconversationPath(conversationID, subconversationID)}`));
  }

  async getSubconversationGroupInfo(conversationID: TWireQualifiedID,
    subconversationID: string = kConferenceSubconversation): Promise<Uint8Array> {
    return await this.transport.getBinary(
      `${this.subconversationPath(conversationID, subconversationID)}/groupinfo`);
  }

  /** The backend sends a Remove proposal for our own leaf */
  async leaveSubconversation(conversationID: TWireQualifiedID,
    subconversationID: string = kConferenceSubconversation): Promise<void> {
    await this.transport.delete(`${this.subconversationPath(conversationID, subconversationID)}/self`);
  }

  async deleteSubconversation(conversationID: TWireQualifiedID, subconversationID: string,
    groupID: string, epoch: number): Promise<void> {
    await this.transport.delete(this.subconversationPath(conversationID, subconversationID),
      { group_id: groupID, epoch: epoch });
  }

  protected subconversationPath(conversationID: TWireQualifiedID, subconversationID: string): string {
    return `/conversations/${segment(conversationID.domain)}/${segment(conversationID.id)}` +
      `/subconversations/${segment(subconversationID)}`;
  }

  ///////////////////////////////////////////////////////////
  // Proteus

  /** One prekey per device we ask for, consumed atomically. A `null` prekey in
   * the answer means that device is gone: drop it from the recipients.
   * Chunked by user, so callers can pass the whole conversation. */
  async claimPrekeys(userClients: TWireQualifiedUserClients): Promise<TWireClaimedPrekeys> {
    let result: TWireClaimedPrekeys = { qualified_user_client_prekeys: {}, failed_to_list: [] };
    let users = Object.entries(userClients).flatMap(([domain, clientsByUser]) =>
      Object.entries(clientsByUser).map(([userID, clientIDs]) => ({ domain, userID, clientIDs })));
    for (let chunk of chunks(users, kListPrekeysChunkSize)) {
      let request: TWireQualifiedUserClients = {};
      for (let user of chunk) {
        request[user.domain] ??= {};
        request[user.domain][user.userID] = user.clientIDs;
      }
      let json = await this.transport.post("/users/list-prekeys", request);
      let prekeys = sanitizeClientPrekeyMap(json?.qualified_user_client_prekeys);
      for (let domain of Object.keys(prekeys)) { // A user is in exactly one chunk
        result.qualified_user_client_prekeys[domain] = {
          ...result.qualified_user_client_prekeys[domain], ...prekeys[domain],
        };
      }
      result.failed_to_list.push(...sanitizeArray(json?.failed_to_list, sanitizeQualifiedID));
    }
    return result;
  }

  /** One prekey for each of that user's devices */
  async getUserPrekeys(userID: TWireQualifiedID): Promise<TWirePrekeyBundle> {
    let json = await this.transport.get(
      `/users/${segment(userID.domain)}/${segment(userID.id)}/prekeys`);
    return {
      user: sanitize.alphanumdash(json?.user),
      clients: sanitizeArray(json?.clients, sanitizeClientPrekey),
    };
  }

  /** One prekey for one device, to start a session with it */
  async getClientPrekey(userID: TWireQualifiedID, clientID: string): Promise<TWireClientPrekey> {
    return sanitizeClientPrekey(await this.transport.get(
      `/users/${segment(userID.domain)}/${segment(userID.id)}/prekeys/${segment(clientID)}`));
  }

  /** The prekey IDs still on the server - the backend has no count endpoint.
   * One of them is the last-resort key, id 65535, which is never consumed, so
   * subtract it before comparing against a refill threshold. */
  async getRemainingPrekeyIDs(clientID: string): Promise<number[]> {
    let json = await this.transport.get(`/clients/${segment(clientID)}/prekeys`);
    return sanitizeArray(json, (prekeyID: any) => sanitize.integerRange(prekeyID, 0, kLastPrekeyID));
  }

  /** Refills the pool. This endpoint also renames the device and registers our
   * MLS keys, so it sends only what it was given. */
  async uploadPrekeys(clientID: string, prekeys: TWirePrekey[],
    lastPrekey: TWirePrekey | null = null): Promise<void> {
    let request: any = { prekeys: prekeys };
    if (lastPrekey) {
      request.lastkey = lastPrekey;
    }
    await this.transport.put(`/clients/${segment(clientID)}`, request);
  }

  /** `message` is an already-encoded `QualifiedNewOtrMessage`, one ciphertext
   * per recipient device.
   *
   * A 412 is not an error, so it does not throw: the backend refused the whole
   * message because our device list is stale. It comes back as `sent: false`
   * with the buckets to repair the payload from - drop `deleted`, claim
   * prekeys for `missing`, send once more. `failed_to_send` arrives with
   * `sent: true` instead and means one remote backend was unreachable. */
  async sendProteusMessage(conversationID: TWireQualifiedID, message: Uint8Array): Promise<TWireMessageSendingStatus> {
    let path = `/conversations/${segment(conversationID.domain)}/${segment(conversationID.id)}` +
      "/proteus/messages";
    try {
      return sanitizeMessageSendingStatus(
        await this.transport.postBinary(path, message, kContentTypeProtobuf), true);
    } catch (ex) {
      if (ex?.httpCode != 412) {
        throw ex;
      }
      return sanitizeMessageSendingStatus(ex.data, false);
    }
  }

  ///////////////////////////////////////////////////////////
  // Assets

  /** `bytes` are stored verbatim - encrypt before calling, if the asset needs
   * it. The body is a hand-built `multipart/mixed`: the server parses it with
   * its own tiny parser that allows only these headers, in this order. */
  async uploadAsset(bytes: Uint8Array, options: TWireAssetUploadOptions): Promise<TWireAsset> {
    let metadata: any = {
      public: options.public,
      retention: options.retention,
    };
    if (options.domain) {
      metadata.domain = options.domain;
    }
    if (options.audit) { // Mandatory when the team logs asset access
      metadata.convId = options.audit.convID;
      metadata.filename = options.audit.filename;
      metadata.filetype = options.audit.filetype;
    }
    let metadataBytes = kUTF8.encode(JSON.stringify(metadata));
    let boundary = "Frontier" + alphanumeric(32);
    let body = concatBytes(
      kUTF8.encode(
        `--${boundary}\r\n` +
        "Content-Type: application/json;charset=utf-8\r\n" +
        `Content-length: ${metadataBytes.length}\r\n` + // Bytes, not characters
        "\r\n"),
      metadataBytes,
      kUTF8.encode(
        `\r\n--${boundary}\r\n` +
        "Content-Type: application/octet-stream\r\n" +
        `Content-length: ${bytes.length}\r\n` +
        `Content-MD5: ${base64Encode(md5(bytes))}\r\n` +
        "\r\n"),
      bytes,
      kUTF8.encode(`\r\n--${boundary}--\r\n`));

    let json = await this.transport.postBinary("/assets", body, `multipart/mixed; boundary=${boundary}`);
    return {
      key: sanitize.alphanumdash(json?.key),
      domain: sanitize.hostname(json?.domain),
      token: base64OrNull(json?.token),
      expires: isoDate(json?.expires),
    };
  }

  /** Public assets - profile pictures, and message attachments, which rely on
   * their AES key instead - have no token, and sending one would fail. */
  async downloadAsset(domain: string, key: string, token: string | null = null): Promise<Uint8Array> {
    let params: Record<string, string> = {};
    if (token) {
      params.asset_token = token;
    }
    return await this.transport.getBinary(
      `/assets/${segment(domain)}/${segment(key)}`, { query: params });
  }

  /** The absolute URL of a profile picture, for code that fetches it itself.
   * Still needs our bearer token, so it is not an `<img src>`. A profile
   * picture asset has no `domain` on older payloads; then it is the user's. */
  assetURL(domain: string, key: string): string {
    let version = this.transport.version > 0 ? `/v${this.transport.version}` : "";
    return `${this.transport.baseURL}${version}/assets/${segment(domain)}/${segment(key)}`;
  }

  ///////////////////////////////////////////////////////////
  // Notifications

  /** The events since the notification `since`, for this device only.
   * `lost` says the stream no longer reaches that far back: refetch
   * conversations, users and connections, then resume without a `since`. */
  async getNotifications(since: string | null, clientID: string,
    size: number = kNotificationsPageSize): Promise<TWireNotifications> {
    let params: Record<string, string | number> = { client: clientID, size: size };
    if (since) {
      params.since = since;
    }
    try {
      return sanitizeNotifications(await this.transport.get("/notifications", { query: params }), false);
    } catch (ex) {
      // 404 = the gap. Up to API v2 the body still holds everything after it,
      // from v3 it is a plain error body. 400 = `since` is not a v1 UUID any more.
      if (ex?.httpCode != 404 && !(ex?.httpCode == 400 && since)) {
        throw ex;
      }
      return sanitizeNotifications(ex.data, true);
    }
  }

  /** To start a new device where the account already is, without replaying its
   * whole history. `null` when the account has no notifications yet. */
  async getLastNotification(clientID: string): Promise<TWireNotification | null> {
    let json = await this.notFoundAsNull(
      this.transport.get("/notifications/last", { query: { client: clientID } }));
    return json ? sanitizeNotification(json) : null;
  }

  /** For endpoints where "there is none" is a normal state, not an error */
  protected async notFoundAsNull(request: Promise<any>): Promise<any> {
    try {
      return await request;
    } catch (ex) {
      if (ex?.httpCode != 404) {
        throw ex;
      }
      return null;
    }
  }
}

const kContentTypeMLS = "message/mls";
const kContentTypeProtobuf = "application/x-protobuf";
const kConferenceSubconversation = "conference";
const kUTF8 = new TextEncoder();
/** The last-resort prekey, which the backend hands out for ever */
const kLastPrekeyID = 0xFFFF;
/** Reference client chunk sizes, at or below the server's own caps */
const kListUsersChunkSize = 100;
const kListHandlesChunkSize = 4;
const kListPrekeysChunkSize = 128;
const kListClientsChunkSize = 500;
const kListConversationsChunkSize = 500;
const kConversationIDsPageSize = 1000;
const kConnectionsPageSize = 500;
const kTeamMembersPageSize = 2000;
const kNotificationsPageSize = 1000;
const kSearchSize = 15;
/** Standard and URL base64 alphabets, with and without padding */
const kBase64 = /^[A-Za-z0-9+/=_-]+$/;

///////////////////////////////////////////////////////////
// Sanitizing the server's JSON

function sanitizeQualifiedID(json: any): TWireQualifiedID {
  return {
    id: sanitize.alphanumdash(json?.id),
    domain: sanitize.hostname(json?.domain),
  };
}

function sanitizeUser(json: any): TWireUser {
  return {
    qualified_id: sanitizeQualifiedID(json?.qualified_id),
    name: sanitize.label(json?.name, ""),
    handle: sanitize.label(json?.handle, null),
    email: sanitize.emailAddress(json?.email, null),
    text_status: sanitize.label(json?.text_status, null),
    accent_id: sanitize.integer(json?.accent_id, 0),
    assets: sanitizeArray(json?.assets, sanitizeUserAsset),
    type: sanitize.enum(json?.type, ["regular", "app", "bot"], "regular"),
    legalhold_status: sanitize.enum(json?.legalhold_status,
      ["enabled", "pending", "disabled", "no_consent"], "no_consent"),
    supported_protocols: sanitizeProtocols(json?.supported_protocols),
    service: sanitizeServiceRef(json?.service),
    team: sanitize.alphanumdash(json?.team, null),
    expires_at: isoDate(json?.expires_at),
    deleted: sanitize.boolean(json?.deleted, false), // Only ever sent as `true`
    searchable: sanitize.boolean(json?.searchable, true),
  };
}

function sanitizeSelf(json: any): TWireSelf {
  return {
    ...sanitizeUser(json),
    locale: sanitize.label(json?.locale, null),
    status: sanitize.enum(json?.status, ["active", "suspended", "deleted", "ephemeral"], null),
    managed_by: sanitize.enum(json?.managed_by, ["wire", "scim"], "wire"),
    email_unvalidated: sanitize.emailAddress(json?.email_unvalidated, null),
    sso_id: json?.sso_id ? {
      tenant: sanitize.label(json.sso_id.tenant, null),
      subject: sanitize.label(json.sso_id.subject, null),
      scim_external_id: sanitize.label(json.sso_id.scim_external_id, null),
    } : null,
  };
}

function sanitizeUserAsset(json: any): TWireUserAsset {
  return {
    key: sanitize.alphanumdash(json?.key),
    domain: json?.domain ? sanitize.hostname(json.domain) : null,
    size: sanitize.enum(json?.size, ["preview", "complete"], "complete"),
    type: sanitize.enum(json?.type, ["image"], "image"),
  };
}

function sanitizeServiceRef(json: any): TWireServiceRef | null {
  return json ? {
    id: sanitize.alphanumdash(json.id),
    provider: sanitize.alphanumdash(json.provider),
  } : null;
}

function sanitizeProtocols(json: any): TWireProtocol[] {
  let protocols = sanitizeArray(json, (protocol: any) =>
    sanitize.enum(protocol, ["proteus", "mls"], null))
    .filter(protocol => !!protocol);
  return protocols.length ? protocols : ["proteus"]; // The server's own default
}

function sanitizeClient(json: any): TWireClient {
  return {
    id: sanitize.alphanumdash(json?.id),
    class: sanitize.enum(json?.class, ["desktop", "phone", "tablet", "legalhold"], null),
  };
}

function sanitizeContact(json: any): TWireContact {
  return {
    qualified_id: sanitizeQualifiedID(json?.qualified_id),
    name: sanitize.label(json?.name, ""),
    handle: sanitize.label(json?.handle, null),
    accent_id: sanitize.integer(json?.accent_id, null),
    team: sanitize.alphanumdash(json?.team, null),
    type: sanitize.enum(json?.type, ["regular", "app", "bot"], "regular"),
  };
}

function sanitizeConnection(json: any): TWireConnection {
  return {
    from: sanitize.alphanumdash(json?.from),
    qualified_to: sanitizeQualifiedID(json?.qualified_to),
    status: sanitize.enum(json?.status, ["sent", "pending", "accepted", "blocked",
      "ignored", "cancelled", "missing-legalhold-consent"]),
    last_update: isoDate(json?.last_update),
    qualified_conversation: json?.qualified_conversation
      ? sanitizeQualifiedID(json.qualified_conversation) : null,
  };
}

function sanitizeTeamMember(json: any): TWireTeamMember {
  return {
    user: sanitize.alphanumdash(json?.user),
    created_at: isoDate(json?.created_at),
    created_by: sanitize.alphanumdash(json?.created_by, null),
    legalhold_status: sanitize.enum(json?.legalhold_status,
      ["enabled", "pending", "disabled", "no_consent"], null),
    permissions: json?.permissions ? {
      self: sanitize.integer(json.permissions.self, 0),
      copy: sanitize.integer(json.permissions.copy, 0),
    } : null,
  };
}

function sanitizeFeature(json: any): TWireFeature {
  return {
    status: sanitize.enum(json?.status, ["enabled", "disabled"], "disabled"),
    lockStatus: sanitize.enum(json?.lockStatus, ["locked", "unlocked"], null),
    ttl: typeof (json?.ttl) == "number" ? sanitize.integer(json.ttl, null) : sanitize.label(json?.ttl, null),
    config: json?.config ?? null,
  };
}

function sanitizeConversation(json: any): TWireConversation {
  return {
    qualified_id: sanitizeQualifiedID(json?.qualified_id),
    type: sanitize.integerRange(json?.type, 0, 3) as 0 | 1 | 2 | 3,
    creator: sanitize.alphanumdash(json?.creator, null),
    name: sanitize.label(json?.name, null),
    team: sanitize.alphanumdash(json?.team, null),
    access: sanitizeArray(json?.access, (access: any) => sanitize.alphanumdash(access)),
    access_role: sanitizeArray(json?.access_role, (role: any) => sanitize.alphanumdash(role)),
    message_timer: sanitize.integer(json?.message_timer, null),
    receipt_mode: sanitize.integer(json?.receipt_mode, null),
    members: {
      self: json?.members?.self ? sanitizeSelfMember(json.members.self) : null,
      others: sanitizeArray(json?.members?.others, sanitizeOtherMember),
    },
    protocol: sanitize.enum(json?.protocol, ["proteus", "mls", "mixed"], "proteus"),
    group_id: base64OrNull(json?.group_id),
    epoch: sanitize.integer(json?.epoch, null),
    epoch_timestamp: isoDate(json?.epoch_timestamp),
    cipher_suite: sanitize.integer(json?.cipher_suite, null),
    group_conv_type: sanitize.enum(json?.group_conv_type,
      ["group_conversation", "channel", "meeting"], null),
    add_permission: sanitize.enum(json?.add_permission, ["admins", "everyone"], null),
    cells_state: sanitize.enum(json?.cells_state, ["disabled", "pending", "ready"], null),
  };
}

function sanitizeSelfMember(json: any): TWireSelfMember {
  return {
    qualified_id: sanitizeQualifiedID(json?.qualified_id),
    conversation_role: sanitize.alphanumdash(json?.conversation_role, "wire_admin"),
    otr_archived: sanitize.boolean(json?.otr_archived, false),
    otr_archived_ref: isoDate(json?.otr_archived_ref),
    otr_muted_status: sanitize.integer(json?.otr_muted_status, null),
    otr_muted_ref: isoDate(json?.otr_muted_ref),
    hidden: sanitize.boolean(json?.hidden, false),
    hidden_ref: sanitize.label(json?.hidden_ref, null),
    service: sanitizeServiceRef(json?.service),
  };
}

function sanitizeOtherMember(json: any): TWireOtherMember {
  return {
    qualified_id: sanitizeQualifiedID(json?.qualified_id),
    conversation_role: sanitize.alphanumdash(json?.conversation_role, "wire_admin"),
    service: sanitizeServiceRef(json?.service),
  };
}

function sanitizeConversationRole(json: any): TWireConversationRole {
  return {
    conversation_role: sanitize.alphanumdash(json?.conversation_role),
    actions: sanitizeArray(json?.actions, (action: any) => sanitize.alphanumdash(action)),
  };
}

function sanitizeConversationCode(json: any): TWireConversationCode {
  return {
    key: sanitize.alphanumdash(json?.key),
    code: sanitize.alphanumdash(json?.code),
    uri: sanitize.url(json?.uri, null),
    has_password: sanitize.boolean(json?.has_password, false),
  };
}

function sanitizeMLSPublicKeys(json: any): TWireMLSPublicKeys {
  let removal = sanitize.object(json?.removal, {}) as Record<string, any>;
  let keys: Record<string, string> = {};
  for (let scheme of Object.keys(removal)) {
    keys[sanitize.alphanumdash(scheme)] = base64(removal[scheme]);
  }
  return { removal: keys };
}

function sanitizeClaimedKeyPackage(json: any): TWireClaimedKeyPackage {
  return {
    user: sanitize.alphanumdash(json?.user),
    domain: sanitize.hostname(json?.domain),
    client: sanitize.alphanumdash(json?.client),
    key_package: base64(json?.key_package),
    key_package_ref: base64(json?.key_package_ref),
  };
}

function sanitizeMLSSendingStatus(json: any): TWireMLSMessageSendingStatus {
  return {
    events: sanitizeArray(json?.events, (event: any) => sanitizeEvent(event)).filter(event => !!event),
    time: isoDate(json?.time),
    failed_to_send: sanitizeArray(json?.failed_to_send, sanitizeQualifiedID),
    failed: sanitizeArray(json?.failed, sanitizeQualifiedID),
  };
}

function sanitizeSubconversation(json: any): TWireSubconversation {
  return {
    parent_qualified_id: sanitizeQualifiedID(json?.parent_qualified_id),
    subconv_id: sanitize.alphanumdash(json?.subconv_id),
    group_id: base64(json?.group_id),
    epoch: sanitize.integer(json?.epoch, 0),
    epoch_timestamp: isoDate(json?.epoch_timestamp),
    cipher_suite: sanitize.integer(json?.cipher_suite, null),
    members: sanitizeArray(json?.members, sanitizeSubconversationMember),
  };
}

function sanitizeSubconversationMember(json: any): TWireSubconversationMember {
  return {
    user_id: sanitize.alphanumdash(json?.user_id),
    domain: sanitize.hostname(json?.domain),
    client_id: sanitize.alphanumdash(json?.client_id),
  };
}

function sanitizeNotifications(json: any, lost: boolean): TWireNotifications {
  return {
    notifications: sanitizeArray(json?.notifications, sanitizeNotification),
    has_more: sanitize.boolean(json?.has_more, false),
    time: isoDate(json?.time),
    lost: lost,
  };
}

function sanitizeNotification(json: any): TWireNotification {
  return {
    id: sanitize.alphanumdash(json?.id),
    payload: sanitizeArray(json?.payload, (event: any) => sanitizeEvent(event)).filter(event => !!event),
  };
}

/** Only `type` is sanitized: what else an event carries depends on it, so
 * whoever reads a field sanitizes that field. `null` when the call answered
 * "nothing changed" instead of with an event. */
function sanitizeEvent(json: any): TWireEvent | null {
  return json?.type ? { ...json, type: sanitize.nonemptystring(json.type) } : null;
}

function sanitizePrekey(json: any): TWirePrekey {
  return {
    id: sanitize.integerRange(json?.id, 0, kLastPrekeyID),
    key: base64(json?.key),
  };
}

function sanitizeClientPrekey(json: any): TWireClientPrekey {
  return {
    client: sanitize.alphanumdash(json?.client),
    prekey: sanitizePrekey(json?.prekey),
  };
}

/** The `null`s are kept: they say that device no longer exists */
function sanitizeClientPrekeyMap(json: any): TWireClientPrekeyMap {
  return sanitizeUserMap(json, (byClient: any) => {
    let clients = sanitize.object(byClient, {}) as Record<string, any>;
    let prekeys: Record<string, TWirePrekey | null> = {};
    for (let clientID of Object.keys(clients)) {
      prekeys[sanitize.alphanumdash(clientID)] =
        clients[clientID] ? sanitizePrekey(clients[clientID]) : null;
    }
    return prekeys;
  });
}

function sanitizeUserClientIDs(json: any): TWireQualifiedUserClients {
  return sanitizeUserMap(json, (clientIDs: any) =>
    sanitizeArray(clientIDs, (clientID: any) => sanitize.alphanumdash(clientID)));
}

function sanitizeMessageSendingStatus(json: any, sent: boolean): TWireMessageSendingStatus {
  return {
    sent: sent,
    time: isoDate(json?.time),
    missing: sanitizeUserClientIDs(json?.missing),
    redundant: sanitizeUserClientIDs(json?.redundant),
    deleted: sanitizeUserClientIDs(json?.deleted),
    failed_to_send: sanitizeUserClientIDs(json?.failed_to_send),
    failed_to_confirm_clients: sanitizeUserClientIDs(json?.failed_to_confirm_clients),
  };
}

///////////////////////////////////////////////////////////
// Generic helpers

/** The `domain -> user -> something` maps that the federated endpoints use */
function sanitizeUserMap<T>(json: any, sanitizeValue: (value: any) => T): Record<string, Record<string, T>> {
  let map: Record<string, Record<string, T>> = {};
  let byDomain = sanitize.object(json, {}) as Record<string, any>;
  for (let uncheckedDomain of Object.keys(byDomain)) {
    let byUser = sanitize.object(byDomain[uncheckedDomain], {}) as Record<string, any>;
    let users: Record<string, T> = {};
    for (let userID of Object.keys(byUser)) {
      users[sanitize.alphanumdash(userID)] = sanitizeValue(byUser[userID]);
    }
    map[sanitize.hostname(uncheckedDomain)] = users;
  }
  return map;
}

function sanitizeArray<T>(json: any, sanitizeItem: (item: any) => T): T[] {
  return (sanitize.array(json, []) as any[]).map(sanitizeItem);
}

/** Merges one `{found, not_found, failed}` answer into the buckets */
function addFound<T>(result: TWireFound<T>, json: any, sanitizeItem: (item: any) => T): void {
  result.found.push(...sanitizeArray(json?.found, sanitizeItem));
  result.notFound.push(...sanitizeArray(json?.not_found, sanitizeQualifiedID));
  result.failed.push(...sanitizeArray(json?.failed, sanitizeQualifiedID));
}

/** Validated, never rewritten, so key packages, MLS messages, group IDs and
 * asset tokens stay byte-exact. Accepts both base64 alphabets. */
function base64(unchecked: string | null | undefined): string {
  let value = sanitize.nonemptystring(unchecked);
  assert(kBase64.test(value), "Wire: Not base64");
  return value;
}

function base64OrNull(unchecked: string | null | undefined): string | null {
  return unchecked ? base64(unchecked) : null;
}

/** Checks that the server sent a real timestamp, and normalizes it */
function isoDate(unchecked: string | null | undefined): string | null {
  return unchecked ? sanitize.date(unchecked).toISOString() : null;
}

/** A value we put into a URL path */
function segment(value: string): string {
  return encodeURIComponent(sanitize.nonemptystring(value));
}

/** `?ciphersuite=0x0001` */
function cipherSuiteParam(ciphersuite: number): string {
  return "0x" + sanitize.integerRange(ciphersuite, 0, 0xFFFF).toString(16).padStart(4, "0");
}

function chunks<T>(array: T[], size: number): T[][] {
  let result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

function alphanumeric(length: number): string {
  let alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return [...randomBytes(length)].map(random => alphabet[random % alphabet.length]).join("");
}
