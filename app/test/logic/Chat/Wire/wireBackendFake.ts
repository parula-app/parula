/** An in-process Wire backend, for the end-to-end test.
 *
 * It answers at the same seam the app has: `appGlobal.remoteApp.kyCreate` for
 * HTTP and `globalThis.WebSocket` for the event stream. Everything above that
 * is the real client.
 *
 * It is deliberately strict where `Protocol/07-MLS-in-Wire.md` Appendix B says
 * a real backend is strict, because every one of those rules fails *silently*
 * on a real deployment: the empty member list of an MLS conversation, the
 * `mls_public_keys` registration before the first key package, the commit as a
 * `PublicMessage`, the `ratchet_tree` in the GroupInfo, the credential identity
 * `<uuid>:<client>@<domain>`, and the epoch of every message.
 *
 * MLS membership is not bookkept here: it is read out of the `ratchet_tree` of
 * each commit's GroupInfo, which is what the group itself says. A client that
 * writes a tree we cannot read, or that adds a device it does not Welcome,
 * fails here rather than weeks later.
 */
import type { TWirePrekey } from "../../../../logic/Chat/Wire/TWire";
import { QualifiedNewOtrMessage } from "../../../../logic/Chat/Wire/Proteus/otr";
import { decode } from "../../../../logic/Chat/Signal/Proto/codec";
import { MLSMessage } from "../../../../logic/Chat/MLS/Messages/MLSMessage";
import { ContentType, PrivateMessage, PublicMessage, SenderType, WireFormat } from "../../../../logic/Chat/MLS/Messages/Framing";
import { KeyPackage } from "../../../../logic/Chat/MLS/Messages/KeyPackage";
import { Extension, ExtensionType } from "../../../../logic/Chat/MLS/Messages/Extension";
import { BasicCredential } from "../../../../logic/Chat/MLS/Messages/Credential";
import type { LeafNode } from "../../../../logic/Chat/MLS/Tree/LeafNode";
import { LeafNodeSource } from "../../../../logic/Chat/MLS/Tree/LeafNode";
import { RatchetTree } from "../../../../logic/Chat/MLS/Tree/RatchetTree";
import { CipherSuite } from "../../../../logic/Chat/MLS/Crypto/CipherSuite";
import { TLSReader } from "../../../../logic/Chat/MLS/Codec/TLSReader";
import { base64Decode, base64Encode, bytesEqual, md5, randomBytes } from "../../../../logic/Chat/Signal/Crypto/primitives";
import { appGlobal } from "../../../../logic/app";

export class WireBackendFake {
  readonly domain = "example.com";
  readonly baseURL = "https://nginz-https.example.com";
  readonly websocketURL = "wss://nginz-ssl.example.com";
  /** The backend's own MLS signature key: `external_senders[0]` of every group */
  readonly removalKeyPair = CipherSuite.forID(0x0001).generateSignatureKeyPair();
  readonly users = new Map<string, FakeUser>();
  readonly conversations = new Map<string, FakeConversation>();
  /** `<user>:<user>` sorted -> their MLS 1:1, which §11 conjures on demand */
  readonly oneToOnes = new Map<string, FakeConversation>();
  readonly assets = new Map<string, FakeAsset>();
  readonly notifications: FakeNotification[] = [];
  readonly sockets: FakeWireSocket[] = [];
  /** Access token -> who it belongs to */
  readonly tokens = new Map<string, FakeSession>();
  /** `zuid` cookie -> user ID */
  readonly cookies = new Map<string, string>();
  /** Every request, so that a test can say what the client actually called */
  readonly requests: { method: string, path: string }[] = [];
  /** Server time. Every event gets its own, increasing timestamp, which is
   * what tells the second copy of a duplicated event from the first. */
  protected clock = Date.parse("2026-03-01T12:00:00.000Z");
  protected nextToken = 0;

  /** Takes over `appGlobal.remoteApp` and `globalThis.WebSocket`. */
  install(): void {
    gBackend = this;
    appGlobal.remoteApp = {
      kyCreate: async (defaultOptions: any) => this.ky(defaultOptions),
      computerOn: { isSleeping: false, subscribe: () => () => undefined },
      // `ChatAccount.listRooms()` reads the room table directly, below the
      // storage interface. There is nothing in it.
      getSQLiteDatabase: async () => ({
        migrate: async () => undefined,
        pragma: async () => undefined,
        all: async () => [],
        get: async () => undefined,
        run: async () => ({ lastInsertRowid: 0 }),
        execute: async () => undefined,
      }),
    };
    (globalThis as any).WebSocket = FakeWireSocket;
  }

  addUser(values: {
    id: string, clientID: string, name: string, email: string, password: string,
    protocols?: ("proteus" | "mls")[], mls?: boolean,
  }): FakeUser {
    let user: FakeUser = {
      id: values.id,
      name: values.name,
      email: values.email,
      password: values.password,
      supportedProtocols: values.protocols ?? ["proteus", "mls"],
      mlsEnabled: values.mls ?? true,
      nextClientID: values.clientID,
      clients: new Map(),
      connections: new Map(),
    };
    this.users.set(user.id, user);
    return user;
  }

  /** An accepted contact request between 2 users, and its Proteus 1:1. */
  connect(a: FakeUser, b: FakeUser): FakeConversation {
    let conversation = this.newConversation({
      type: 2, protocol: "proteus", creator: a.id, members: [a.id, b.id],
    });
    a.connections.set(b.id, conversation.id);
    b.connections.set(a.id, conversation.id);
    return conversation;
  }

  newConversation(values: {
    type: 0 | 1 | 2 | 3, protocol: "proteus" | "mls", creator: string,
    members: string[], name?: string,
  }): FakeConversation {
    let conversation: FakeConversation = {
      id: crypto.randomUUID(),
      type: values.type,
      name: values.name ?? null,
      protocol: values.protocol,
      creator: values.creator,
      members: new Set(values.members),
      admins: new Set([values.creator]),
      groupID: null,
      epoch: 0,
      cipherSuite: null,
      groupInfo: null,
      mlsClients: new Set(),
      receiptMode: 1, // read receipts on, as a team turns them on
    };
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  ///////////////////////////////////////////////////////////
  // HTTP

  protected ky(defaultOptions: any): any {
    let ky: any = {};
    for (let method of ["get", "post", "put", "patch", "delete", "head"]) {
      ky[method] = async (url: string, options: any) =>
        await this.request(method, url, options ?? {}, defaultOptions.headers ?? {});
    }
    return ky;
  }

  protected async request(method: string, url: string, options: any,
    headers: Record<string, string>): Promise<FakeHTTPResponse> {
    let parsed = new URL(url);
    // The `/vN` prefix is nginz's, and never reaches a service
    let path = parsed.pathname.replace(/^\/v\d+(?=\/)/, "");
    this.requests.push({ method, path });
    try {
      return this.route(method, path, parsed.searchParams, options, headers);
    } catch (ex) {
      if (ex instanceof FakeHTTPError) {
        return jsonResponse(ex.status,
          { code: ex.status, label: ex.label, message: ex.serverMessage, ...ex.data });
      }
      throw ex; // a bug in the fake must not read as a plausible server error
    }
  }

  protected route(method: string, path: string, query: URLSearchParams, options: any,
    headers: Record<string, string>): FakeHTTPResponse {
    let json = options.json;
    let call = `${method.toUpperCase()} ${path}`;
    let parts = path.split("/").slice(1).map(part => decodeURIComponent(part));

    switch (call) {
      case "GET /api-version":
        return jsonResponse(200, {
          supported: [0, 1, 2, 3, 4, 5, 6, 7, 8], development: [9],
          federation: false, domain: this.domain,
        });
      case "GET /config.json":
        return jsonResponse(200,
          { endpoints: { backendWSURL: this.websocketURL.replace(/^ws/, "http") } });
      case "POST /login":
        return this.login(json);
      case "POST /access":
        return this.access(headers, query.get("client_id"));
      case "POST /access/logout":
        return this.logout(headers);
      case "GET /self":
        return jsonResponse(200, this.userJSON(this.session(headers).user, true));
      case "GET /feature-configs":
        return jsonResponse(200, this.featureConfigs(this.session(headers).user));
      case "GET /clients":
        return jsonResponse(200, [...this.session(headers).user.clients.values()].map(clientJSON));
      case "POST /clients":
        return this.registerClient(headers, json);
      case "POST /list-users":
        return this.listUsers(headers, json);
      case "POST /users/list-clients":
        return this.listUserClients(headers, json);
      case "POST /users/list-prekeys":
        return this.listPrekeys(headers, json);
      case "POST /list-connections":
        return this.listConnections(headers);
      case "POST /conversations/list-ids":
        return this.listConversationIDs(headers);
      case "POST /conversations/list":
        return this.listConversations(headers, json);
      case "POST /conversations":
        return this.createConversation(headers, json);
      case "GET /mls/public-keys":
        return jsonResponse(200, { removal: { ed25519: base64Encode(this.removalKeyPair.publicKey) } });
      case "POST /mls/commit-bundles":
        return this.commitBundle(headers, options.body);
      case "POST /mls/messages":
        return this.mlsMessage(headers, options.body);
      case "POST /assets":
        return this.uploadAsset(headers, options.body, headers["Content-Type"]);
      case "GET /notifications":
        return this.getNotifications(headers, query);
      case "GET /notifications/last":
        return this.getLastNotification(headers, query);
    }

    if (method == "put" && parts[0] == "clients" && parts.length == 2) {
      return this.updateClient(headers, parts[1], json);
    }
    if (method == "get" && parts[0] == "clients" && parts[2] == "prekeys") {
      return jsonResponse(200, [...this.ourClient(headers, parts[1]).prekeys.keys()]);
    }
    if (method == "post" && path.startsWith("/mls/key-packages/self/")) {
      return this.uploadKeyPackages(headers, parts[3], json);
    }
    if (method == "get" && path.startsWith("/mls/key-packages/self/") && parts[4] == "count") {
      return jsonResponse(200, { count: this.ourClient(headers, parts[3]).keyPackages.length });
    }
    if (method == "post" && path.startsWith("/mls/key-packages/claim/")) {
      return this.claimKeyPackages(headers, parts[3], parts[4]);
    }
    if (method == "get" && parts[0] == "users" && parts.length == 3) {
      return jsonResponse(200, this.userJSON(this.user(parts[2]), false));
    }
    if (method == "get" && parts[0] == "one2one-conversations" && parts.length == 3) {
      return this.mlsOneToOne(headers, parts[2]);
    }
    if (method == "get" && parts[0] == "conversations" && parts.length == 3) {
      return jsonResponse(200,
        this.conversationJSON(this.conversation(parts[2]), this.session(headers).user));
    }
    if (method == "get" && parts[0] == "conversations" && parts[3] == "groupinfo") {
      return this.groupInfo(headers, parts[2]);
    }
    if (method == "post" && parts[0] == "conversations" && parts[3] == "proteus" && parts[4] == "messages") {
      return this.proteusMessage(headers, parts[2], options.body);
    }
    if (method == "delete" && parts[0] == "conversations" && parts[3] == "members") {
      return this.removeMember(headers, parts[2], parts[5]);
    }
    if (method == "get" && parts[0] == "assets" && parts.length == 3) {
      return this.downloadAsset(headers, parts[2], query.get("asset_token"));
    }
    throw new FakeHTTPError(404, "no-endpoint", `The fake backend has no ${call}`);
  }

  ///////////////////////////////////////////////////////////
  // Login and devices

  protected login(json: any): FakeHTTPResponse {
    let user = [...this.users.values()].find(each => each.email == json?.email);
    if (!user || user.password != json?.password) {
      throw new FakeHTTPError(403, "invalid-credentials", "Authentication failed");
    }
    let cookie = `${crypto.randomUUID().replace(/-/g, "")}.v=1.k=1.d=1618838628.t=u.l=.u=${user.id}`;
    this.cookies.set(cookie, user.id);
    return jsonResponse(200, this.accessTokenFor(user, null), {
      "set-cookie": [`zuid=${cookie}; Path=/access; HttpOnly; Secure`],
    });
  }

  protected access(headers: Record<string, string>, clientID: string | null): FakeHTTPResponse {
    let cookie = /^zuid=(.*)$/.exec(headers.Cookie ?? "")?.[1];
    let userID = cookie ? this.cookies.get(cookie) : null;
    if (!userID) {
      throw new FakeHTTPError(403, "invalid-credentials", "Invalid cookie");
    }
    let user = this.user(userID);
    if (clientID && !user.clients.has(clientID)) {
      throw new FakeHTTPError(403, "invalid-credentials", "Unknown device");
    }
    return jsonResponse(200, this.accessTokenFor(user, clientID));
  }

  protected logout(headers: Record<string, string>): FakeHTTPResponse {
    let cookie = /^zuid=(.*)$/.exec(headers.Cookie ?? "")?.[1];
    if (cookie) {
      this.cookies.delete(cookie);
    }
    return jsonResponse(200, {});
  }

  protected accessTokenFor(user: FakeUser, clientID: string | null): any {
    let token = `access-token-${this.nextToken++}`;
    this.tokens.set(token, { user, clientID });
    return { access_token: token, expires_in: 900, token_type: "Bearer", user: user.id };
  }

  protected registerClient(headers: Record<string, string>, json: any): FakeHTTPResponse {
    let user = this.session(headers).user;
    if (user.clients.size && json?.password != user.password) {
      throw new FakeHTTPError(403, "missing-auth", "The 2nd device needs the password");
    }
    if (!Array.isArray(json?.prekeys) || !json?.lastkey) {
      throw new FakeHTTPError(400, "bad-request", "A new device must bring its Proteus prekeys");
    }
    if (json.lastkey.id != kLastPrekeyID) {
      throw new FakeHTTPError(400, "bad-request", "The last-resort prekey must have the ID 65535");
    }
    let client: FakeClient = {
      id: user.nextClientID,
      user: user,
      class: String(json.class ?? "desktop"),
      label: String(json.label ?? ""),
      model: String(json.model ?? ""),
      mlsPublicKeys: { ...json.mls_public_keys },
      prekeys: new Map(),
      lastPrekey: json.lastkey,
      keyPackages: [],
      claimed: [],
    };
    for (let prekey of json.prekeys as TWirePrekey[]) {
      client.prekeys.set(prekey.id, prekey);
    }
    user.clients.set(client.id, client);
    return jsonResponse(201, clientJSON(client));
  }

  /** `PUT /clients/:id`: more prekeys, and the MLS keys of an existing device */
  protected updateClient(headers: Record<string, string>, clientID: string, json: any): FakeHTTPResponse {
    let client = this.ourClient(headers, clientID);
    for (let prekey of (json?.prekeys ?? []) as TWirePrekey[]) {
      client.prekeys.set(prekey.id, prekey);
    }
    if (json?.lastkey) {
      client.lastPrekey = json.lastkey;
    }
    if (json?.mls_public_keys) {
      client.mlsPublicKeys = { ...client.mlsPublicKeys, ...json.mls_public_keys };
    }
    return jsonResponse(200, {});
  }

  ///////////////////////////////////////////////////////////
  // Users

  protected listUsers(headers: Record<string, string>, json: any): FakeHTTPResponse {
    this.session(headers);
    let found: any[] = [];
    let notFound: any[] = [];
    for (let id of (json?.qualified_ids ?? []) as any[]) {
      let user = this.users.get(id.id);
      if (user) {
        found.push(this.userJSON(user, false));
      } else {
        notFound.push(id);
      }
    }
    return jsonResponse(200, { found, not_found: notFound, failed: [] });
  }

  protected listUserClients(headers: Record<string, string>, json: any): FakeHTTPResponse {
    this.session(headers);
    let byUser: Record<string, any> = {};
    for (let id of (json?.qualified_users ?? []) as any[]) {
      let user = this.users.get(id.id);
      if (user) {
        byUser[user.id] = [...user.clients.values()].map(clientJSON);
      }
    }
    return jsonResponse(200, { qualified_user_map: { [this.domain]: byUser } });
  }

  /** One prekey per device, consumed. The last-resort one is handed out for ever. */
  protected listPrekeys(headers: Record<string, string>, json: any): FakeHTTPResponse {
    this.session(headers);
    let byUser: Record<string, any> = {};
    for (let userID of Object.keys(json?.[this.domain] ?? {})) {
      let user = this.users.get(userID);
      if (!user) {
        continue;
      }
      let byClient: Record<string, any> = {};
      for (let clientID of json[this.domain][userID] as string[]) {
        let client = user.clients.get(clientID);
        // `{id, key}` directly; a `null` means that device is gone
        byClient[clientID] = client ? takePrekey(client) : null;
      }
      byUser[userID] = byClient;
    }
    return jsonResponse(200,
      { qualified_user_client_prekeys: { [this.domain]: byUser }, failed_to_list: [] });
  }

  protected listConnections(headers: Record<string, string>): FakeHTTPResponse {
    let user = this.session(headers).user;
    let connections = [...user.connections.entries()].map(([peerID, conversationID]) => ({
      from: user.id,
      to: peerID,
      qualified_to: { id: peerID, domain: this.domain },
      status: "accepted",
      last_update: new Date(this.clock).toISOString(),
      conversation: conversationID,
      qualified_conversation: { id: conversationID, domain: this.domain },
    }));
    return jsonResponse(200, { connections, has_more: false });
  }

  ///////////////////////////////////////////////////////////
  // Conversations

  protected listConversationIDs(headers: Record<string, string>): FakeHTTPResponse {
    let user = this.session(headers).user;
    return jsonResponse(200, {
      qualified_conversations: [...this.conversations.values()]
        .filter(conversation => conversation.members.has(user.id))
        .map(conversation => ({ id: conversation.id, domain: this.domain })),
      has_more: false,
    });
  }

  protected listConversations(headers: Record<string, string>, json: any): FakeHTTPResponse {
    let user = this.session(headers).user;
    let found: any[] = [];
    let notFound: any[] = [];
    for (let id of (json?.qualified_ids ?? []) as any[]) {
      let conversation = this.conversations.get(id.id);
      if (conversation?.members.has(user.id)) {
        found.push(this.conversationJSON(conversation, user));
      } else {
        notFound.push(id);
      }
    }
    return jsonResponse(200, { found, not_found: notFound, failed: [] });
  }

  /** Appendix B rule 1: an MLS conversation is created empty. The backend does
   * not know the MLS membership; it learns it from the commit. */
  protected createConversation(headers: Record<string, string>, json: any): FakeHTTPResponse {
    let user = this.session(headers).user;
    let protocol = json?.protocol ?? "proteus";
    let invited = (json?.qualified_users ?? []) as any[];
    if (protocol == "mls" && invited.length) {
      throw new FakeHTTPError(400, "non-empty-member-list",
        "An MLS conversation must be created with an empty member list");
    }
    let conversation = this.newConversation({
      type: 0, protocol: protocol, creator: user.id, name: json?.name,
      members: [user.id, ...invited.map(each => each.id)],
    });
    if (protocol == "mls") {
      // Opaque bytes that only the backend mints, never text
      conversation.groupID = base64Encode(concat(randomBytes(16),
        new TextEncoder().encode(this.domain)));
    }
    this.deliver(this.event("conversation.create", conversation, user,
      this.conversationJSON(conversation, user)), this.clientsOf([...conversation.members]));
    return jsonResponse(201, this.conversationJSON(conversation, user));
  }

  /** §11: the MLS 1:1, conjured on demand. Both backends derive the same
   * conversation from the 2 user IDs, so both sides find the same one, and
   * `public_keys` is that of the backend owning it. */
  protected mlsOneToOne(headers: Record<string, string>, peerID: string): FakeHTTPResponse {
    let user = this.session(headers).user;
    let peer = this.user(peerID);
    let key = [user.id, peer.id].sort().join(":");
    let conversation = this.oneToOnes.get(key);
    if (!conversation) {
      conversation = this.newConversation({
        type: 2, protocol: "mls", creator: user.id, members: [user.id, peer.id],
      });
      conversation.groupID = base64Encode(concat(randomBytes(16),
        new TextEncoder().encode(this.domain)));
      this.oneToOnes.set(key, conversation);
    }
    return jsonResponse(200, {
      conversation: this.conversationJSON(conversation, user),
      public_keys: { removal: { ed25519: base64Encode(this.removalKeyPair.publicKey) } },
    });
  }

  protected removeMember(headers: Record<string, string>, conversationID: string,
    userID: string): FakeHTTPResponse {
    let user = this.session(headers).user;
    let conversation = this.conversation(conversationID);
    if (!conversation.members.delete(userID)) {
      return jsonResponse(200, null);
    }
    let event = this.event("conversation.member-leave", conversation, user, {
      qualified_user_ids: [{ id: userID, domain: this.domain }],
      user_ids: [userID],
      reason: "removed",
    });
    this.deliver(event, this.clientsOf([...conversation.members, userID]));
    return jsonResponse(200, event);
  }

  protected groupInfo(headers: Record<string, string>, conversationID: string): FakeHTTPResponse {
    let conversation = this.conversation(conversationID);
    this.memberSession(headers, conversation);
    if (!conversation.groupInfo) {
      throw new FakeHTTPError(404, "mls-missing-group-info", "The group has never been committed to");
    }
    return binaryResponse(conversation.groupInfo, "message/mls");
  }

  ///////////////////////////////////////////////////////////
  // MLS

  /** §4.1 rules 5 to 9, and Appendix B rule 6: the signature key must be
   * registered on the device before the first key package, the credential must
   * name that very device, and the leaf must advertise its own credential type. */
  protected uploadKeyPackages(headers: Record<string, string>, clientID: string,
    json: any): FakeHTTPResponse {
    let client = this.ourClient(headers, clientID);
    let registered = client.mlsPublicKeys.ed25519;
    if (!registered) {
      throw new FakeHTTPError(400, "mls-protocol-error",
        "No key associated to the given identity and signature scheme");
    }
    let keyPackages: FakeKeyPackage[] = [];
    for (let each of (json?.key_packages ?? []) as string[]) {
      let bytes = base64Decode(each);
      let keyPackage = KeyPackage.fromBytes(bytes);
      let leaf = keyPackage.leafNode;
      if (!keyPackage.verify()) {
        throw new FakeHTTPError(400, "mls-protocol-error", "The key package does not verify");
      }
      if (!bytesEqual(leaf.signatureKey, base64Decode(registered))) {
        throw new FakeHTTPError(400, "mls-protocol-error", "Unrecognised signature key");
      }
      if (leaf.source != LeafNodeSource.KeyPackage || !leaf.lifetime) {
        throw new FakeHTTPError(400, "mls-protocol-error",
          "A key package leaf needs the source key_package and a lifetime");
      }
      if (!leaf.capabilities.credentials.includes(leaf.credential.type)) {
        throw new FakeHTTPError(400, "mls-protocol-error", "BasicCredentialCapabilityMissing");
      }
      if (identityOfLeaf(leaf) != this.mlsIdentity(client)) {
        throw new FakeHTTPError(400, "mls-identity-mismatch",
          `The credential says ${identityOfLeaf(leaf)}, the device is ${this.mlsIdentity(client)}`);
      }
      keyPackages.push({ bytes, ref: keyPackage.ref(), client });
    }
    client.keyPackages.push(...keyPackages);
    return jsonResponse(201, null);
  }

  /** §4.4: one key package per device of that user, consumed atomically. The
   * requesting device is left out, which is how a client adds its own others. */
  protected claimKeyPackages(headers: Record<string, string>, domain: string,
    userID: string): FakeHTTPResponse {
    let session = this.session(headers);
    let user = this.users.get(userID);
    let claimed: any[] = [];
    for (let client of user?.clients.values() ?? []) {
      if (client.id == session.clientID) {
        continue;
      }
      let keyPackage = client.keyPackages.shift();
      if (!keyPackage) {
        continue; // that device has no key packages left
      }
      client.claimed.push(keyPackage.ref);
      claimed.push({
        user: user.id, domain: domain, client: client.id,
        key_package: base64Encode(keyPackage.bytes),
        key_package_ref: base64Encode(keyPackage.ref),
      });
    }
    return jsonResponse(200, { key_packages: claimed });
  }

  /** §7.2 and Appendix B rules 2, 4 and 10. The bundle is a bare concatenation
   * of `MLSMessage`s, classified by their wire format. */
  protected commitBundle(headers: Record<string, string>, body: Uint8Array): FakeHTTPResponse {
    let session = this.session(headers);
    let { commit, groupInfo, welcome, appMessage } = parseBundle(body);
    let context = groupInfo.groupInfo.groupContext;
    let conversation = this.conversationForGroup(context.groupID);
    let framed = commit.publicMessage.content;
    if (!bytesEqual(framed.groupID, context.groupID)) {
      throw new FakeHTTPError(400, "mls-protocol-error",
        "The commit and its GroupInfo disagree about the group");
    }
    if (framed.epoch != BigInt(conversation.epoch)) {
      throw new FakeHTTPError(409, "mls-stale-message",
        `The commit is for epoch ${framed.epoch}, the conversation is in ${conversation.epoch}`);
    }
    if (context.epoch != framed.epoch + 1n) {
      throw new FakeHTTPError(400, "mls-protocol-error",
        "The GroupInfo is not the epoch that this commit creates");
    }
    // §6.3: the conversation's ciphersuite comes only from here, and only once
    if (conversation.epoch == 0) {
      conversation.cipherSuite = context.suite.id;
    } else if (conversation.cipherSuite != context.suite.id) {
      throw new FakeHTTPError(400, "mls-protocol-error", "The ciphersuite of a group cannot change");
    }
    // Appendix B rule 4, and `GroupInfoCheck.hs`
    let treeExtension = Extension.find(groupInfo.groupInfo.extensions, ExtensionType.RatchetTree);
    if (!treeExtension) {
      throw new FakeHTTPError(400, "mls-protocol-error", "No ratchet tree extension found in GroupInfo");
    }
    let before = conversation.mlsClients;
    let after = this.clientsInTree(RatchetTree.fromBytes(context.suite, treeExtension.data));
    if (framed.sender.type == SenderType.Member && conversation.epoch > 0 && !before.has(session.clientID)) {
      throw new FakeHTTPError(403, "mls-protocol-error", "You are not a member of this group");
    }
    if (!after.has(session.clientID)) {
      throw new FakeHTTPError(400, "mls-self-removal-not-allowed", "A commit may not remove its own sender");
    }
    // The committer's own leaf is in the tree before the backend has ever seen
    // the group, and it is never welcomed
    let added = [...after]
      .filter(clientID => !before.has(clientID) && clientID != session.clientID);
    let welcomed = welcome ? this.welcomedClients(welcome.welcome) : [];
    // §9.3 `mls-welcome-mismatch`: the Welcome must address exactly what the
    // commit added, or the new members never learn about the group.
    if (added.slice().sort().join() != welcomed.slice().sort().join()) {
      throw new FakeHTTPError(400, "mls-welcome-mismatch",
        `The commit added [${added}] but the Welcome addresses [${welcomed}]`);
    }

    let removed = [...before].filter(clientID => !after.has(clientID));
    let membersBefore = [...conversation.members];
    conversation.epoch++;
    conversation.mlsClients = after;
    conversation.groupInfo = groupInfo.bytes;
    conversation.members = new Set([...after].map(clientID => this.clientByID(clientID).user.id));
    conversation.members.add(conversation.creator);

    // §6.3: the raw commit to everybody who is in the group before *and* after
    let staying = [...before].filter(clientID => after.has(clientID) && clientID != session.clientID);
    let commitEvent = this.event("conversation.mls-message-add", conversation, session.user,
      base64Encode(commit.bytes));
    this.deliver(commitEvent, staying);
    // The Welcome goes only to the clients that the commit added
    if (welcome) {
      this.deliver(this.event("conversation.mls-welcome", conversation, session.user,
        base64Encode(welcome.bytes)), added);
    }
    let events: any[] = [];
    let joined = [...conversation.members].filter(userID => !membersBefore.includes(userID));
    if (joined.length) {
      let event = this.event("conversation.member-join", conversation, session.user, {
        users: joined.map(userID => ({
          qualified_id: { id: userID, domain: this.domain }, conversation_role: "wire_member",
        })),
        user_ids: joined,
        add_type: "internal_add",
      });
      events.push(event);
      this.deliver(event, this.clientsOf([...conversation.members]));
    }
    let left = membersBefore.filter(userID => !conversation.members.has(userID));
    if (left.length) {
      let event = this.event("conversation.member-leave", conversation, session.user, {
        qualified_user_ids: left.map(userID => ({ id: userID, domain: this.domain })),
        user_ids: left,
        reason: "removed",
      });
      events.push(event);
      this.deliver(event, [...this.clientsOf([...conversation.members]), ...removed]);
    }
    // §7.4: the bundle's optional application message belongs to the new epoch
    if (appMessage) {
      this.deliver(this.event("conversation.mls-message-add", conversation, session.user,
        base64Encode(appMessage.bytes)), [...after].filter(clientID => clientID != session.clientID));
    }
    return jsonResponse(201, { events, time: commitEvent.time });
  }

  /** §8: one raw `MLSMessage`, forwarded to everybody else in the group. */
  protected mlsMessage(headers: Record<string, string>, body: Uint8Array): FakeHTTPResponse {
    let session = this.session(headers);
    let message = MLSMessage.fromBytes(body);
    let groupID: Uint8Array;
    let epoch: bigint;
    if (message.body instanceof PrivateMessage) {
      groupID = message.body.groupID;
      epoch = message.body.epoch;
    } else if (message.body instanceof PublicMessage) {
      if (message.body.content.contentType == ContentType.Commit) {
        throw new FakeHTTPError(400, "mls-protocol-error", "A commit must go to /mls/commit-bundles");
      }
      groupID = message.body.content.groupID;
      epoch = message.body.content.epoch;
    } else {
      throw new FakeHTTPError(400, "mls-unsupported-message",
        `Wire format ${message.wireFormat} is not a message to a group`);
    }
    let conversation = this.conversationForGroup(groupID);
    if (epoch != BigInt(conversation.epoch)) {
      throw new FakeHTTPError(409, "mls-stale-message",
        `The message is for epoch ${epoch}, the conversation is in ${conversation.epoch}`);
    }
    if (!conversation.mlsClients.has(session.clientID)) {
      throw new FakeHTTPError(403, "mls-protocol-error", "You are not a member of this group");
    }
    let event = this.event("conversation.mls-message-add", conversation, session.user,
      base64Encode(body));
    this.deliver(event, [...conversation.mlsClients].filter(clientID => clientID != session.clientID));
    return jsonResponse(201, { events: [], time: event.time });
  }

  protected conversationForGroup(groupID: Uint8Array): FakeConversation {
    let conversation = [...this.conversations.values()]
      .find(each => each.groupID && bytesEqual(base64Decode(each.groupID), groupID));
    if (!conversation) {
      throw new FakeHTTPError(404, "mls-protocol-error", "No conversation has this group ID");
    }
    return conversation;
  }

  /** Which of our devices a Welcome addresses, by the `KeyPackageRef` of the
   * key package that it consumed. */
  protected welcomedClients(welcome: any): string[] {
    let clients: string[] = [];
    for (let secret of welcome.secrets) {
      let client = this.allClients()
        .find(each => each.claimed.some(ref => bytesEqual(ref, secret.newMember)));
      if (!client) {
        throw new FakeHTTPError(400, "mls-protocol-error",
          `The Welcome addresses a key package ${base64Encode(secret.newMember)} that we never handed out`);
      }
      clients.push(client.id);
    }
    return clients;
  }

  /** The group's membership, as its own ratchet tree states it. */
  protected clientsInTree(tree: RatchetTree): Set<string> {
    let clients = new Set<string>();
    for (let leafIndex of tree.memberLeafIndices()) {
      let identity = identityOfLeaf(tree.leaf(leafIndex));
      let client = this.allClients().find(each => this.mlsIdentity(each) == identity);
      if (!client) {
        throw new FakeHTTPError(400, "mls-identity-mismatch",
          `The ratchet tree holds a leaf ${identity} that is not one of our devices`);
      }
      clients.add(client.id);
    }
    return clients;
  }

  /** §2.2, to the byte. The client ID is hex without leading zeros, because
   * that is how the backend renders the number it stores. */
  protected mlsIdentity(client: FakeClient): string {
    return `${client.user.id}:${clientIDHex(client.id)}@${this.domain}`;
  }

  ///////////////////////////////////////////////////////////
  // Proteus

  protected proteusMessage(headers: Record<string, string>, conversationID: string,
    body: Uint8Array): FakeHTTPResponse {
    let session = this.session(headers);
    let conversation = this.conversation(conversationID);
    let message = decode(QualifiedNewOtrMessage, body);
    let senderClientID = message.sender.client.toString(16);
    if (senderClientID != clientIDHex(session.clientID)) {
      throw new FakeHTTPError(403, "unknown-client", "The sender is not the device of this token");
    }
    if (!message.reportAll && !message.ignoreAll && !message.reportOnly && !message.ignoreOnly) {
      throw new FakeHTTPError(400, "bad-request", "A message must name one of the 4 mismatch strategies");
    }
    let sent = new Map<string, Uint8Array>();
    for (let byDomain of message.recipients ?? []) {
      for (let entry of byDomain.entries ?? []) {
        for (let client of entry.clients ?? []) {
          sent.set(this.clientIDOf(client.client.client), client.text);
        }
      }
    }
    // §5.4: the backend knows the true device list, and refuses the whole
    // message when the sender's is stale
    let expected = this.clientsOf([...conversation.members])
      .filter(clientID => clientID != session.clientID);
    let missing = expected.filter(clientID => !sent.has(clientID));
    let extra = [...sent.keys()].filter(clientID => !expected.includes(clientID));
    if (missing.length && message.reportAll) {
      return jsonResponse(412, {
        time: this.time(),
        missing: this.clientMap(missing),
        redundant: this.clientMap(extra),
        deleted: {},
      });
    }
    let time = this.time();
    for (let [clientID, ciphertext] of sent) {
      if (!expected.includes(clientID)) {
        continue;
      }
      let event = this.event("conversation.otr-message-add", conversation, session.user, {
        sender: senderClientID,
        recipient: clientIDHex(clientID),
        text: base64Encode(ciphertext),
        data: message.blob?.length ? base64Encode(message.blob) : undefined,
      });
      event.time = time; // one message, one timestamp, however many devices
      this.deliver(event, [clientID], message.transient);
    }
    return jsonResponse(201,
      { time, missing: {}, redundant: this.clientMap(extra), deleted: {} });
  }

  ///////////////////////////////////////////////////////////
  // Assets

  /** The hand-built `multipart/mixed` of `WireAPI.uploadAsset()`, parsed the
   * strict way cargohold parses it: 2 parts, each with its own `Content-length`. */
  protected uploadAsset(headers: Record<string, string>, body: Uint8Array,
    contentType: string): FakeHTTPResponse {
    this.session(headers);
    let boundary = /boundary=(.+)$/.exec(contentType ?? "")?.[1];
    if (!boundary) {
      throw new FakeHTTPError(400, "bad-request", "No multipart boundary");
    }
    let parts = multipart(body, boundary);
    if (parts.length != 2) {
      throw new FakeHTTPError(400, "bad-request", `The multipart body has ${parts.length} parts, not 2`);
    }
    let metadata = JSON.parse(new TextDecoder().decode(parts[0].body));
    let bytes = parts[1].body;
    let digest = /Content-MD5: (.*)/.exec(parts[1].headers)?.[1]?.trim();
    if (digest != base64Encode(md5(bytes))) {
      throw new FakeHTTPError(400, "bad-request", "Content-MD5 does not match the body");
    }
    let asset: FakeAsset = {
      key: `3-1-${crypto.randomUUID()}`,
      bytes: bytes,
      public: !!metadata.public,
      // A public asset has no token, and its secret is the AES key instead
      token: metadata.public ? null : base64Encode(randomBytes(16)),
    };
    this.assets.set(asset.key, asset);
    return jsonResponse(201, {
      key: asset.key,
      domain: this.domain,
      token: asset.token,
      expires: metadata.retention == "eternal" ? null : new Date(this.clock + 1e9).toISOString(),
    });
  }

  protected downloadAsset(headers: Record<string, string>, key: string,
    token: string | null): FakeHTTPResponse {
    this.session(headers); // cargohold wants our token even for a public asset
    let asset = this.assets.get(key);
    if (!asset) {
      throw new FakeHTTPError(404, "not-found", "No such asset");
    }
    // Sending a token for a public asset makes the real server refuse it
    if (token != asset.token) {
      throw new FakeHTTPError(404, "not-found", "Wrong asset token");
    }
    return binaryResponse(asset.bytes, "application/octet-stream");
  }

  ///////////////////////////////////////////////////////////
  // The notification stream

  protected getNotifications(headers: Record<string, string>, query: URLSearchParams): FakeHTTPResponse {
    this.session(headers);
    let clientID = query.get("client");
    let size = Number(query.get("size") ?? 1000);
    let since = query.get("since");
    let start = 0;
    if (since) {
      let index = this.notifications.findIndex(each => each.id == since);
      if (index < 0) { // the stream no longer reaches that far back
        throw new FakeHTTPError(404, "not-found", "Notifications lost");
      }
      start = index + 1;
    }
    let ours = this.notifications.slice(start)
      .filter(each => each.clientIDs.includes(clientID) && !each.transient);
    return jsonResponse(200, {
      notifications: ours.slice(0, size).map(notificationJSON),
      has_more: ours.length > size,
      time: this.time(),
    });
  }

  protected getLastNotification(headers: Record<string, string>, query: URLSearchParams): FakeHTTPResponse {
    this.session(headers);
    let clientID = query.get("client");
    let last = this.notifications
      .filter(each => each.clientIDs.includes(clientID) && !each.transient).at(-1);
    if (!last) {
      throw new FakeHTTPError(404, "not-found", "This device has no notifications");
    }
    return jsonResponse(200, notificationJSON(last));
  }

  /** Puts one event into the stream of those devices, and pushes it to the
   * ones that have a socket open. */
  deliver(event: any, clientIDs: string[], transient = false): void {
    if (!clientIDs.length) {
      return;
    }
    let notification: FakeNotification = {
      id: crypto.randomUUID(), payload: [event], clientIDs, transient,
    };
    this.notifications.push(notification);
    for (let socket of [...this.sockets]) {
      if (clientIDs.includes(socket.clientID)) {
        socket.receive(JSON.stringify({ ...notificationJSON(notification), transient }));
      }
    }
  }

  attach(socket: FakeWireSocket): void {
    if (!this.tokens.has(socket.accessToken)) {
      socket.fail("Unauthorized");
      return;
    }
    this.sockets.push(socket);
    socket.open();
  }

  detach(socket: FakeWireSocket): void {
    let index = this.sockets.indexOf(socket);
    if (index >= 0) {
      this.sockets.splice(index, 1);
    }
  }

  ///////////////////////////////////////////////////////////
  // Helpers

  protected event(type: string, conversation: FakeConversation, from: FakeUser, data: any): any {
    return {
      type: type,
      conversation: conversation.id,
      qualified_conversation: { id: conversation.id, domain: this.domain },
      from: from.id,
      qualified_from: { id: from.id, domain: this.domain },
      via: "user",
      time: this.time(),
      data: data,
    };
  }

  protected time(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  session(headers: Record<string, string>): FakeSession {
    let token = /^Bearer (.*)$/.exec(headers.Authorization ?? "")?.[1];
    let session = token ? this.tokens.get(token) : null;
    if (!session) {
      throw new FakeHTTPError(401, "invalid-credentials", "Zauth token expired");
    }
    return session;
  }

  protected memberSession(headers: Record<string, string>, conversation: FakeConversation): FakeSession {
    let session = this.session(headers);
    if (!conversation.members.has(session.user.id)) {
      throw new FakeHTTPError(403, "access-denied", "You are not in this conversation");
    }
    return session;
  }

  protected ourClient(headers: Record<string, string>, clientID: string): FakeClient {
    let client = this.session(headers).user.clients.get(clientID);
    if (!client) {
      throw new FakeHTTPError(404, "client-not-found", `No device ${clientID}`);
    }
    return client;
  }

  user(userID: string): FakeUser {
    let user = this.users.get(userID);
    if (!user) {
      throw new FakeHTTPError(404, "not-found", `No user ${userID}`);
    }
    return user;
  }

  conversation(conversationID: string): FakeConversation {
    let conversation = this.conversations.get(conversationID);
    if (!conversation) {
      throw new FakeHTTPError(404, "no-conversation", `No conversation ${conversationID}`);
    }
    return conversation;
  }

  allClients(): FakeClient[] {
    return [...this.users.values()].flatMap(user => [...user.clients.values()]);
  }

  clientByID(clientID: string): FakeClient {
    let client = this.allClients().find(each => each.id == clientID);
    if (!client) {
      throw new FakeHTTPError(404, "client-not-found", `No device ${clientID}`);
    }
    return client;
  }

  clientsOf(userIDs: string[]): string[] {
    return userIDs.flatMap(userID => [...(this.users.get(userID)?.clients.keys() ?? [])]);
  }

  /** The `uint64` of an `otr.proto` `ClientID`, back to the device it names */
  protected clientIDOf(number: bigint): string {
    let hex = number.toString(16);
    return this.allClients().find(client => clientIDHex(client.id) == hex)?.id ?? hex;
  }

  protected clientMap(clientIDs: string[]): any {
    let byUser: Record<string, string[]> = {};
    for (let clientID of clientIDs) {
      let userID = this.clientByID(clientID).user.id;
      byUser[userID] ??= [];
      byUser[userID].push(clientID);
    }
    return Object.keys(byUser).length ? { [this.domain]: byUser } : {};
  }

  protected userJSON(user: FakeUser, isSelf: boolean): any {
    let json: any = {
      id: user.id,
      qualified_id: { id: user.id, domain: this.domain },
      name: user.name,
      handle: user.name.toLowerCase(),
      accent_id: 1,
      assets: [],
      type: "regular",
      legalhold_status: "no_consent",
      supported_protocols: user.supportedProtocols,
      team: null,
    };
    if (isSelf) {
      json.email = user.email;
      json.locale = "en";
      json.status = "active";
      json.managed_by = "wire";
    }
    return json;
  }

  protected featureConfigs(user: FakeUser): any {
    return {
      mls: {
        status: user.mlsEnabled ? "enabled" : "disabled",
        lockStatus: "unlocked",
        config: {
          protocolToggleUsers: [],
          defaultProtocol: user.mlsEnabled ? "mls" : "proteus",
          allowedCipherSuites: [1],
          defaultCipherSuite: 1,
          supportedProtocols: user.mlsEnabled ? ["proteus", "mls"] : ["proteus"],
        },
      },
      consumableNotifications: { status: "disabled", lockStatus: "locked", config: null },
    };
  }

  conversationJSON(conversation: FakeConversation, forUser: FakeUser): any {
    let json: any = {
      qualified_id: { id: conversation.id, domain: this.domain },
      id: conversation.id,
      type: conversation.type,
      creator: conversation.creator,
      name: conversation.name,
      team: null,
      access: ["invite"],
      access_role: ["team_member", "non_team_member"],
      message_timer: null,
      receipt_mode: conversation.receiptMode,
      protocol: conversation.protocol,
      members: {
        self: {
          qualified_id: { id: forUser.id, domain: this.domain },
          conversation_role: conversation.admins.has(forUser.id) ? "wire_admin" : "wire_member",
          otr_archived: false,
          otr_muted_status: 0,
          hidden: false,
        },
        others: [...conversation.members].filter(userID => userID != forUser.id).map(userID => ({
          qualified_id: { id: userID, domain: this.domain },
          conversation_role: conversation.admins.has(userID) ? "wire_admin" : "wire_member",
        })),
      },
    };
    if (conversation.protocol == "mls") {
      json.group_id = conversation.groupID;
      json.epoch = conversation.epoch;
      // Appendix B rule 9: absent until the first commit gave the group one
      if (conversation.epoch > 0) {
        json.cipher_suite = conversation.cipherSuite;
        json.epoch_timestamp = new Date(this.clock).toISOString();
      }
    }
    return json;
  }
}

/** The one backend, for the `WebSocket` that the app finds on `globalThis` */
let gBackend: WireBackendFake | null = null;

/** What `WireEventStream` needs of a WebSocket. Wire authenticates the
 * handshake by query string, which is why the platform socket suffices. */
export class FakeWireSocket {
  binaryType = "arraybuffer";
  onopen: ((ev: any) => void) | null = null;
  onmessage: ((ev: { data: any }) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  readonly accessToken: string;
  readonly clientID: string;
  protected closed = false;

  constructor(url: string) {
    let query = new URL(url).searchParams;
    this.accessToken = query.get("access_token") ?? "";
    this.clientID = query.get("client") ?? "";
    // Not before the caller has attached its handlers
    setTimeout(() => gBackend?.attach(this), 0);
  }

  open(): void {
    this.onopen?.({ type: "open" });
  }

  fail(message: string): void {
    this.onerror?.({ type: "error", message });
  }

  send(data: string): void {
    if (data == "ping") {
      this.receive("pong");
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    gBackend?.detach(this);
    setTimeout(() => this.onclose?.({ code: 1000, reason: "" }), 0);
  }

  receive(text: string): void {
    if (!this.closed) {
      this.onmessage?.({ data: text });
    }
  }
}

export interface FakeUser {
  id: string;
  name: string;
  email: string;
  password: string;
  supportedProtocols: ("proteus" | "mls")[];
  mlsEnabled: boolean;
  /** The device ID that `POST /clients` will hand this user */
  nextClientID: string;
  clients: Map<string, FakeClient>;
  /** Peer user ID -> the Proteus 1:1 conversation of that contact request */
  connections: Map<string, string>;
}

export interface FakeClient {
  id: string;
  user: FakeUser;
  class: string;
  label: string;
  model: string;
  /** Signature scheme -> base64 public key, from `POST /clients` */
  mlsPublicKeys: Record<string, string>;
  prekeys: Map<number, TWirePrekey>;
  lastPrekey: TWirePrekey;
  keyPackages: FakeKeyPackage[];
  /** The refs of the key packages we handed out, so that a Welcome can be
   * traced back to the device it addresses */
  claimed: Uint8Array[];
}

export interface FakeKeyPackage {
  bytes: Uint8Array;
  ref: Uint8Array;
  client: FakeClient;
}

export interface FakeConversation {
  id: string;
  type: 0 | 1 | 2 | 3;
  name: string | null;
  protocol: "proteus" | "mls" | "mixed";
  creator: string;
  members: Set<string>;
  admins: Set<string>;
  groupID: string | null;
  epoch: number;
  cipherSuite: number | null;
  /** 0 = read receipts off, 1 = on */
  receiptMode: number;
  /** The `MLSMessage` of the newest GroupInfo, for `GET .../groupinfo` */
  groupInfo: Uint8Array | null;
  /** The devices that the ratchet tree of that GroupInfo holds */
  mlsClients: Set<string>;
}

export interface FakeAsset {
  key: string;
  bytes: Uint8Array;
  public: boolean;
  token: string | null;
}

export interface FakeSession {
  user: FakeUser;
  clientID: string | null;
}

export interface FakeHTTPResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string | string[]>;
  body: Uint8Array;
}

/** A `{code, label, message}` answer, which is how Wire says what went wrong */
export class FakeHTTPError extends Error {
  constructor(readonly status: number, readonly label: string,
    readonly serverMessage: string, readonly data: any = {}) {
    super(`${status} ${label}: ${serverMessage}`);
  }
}

export interface FakeNotification {
  id: string;
  payload: any[];
  /** The devices this notification is in the stream of */
  clientIDs: string[];
  transient: boolean;
}

interface ParsedMessage {
  bytes: Uint8Array;
  publicMessage: PublicMessage | null;
  welcome: any;
  groupInfo: any;
}

/** The bundle parser of `CommitBundle.hs`: classify by wire format, and refuse
 * anything that does not fill exactly the mandatory slots. */
function parseBundle(body: Uint8Array): {
  commit: ParsedMessage, groupInfo: ParsedMessage,
  welcome: ParsedMessage | null, appMessage: ParsedMessage | null,
} {
  let reader = new TLSReader(body);
  let commit: ParsedMessage | null = null;
  let groupInfo: ParsedMessage | null = null;
  let welcome: ParsedMessage | null = null;
  let appMessage: ParsedMessage | null = null;
  while (!reader.atEnd) {
    let message = MLSMessage.read(reader);
    let parsed: ParsedMessage = {
      bytes: message.toBytes(),
      publicMessage: message.publicMessage,
      welcome: message.welcome,
      groupInfo: message.groupInfo,
    };
    switch (message.wireFormat) {
      case WireFormat.PublicMessage:
        if (message.publicMessage.content.contentType != ContentType.Commit) {
          throw new FakeHTTPError(400, "mls-protocol-error", "Unexpected proposal in a commit bundle");
        }
        commit = onlyOnce(commit, parsed, "commit");
        break;
      case WireFormat.GroupInfo:
        groupInfo = onlyOnce(groupInfo, parsed, "group info");
        break;
      case WireFormat.Welcome:
        welcome = onlyOnce(welcome, parsed, "welcome");
        break;
      case WireFormat.PrivateMessage:
        // Appendix B rule 2: this is the slot where a commit sent as a
        // PrivateMessage silently lands, and the bundle is then rejected
        // below for a missing commit.
        appMessage = onlyOnce(appMessage, parsed, "application message");
        break;
      default:
        throw new FakeHTTPError(400, "mls-protocol-error", "Unexpected message type in a commit bundle");
    }
  }
  if (!commit) {
    throw new FakeHTTPError(400, "mls-protocol-error", "Missing commit");
  }
  if (!groupInfo) {
    throw new FakeHTTPError(400, "mls-missing-group-info", "Missing group info");
  }
  return { commit, groupInfo, welcome, appMessage };
}

function onlyOnce(existing: ParsedMessage | null, parsed: ParsedMessage, slot: string): ParsedMessage {
  if (existing) {
    throw new FakeHTTPError(400, "mls-protocol-error", `Redundant occurrence of the ${slot}`);
  }
  return parsed;
}

/** §2.2's `<user-uuid>:<client-id>@<domain>`, or null for a leaf that is not a
 * Wire client */
function identityOfLeaf(leaf: LeafNode | null): string | null {
  return leaf?.credential instanceof BasicCredential ? leaf.credential.identityString : null;
}

/** How the backend renders a device ID: the hex of the number it stores, so
 * without leading zeros. */
function clientIDHex(clientID: string): string {
  return clientID.replace(/^0+(?=.)/, "");
}

/** One prekey, consumed. The last-resort one is left for the next caller. */
function takePrekey(client: FakeClient): TWirePrekey {
  for (let [id, prekey] of client.prekeys) {
    if (id != kLastPrekeyID) {
      client.prekeys.delete(id);
      return prekey;
    }
  }
  return client.lastPrekey;
}

/** The parts of a `multipart/mixed` body, each with its own `Content-length`,
 * which is the only length cargohold's parser trusts. */
function multipart(body: Uint8Array, boundary: string): { headers: string, body: Uint8Array }[] {
  let text = latin1(body);
  let marker = `--${boundary}`;
  let parts: { headers: string, body: Uint8Array }[] = [];
  let at = text.indexOf(marker);
  if (at != 0) {
    throw new FakeHTTPError(400, "bad-request", "The body does not start with the boundary");
  }
  while (at >= 0) {
    if (text.startsWith(`${marker}--`, at)) {
      return parts;
    }
    let headerStart = at + marker.length + 2; // the CRLF after the boundary
    let headerEnd = text.indexOf("\r\n\r\n", headerStart) + 4;
    let headers = text.slice(headerStart, headerEnd);
    let length = Number(/Content-length: (\d+)/.exec(headers)?.[1]);
    if (!Number.isInteger(length)) {
      throw new FakeHTTPError(400, "bad-request", "A multipart part without a Content-length");
    }
    parts.push({ headers, body: body.subarray(headerEnd, headerEnd + length) });
    at = text.indexOf(marker, headerEnd + length);
  }
  throw new FakeHTTPError(400, "bad-request", "The multipart body is not terminated");
}

/** Bytes as characters, so that the offsets of a body and of its text form are
 * the same */
function latin1(bytes: Uint8Array): string {
  let text = "";
  for (let byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return text;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  let result = new Uint8Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
}

function jsonResponse(status: number, json: any, headers: Record<string, any> = {}): FakeHTTPResponse {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    statusText: "",
    headers: { "content-type": "application/json", ...headers },
    body: json === null ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(json)),
  };
}

function binaryResponse(bytes: Uint8Array, contentType: string): FakeHTTPResponse {
  return {
    ok: true, status: 200, statusText: "OK",
    headers: { "content-type": contentType },
    body: bytes,
  };
}

function notificationJSON(notification: FakeNotification): any {
  return { id: notification.id, payload: notification.payload };
}

function clientJSON(client: FakeClient): any {
  return {
    id: client.id,
    type: "permanent",
    time: new Date(0).toISOString(),
    class: client.class,
    label: client.label,
    model: client.model,
    mls_public_keys: client.mlsPublicKeys,
  };
}

/** The last-resort prekey, which the backend hands out for ever */
const kLastPrekeyID = 0xFFFF;
