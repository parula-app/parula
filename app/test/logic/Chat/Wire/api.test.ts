import { WireAPI } from "../../../../logic/Chat/Wire/WireAPI";
import type { TWireQualifiedID } from "../../../../logic/Chat/Wire/TWire";
import { beforeEach, describe, expect, test } from "vitest";

/** Records every call and answers with canned JSON, in order.
 * Stands in for `WireTransport`, which `WireAPI` only imports as a type. */
class FakeTransport {
  baseURL = "https://prod-nginz-https.wire.com";
  version = 5;
  calls: any[] = [];
  responses: any[] = [];

  /** Queue the answers to the next calls, in order */
  reply(...responses: any[]) {
    this.responses.push(...responses);
  }

  protected record(call: any): any {
    this.calls.push(call);
    let response = this.responses.shift();
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }

  async get(path: string, options?: any) {
    return this.record({ method: "GET", path, options });
  }
  async post(path: string, json: any, options?: any) {
    return this.record({ method: "POST", path, json, options });
  }
  async put(path: string, json: any, options?: any) {
    return this.record({ method: "PUT", path, json, options });
  }
  async delete(path: string, json?: any, options?: any) {
    return this.record({ method: "DELETE", path, json, options });
  }
  async postBinary(path: string, body: Uint8Array, contentType: string, options?: any) {
    return this.record({ method: "POST", path, body, contentType, options });
  }
  async getBinary(path: string, options?: any) {
    return this.record({ method: "GET", path, options });
  }
}

/** What `WireTransport` throws for a `{code, label, message}` error body */
class FakeWireError extends Error {
  httpCode: number;
  label: string;
  data: any;
  constructor(httpCode: number, label: string, data: any = null) {
    super(label);
    this.httpCode = httpCode;
    this.label = label;
    this.data = data;
  }
}

const kMe = { id: "d5a39ffb-6ce3-4cc8-9048-0e15d031b4c5", domain: "wire.com" };
const kPeer = { id: "7025598b-ffac-4993-8a81-af3f35b7147f", domain: "other.example" };
const kConversation = { id: "537992e5-3782-4b6c-8718-a5db2cb786ee", domain: "wire.com" };

let transport: FakeTransport;
let api: WireAPI;

beforeEach(() => {
  transport = new FakeTransport();
  api = new WireAPI(transport as any);
});

function userJSON(id: string, domain: string, name: string): any {
  return {
    qualified_id: { id, domain },
    id: id,
    name: name,
    handle: "johndoe",
    accent_id: 1,
    assets: [
      { key: "3-1-47de4580-ae51-4650-acbb-d10c028cb0ac", size: "preview", type: "image", domain: domain },
      { key: "3-1-0d095659-68b7-477e-a7d2-7cecd876617f", size: "complete", type: "image", domain: domain },
    ],
    picture: [],
    legalhold_status: "no_consent",
    supported_protocols: ["proteus", "mls"],
    searchable: true,
    type: "regular",
  };
}

function conversationJSON(id: string, domain: string): any {
  return {
    qualified_id: { id, domain },
    id: id,
    type: 0,
    creator: kMe.id,
    name: "Very funny conversation about foo bar",
    team: "537992e5-3782-4b6c-8718-a5db2cc786ee",
    access: ["invite", "code"],
    access_role: ["team_member", "non_team_member", "guest", "service"],
    group_conv_type: "group_conversation",
    add_permission: null,
    cells_state: "disabled",
    message_timer: null,
    receipt_mode: 1,
    last_event: "0.0",
    last_event_time: "1970-01-01T00:00:00.000Z",
    protocol: "proteus",
    members: {
      self: {
        qualified_id: kMe,
        conversation_role: "wire_admin",
        hidden: false,
        hidden_ref: null,
        otr_archived: false,
        otr_archived_ref: null,
        otr_muted_status: 0,
        otr_muted_ref: "2015-01-13T10:41:55.032Z",
        service: null,
        status: 0,
      },
      others: [
        { qualified_id: kPeer, conversation_role: "wire_member", status: 0 },
      ],
    },
  };
}

function manyIDs(count: number): TWireQualifiedID[] {
  let ids: TWireQualifiedID[] = [];
  for (let i = 0; i < count; i++) {
    ids.push({ id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`, domain: "wire.com" });
  }
  return ids;
}

describe("Self and users", () => {
  test("getSelf sanitizes and keeps the qualified ID", async () => {
    transport.reply({
      ...userJSON(kMe.id, kMe.domain, "John Doe"),
      email: "jd@wire.com",
      locale: "en",
      status: "active",
      managed_by: "wire",
      team: "537992e5-3782-4b6c-8718-a5db2cc786ee",
    });
    let self = await api.getSelf();
    expect(transport.calls[0].method).toBe("GET");
    expect(transport.calls[0].path).toBe("/self");
    expect(self.qualified_id).toEqual(kMe);
    expect(self.name).toBe("John Doe");
    expect(self.email).toBe("jd@wire.com");
    expect(self.supported_protocols).toEqual(["proteus", "mls"]);
    expect(self.assets[0].key).toBe("3-1-47de4580-ae51-4650-acbb-d10c028cb0ac");
    expect(self.managed_by).toBe("wire");
  });

  test("supported_protocols defaults to proteus", async () => {
    transport.reply({ ...userJSON(kPeer.id, kPeer.domain, "Jane Roe"), supported_protocols: [] });
    let user = await api.getUser(kPeer);
    expect(transport.calls[0].path).toBe("/users/other.example/7025598b-ffac-4993-8a81-af3f35b7147f");
    expect(user.supported_protocols).toEqual(["proteus"]);
  });

  test("updateSelf sends only what it was given", async () => {
    transport.reply(null);
    await api.updateSelf({ name: "John Doe", picture: [] });
    expect(transport.calls[0]).toMatchObject({
      method: "PUT",
      path: "/self",
      json: { name: "John Doe", picture: [] },
    });
  });

  test("listUsers chunks at 100 and merges the federation buckets", async () => {
    let userIDs = manyIDs(250);
    transport.reply(
      { found: [userJSON(userIDs[0].id, "wire.com", "One")], failed: [kPeer] },
      { found: [userJSON(userIDs[100].id, "wire.com", "Two")] },
      { found: [userJSON(userIDs[200].id, "wire.com", "Three")], not_found: [kMe] });

    let result = await api.listUsers(userIDs);
    expect(transport.calls).toHaveLength(3);
    expect(transport.calls.map(call => call.json.qualified_ids.length)).toEqual([100, 100, 50]);
    expect(transport.calls[0].path).toBe("/list-users");
    expect(transport.calls[1].json.qualified_ids[0]).toEqual(userIDs[100]);
    expect(result.found.map(user => user.name)).toEqual(["One", "Two", "Three"]);
    expect(result.failed).toEqual([kPeer]);
    expect(result.notFound).toEqual([kMe]);
  });

  test("listUsersByHandle chunks at 4", async () => {
    transport.reply({ found: [] }, { found: [] });
    await api.listUsersByHandle([1, 2, 3, 4, 5].map(i =>
      ({ handle: "user" + i, domain: "wire.com" })));
    expect(transport.calls.map(call => call.json.qualified_handles.length)).toEqual([4, 1]);
  });

  test("listUserClients merges the map across chunks", async () => {
    transport.reply(
      { qualified_user_map: { "wire.com": { [kMe.id]: [{ id: "93fa36b916a91118", class: "desktop" }] } } },
      { qualified_user_map: { "wire.com": { [kPeer.id]: [{ id: "2b22b7c59aab5f8" }] } } });
    let clients = await api.listUserClients([...manyIDs(500), kPeer]);
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[0].path).toBe("/users/list-clients");
    expect(transport.calls.map(call => call.json.qualified_users.length)).toEqual([500, 1]);
    expect(clients["wire.com"][kMe.id][0].class).toBe("desktop");
    expect(clients["wire.com"][kPeer.id][0].id).toBe("2b22b7c59aab5f8");
    expect(clients["wire.com"][kPeer.id][0].class).toBe(null); // unknown device class
  });

  test("getSupportedProtocols reads the bare array", async () => {
    transport.reply(["mls"]);
    expect(await api.getSupportedProtocols(kPeer)).toEqual(["mls"]);
    expect(transport.calls[0].path)
      .toBe("/users/other.example/7025598b-ffac-4993-8a81-af3f35b7147f/supported-protocols");
  });

  test("setSupportedProtocols", async () => {
    transport.reply(null);
    await api.setSupportedProtocols(["proteus", "mls"]);
    expect(transport.calls[0]).toMatchObject({
      method: "PUT",
      path: "/self/supported-protocols",
      json: { supported_protocols: ["proteus", "mls"] },
    });
  });

  test("searchContacts passes the query, domain and size", async () => {
    transport.reply({
      found: 1, returned: 1, took: 12, search_policy: "full_search",
      documents: [{
        qualified_id: { domain: "example.com", id: "00000018-0000-0020-0000-000e00000002" },
        id: "00000018-0000-0020-0000-000e00000002",
        name: "Foobar", handle: "foobar1", accent_id: 1,
        team: "00000018-0000-0020-0000-000e00000002", type: "regular",
      }],
    });
    let result = await api.searchContacts("foo", "example.com", 30);
    expect(transport.calls[0].path).toBe("/search/contacts");
    expect(transport.calls[0].options.query).toEqual({ q: "foo", size: 30, domain: "example.com" });
    expect(result.found).toBe(1);
    expect(result.search_policy).toBe("full_search");
    expect(result.documents[0].name).toBe("Foobar");
  });
});

describe("Connections", () => {
  function connectionJSON(status: string): any {
    return {
      from: kMe.id,
      to: kPeer.id,
      qualified_to: kPeer,
      status: status,
      last_update: "2026-06-15T09:00:00.000Z",
      qualified_conversation: kConversation,
      conversation: kConversation.id,
    };
  }

  test("listConnections pages until has_more is false", async () => {
    transport.reply(
      { connections: [connectionJSON("accepted")], has_more: true, paging_state: "AQIDBAUGBwg=" },
      { connections: [connectionJSON("pending")], has_more: false, paging_state: "AgIDBAUGBwg=" });

    let connections = await api.listConnections();
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[0]).toMatchObject({
      method: "POST", path: "/list-connections", json: { size: 500 },
    });
    expect(transport.calls[0].json.paging_state).toBeUndefined();
    expect(transport.calls[1].json.paging_state).toBe("AQIDBAUGBwg=");
    expect(connections.map(connection => connection.status)).toEqual(["accepted", "pending"]);
    expect(connections[0].qualified_conversation).toEqual(kConversation);
  });

  test("listConnections stops when the server sends has_more without a paging state", async () => {
    transport.reply({ connections: [connectionJSON("sent")], has_more: true });
    expect(await api.listConnections()).toHaveLength(1);
    expect(transport.calls).toHaveLength(1);
  });

  test("createConnection has no body", async () => {
    transport.reply(connectionJSON("sent"));
    let connection = await api.createConnection(kPeer);
    expect(transport.calls[0]).toMatchObject({
      method: "POST",
      path: "/connections/other.example/7025598b-ffac-4993-8a81-af3f35b7147f",
      json: null,
    });
    expect(connection.status).toBe("sent");
  });

  test("updateConnection maps the empty 204 to null", async () => {
    transport.reply(null);
    expect(await api.updateConnection(kPeer, "accepted")).toBe(null);
    expect(transport.calls[0]).toMatchObject({
      method: "PUT",
      path: "/connections/other.example/7025598b-ffac-4993-8a81-af3f35b7147f",
      json: { status: "accepted" },
    });
  });

  test("getConnection maps 404 to null", async () => {
    transport.reply(new FakeWireError(404, "not-found"));
    expect(await api.getConnection(kPeer)).toBe(null);
  });
});

describe("Teams", () => {
  test("getTeam", async () => {
    transport.reply({
      id: "537992e5-3782-4b6c-8718-a5db2cc786ee",
      creator: kMe.id,
      name: "Acme Inc.",
      icon: "3-1-47de4580-ae51-4650-acbb-d10c028cb0ac",
      splash_screen: "default",
      binding: true,
    });
    let team = await api.getTeam("537992e5-3782-4b6c-8718-a5db2cc786ee");
    expect(transport.calls[0].path).toBe("/teams/537992e5-3782-4b6c-8718-a5db2cc786ee");
    expect(team.name).toBe("Acme Inc.");
    expect(team.icon).toBe("3-1-47de4580-ae51-4650-acbb-d10c028cb0ac");
  });

  test("listTeamMembers pages in camelCase", async () => {
    transport.reply(
      {
        hasMore: true, pagingState: "AQ==", members: [{
          user: "00000000-0000-0000-0000-000000000001",
          created_at: "1864-05-09T06:07:36.175Z",
          created_by: "00000001-0000-0001-0000-000100000000",
          legalhold_status: "pending",
          permissions: { copy: 0, self: 8191 },
        }],
      },
      {
        hasMore: false, pagingState: "Ag==", members: [{
          user: "00000000-0000-0001-0000-000100000001",
          created_at: null, created_by: null, legalhold_status: "pending",
        }],
      });

    let members = await api.listTeamMembers("team-1");
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[0].method).toBe("GET");
    expect(transport.calls[0].path).toBe("/teams/team-1/members");
    expect(transport.calls[0].options.query).toEqual({ maxResults: 2000 });
    expect(transport.calls[1].options.query).toEqual({ maxResults: 2000, pagingState: "AQ==" });
    expect(members).toHaveLength(2);
    expect(members[0].permissions.self).toBe(8191);
    expect(members[1].permissions).toBe(null); // omitted without GetMemberPermissions
    expect(members[1].created_by).toBe(null);
  });

  test("getFeatureConfigs keeps unknown features and their config", async () => {
    transport.reply({
      mls: {
        status: "enabled", lockStatus: "unlocked",
        config: {
          protocolToggleUsers: [], defaultProtocol: "proteus",
          allowedCipherSuites: [1], defaultCipherSuite: 1,
          supportedProtocols: ["proteus", "mls"],
        },
      },
      fileSharing: { status: "disabled" },
      somethingNew: { status: "enabled", ttl: "unlimited" },
    });
    let features = await api.getFeatureConfigs();
    expect(transport.calls[0].path).toBe("/feature-configs");
    expect(features.mls.status).toBe("enabled");
    expect(features.mls.config.defaultProtocol).toBe("proteus");
    expect(features.fileSharing.status).toBe("disabled");
    expect(features.somethingNew.ttl).toBe("unlimited");
  });
});

describe("Conversations", () => {
  test("listAllConversations pages the IDs, chunks the fetch and keeps all 3 buckets", async () => {
    let conversationIDs = manyIDs(600);
    transport.reply(
      { qualified_conversations: conversationIDs.slice(0, 500), has_more: true, paging_state: "AQ==" },
      { qualified_conversations: conversationIDs.slice(500), has_more: false, paging_state: "Ag==" },
      {
        found: [conversationJSON(kConversation.id, kConversation.domain)],
        not_found: [kPeer], failed: [],
      },
      { found: [], not_found: [], failed: [kPeer] });

    let result = await api.listAllConversations();
    expect(transport.calls.map(call => call.path)).toEqual([
      "/conversations/list-ids", "/conversations/list-ids",
      "/conversations/list", "/conversations/list"]);
    expect(transport.calls[0].json).toEqual({ size: 1000 });
    expect(transport.calls[1].json).toEqual({ size: 1000, paging_state: "AQ==" });
    expect(transport.calls[2].json.qualified_ids).toHaveLength(500);
    expect(transport.calls[3].json.qualified_ids).toHaveLength(100);
    expect(result.found).toHaveLength(1);
    expect(result.found[0].qualified_id).toEqual(kConversation);
    expect(result.found[0].members.others[0].qualified_id).toEqual(kPeer);
    expect(result.found[0].members.self.conversation_role).toBe("wire_admin");
    expect(result.notFound).toEqual([kPeer]);
    expect(result.failed).toEqual([kPeer]);
  });

  test("getConversation uses the qualified path", async () => {
    transport.reply(conversationJSON(kConversation.id, kConversation.domain));
    let conversation = await api.getConversation(kConversation);
    expect(transport.calls[0].path).toBe("/conversations/wire.com/537992e5-3782-4b6c-8718-a5db2cb786ee");
    expect(conversation.receipt_mode).toBe(1);
    expect(conversation.protocol).toBe("proteus");
  });

  test("createMLSConversation forces an empty member list and reports failed_to_add", async () => {
    transport.reply({
      ...conversationJSON("b2a35ba2-4f4d-4f65-a3ee-c0c1f2ec3fef", "wire.com"),
      protocol: "mls",
      group_id: "AAEAAbKjW6JPTU9lo+7AwfLsP+8AAAAAAAAAAHdpcmUuY29t",
      epoch: 0,
      members: { self: { qualified_id: kMe, conversation_role: "wire_admin" }, others: [] },
      failed_to_add: [kPeer],
    });
    let conversation = await api.createMLSConversation({
      name: "MLS team room",
      qualified_users: [kPeer], // must not reach the server
      team: { teamid: "537992e5-3782-4b6c-8718-a5db2cc786ee", managed: false },
    });
    expect(transport.calls[0]).toMatchObject({ method: "POST", path: "/conversations" });
    expect(transport.calls[0].json.protocol).toBe("mls");
    expect(transport.calls[0].json.qualified_users).toEqual([]);
    expect(conversation.group_id).toBe("AAEAAbKjW6JPTU9lo+7AwfLsP+8AAAAAAAAAAHdpcmUuY29t");
    expect(conversation.epoch).toBe(0);
    expect(conversation.failed_to_add).toEqual([kPeer]);
  });

  test("getMLSOneToOne returns the conversation and the owning backend's removal keys", async () => {
    transport.reply({
      conversation: {
        ...conversationJSON("45c8f986-6c8f-465b-9ac9-bd5405e8c944", "wire.com"),
        protocol: "mls", group_id: "AAEAAQ==", epoch: 0,
      },
      public_keys: { removal: { ed25519: "MTIzNDU2Nzg5MA==" } },
    });
    let oneToOne = await api.getMLSOneToOne(kPeer);
    expect(transport.calls[0].path)
      .toBe("/one2one-conversations/other.example/7025598b-ffac-4993-8a81-af3f35b7147f");
    expect(oneToOne.conversation.protocol).toBe("mls");
    expect(oneToOne.public_keys.removal.ed25519).toBe("MTIzNDU2Nzg5MA==");
  });

  test("getMLSSelfConversation", async () => {
    transport.reply({
      ...conversationJSON("3eac2a2c-3850-510b-bd08-8a98e80dd4d9", "wire.com"),
      type: 1, protocol: "mls", group_id: "AAEAAQ==", epoch: 3,
    });
    let conversation = await api.getMLSSelfConversation();
    expect(transport.calls[0].path).toBe("/conversations/mls-self");
    expect(conversation.type).toBe(1);
    expect(conversation.epoch).toBe(3);
  });

  test("addMembers, removeMember and updateMemberRole use the qualified paths", async () => {
    transport.reply({ type: "conversation.member-join" }, null, null);
    let event = await api.addMembers(kConversation, [kPeer]);
    expect(transport.calls[0]).toMatchObject({
      method: "POST",
      path: "/conversations/wire.com/537992e5-3782-4b6c-8718-a5db2cb786ee/members",
      json: { qualified_users: [kPeer], conversation_role: "wire_member" },
    });
    expect(event.type).toBe("conversation.member-join");

    expect(await api.removeMember(kConversation, kPeer)).toBe(null); // 204, nothing changed
    expect(transport.calls[1]).toMatchObject({
      method: "DELETE",
      path: "/conversations/wire.com/537992e5-3782-4b6c-8718-a5db2cb786ee" +
        "/members/other.example/7025598b-ffac-4993-8a81-af3f35b7147f",
    });

    await api.updateMemberRole(kConversation, kPeer, "wire_admin");
    expect(transport.calls[2]).toMatchObject({
      method: "PUT",
      path: "/conversations/wire.com/537992e5-3782-4b6c-8718-a5db2cb786ee" +
        "/members/other.example/7025598b-ffac-4993-8a81-af3f35b7147f",
      json: { conversation_role: "wire_admin" },
    });
  });

  test("updateSelfMember mutes, and refuses an empty update", async () => {
    transport.reply(null);
    await api.updateSelfMember(kConversation, {
      otr_muted_status: 3, otr_muted_ref: "2026-06-15T09:00:00.000Z",
    });
    expect(transport.calls[0]).toMatchObject({
      method: "PUT",
      path: "/conversations/wire.com/537992e5-3782-4b6c-8718-a5db2cb786ee/self",
      json: { otr_muted_status: 3, otr_muted_ref: "2026-06-15T09:00:00.000Z" },
    });
    await expect(api.updateSelfMember(kConversation, {})).rejects.toThrow();
  });

  test("rename, message timer and receipt mode", async () => {
    transport.reply({ type: "conversation.rename" }, null, null);
    await api.renameConversation(kConversation, "New name");
    expect(transport.calls[0]).toMatchObject({
      method: "PUT",
      path: "/conversations/wire.com/537992e5-3782-4b6c-8718-a5db2cb786ee/name",
      json: { name: "New name" },
    });
    await api.setMessageTimer(kConversation, null);
    expect(transport.calls[1]).toMatchObject({
      path: "/conversations/wire.com/537992e5-3782-4b6c-8718-a5db2cb786ee/message-timer",
      json: { message_timer: null },
    });
    await api.setReceiptMode(kConversation, 1);
    expect(transport.calls[2]).toMatchObject({
      path: "/conversations/wire.com/537992e5-3782-4b6c-8718-a5db2cb786ee/receipt-mode",
      json: { receipt_mode: 1 },
    });
  });

  test("guest links use the unqualified conversation ID", async () => {
    let code = {
      key: "T-Wgpo3-e7XgOwsLqWY6",
      code: "l9Kzo0-Kn2Zx0Egs5S3f",
      uri: "https://account.wire.com/conversation-join/?key=T-Wgpo3-e7XgOwsLqWY6&code=l9Kzo0-Kn2Zx0Egs5S3f",
      has_password: false,
    };
    transport.reply({ type: "conversation.code-update", data: code }, code, null,
      { id: kConversation.id, name: "Design team", has_password: true },
      { type: "conversation.member-join" });

    let created = await api.createGuestLink(kConversation);
    expect(transport.calls[0]).toMatchObject({
      method: "POST",
      path: "/conversations/537992e5-3782-4b6c-8718-a5db2cb786ee/code",
      json: {},
    });
    expect(created.code).toBe("l9Kzo0-Kn2Zx0Egs5S3f"); // unwrapped from the event

    expect((await api.getGuestLink(kConversation)).key).toBe("T-Wgpo3-e7XgOwsLqWY6");
    expect(transport.calls[1].method).toBe("GET");

    await api.revokeGuestLink(kConversation);
    expect(transport.calls[2].method).toBe("DELETE");

    let preview = await api.getGuestLinkPreview(code.key, code.code);
    expect(transport.calls[3].path).toBe("/conversations/join");
    expect(transport.calls[3].options.query).toEqual({ key: code.key, code: code.code });
    expect(preview.has_password).toBe(true);

    await api.joinByGuestLink(code.key, code.code, "hunter22");
    expect(transport.calls[4]).toMatchObject({
      method: "POST", path: "/conversations/join",
      json: { key: code.key, code: code.code, password: "hunter22" },
    });
  });

  test("getConversationRoles has no domain in the path", async () => {
    transport.reply({
      conversation_roles: [
        { conversation_role: "wire_admin", actions: ["add_conversation_member", "leave_conversation"] },
        { conversation_role: "wire_member", actions: ["leave_conversation"] },
      ],
    });
    let roles = await api.getConversationRoles(kConversation);
    expect(transport.calls[0].path).toBe("/conversations/537992e5-3782-4b6c-8718-a5db2cb786ee/roles");
    expect(roles.map(role => role.conversation_role)).toEqual(["wire_admin", "wire_member"]);
    expect(roles[0].actions).toContain("add_conversation_member");
  });
});

describe("MLS", () => {
  test("getMLSPublicKeys keeps the base64 byte-exact", async () => {
    let key = "abc+/DEF12345678901234567890123456789012345=";
    transport.reply({ removal: { ed25519: key, ecdsa_secp256r1_sha256: "BBBB" } });
    let keys = await api.getMLSPublicKeys();
    expect(transport.calls[0].path).toBe("/mls/public-keys");
    expect(keys.removal.ed25519).toBe(key);
    expect(keys.removal.ecdsa_secp256r1_sha256).toBe("BBBB");
  });

  test("uploadKeyPackages and countKeyPackages", async () => {
    transport.reply(null, { count: 42 });
    await api.uploadKeyPackages("deadbeef", ["AAEC", "AwQF"]);
    expect(transport.calls[0]).toMatchObject({
      method: "POST",
      path: "/mls/key-packages/self/deadbeef",
      json: { key_packages: ["AAEC", "AwQF"] },
    });

    expect(await api.countKeyPackages("deadbeef", 1)).toBe(42);
    expect(transport.calls[1].path).toBe("/mls/key-packages/self/deadbeef/count");
    expect(transport.calls[1].options.query).toEqual({ ciphersuite: "0x0001" });
  });

  test("replaceKeyPackages takes a ciphersuite list", async () => {
    transport.reply(null);
    await api.replaceKeyPackages("deadbeef", ["AAEC"], [1, 2]);
    expect(transport.calls[0].method).toBe("PUT");
    expect(transport.calls[0].options.query).toEqual({ ciphersuites: "0x0001,0x0002" });
  });

  test("claimKeyPackages flattens user and domain, and keeps the base64", async () => {
    transport.reply({
      key_packages: [{
        user: kPeer.id, domain: kPeer.domain, client: "93fa36b916a91118",
        key_package: "AAEAAQ+/abc=", key_package_ref: "3q2+7w==",
      }],
    });
    let keyPackages = await api.claimKeyPackages(kPeer, 1);
    expect(transport.calls[0]).toMatchObject({
      method: "POST",
      path: "/mls/key-packages/claim/other.example/7025598b-ffac-4993-8a81-af3f35b7147f",
      json: null,
    });
    expect(transport.calls[0].options.query).toEqual({ ciphersuite: "0x0001" });
    expect(keyPackages[0].key_package).toBe("AAEAAQ+/abc=");
    expect(keyPackages[0].key_package_ref).toBe("3q2+7w==");
    expect(keyPackages[0].client).toBe("93fa36b916a91118");
  });

  test("deleteKeyPackages sends the refs as the body", async () => {
    transport.reply(null);
    await api.deleteKeyPackages("deadbeef", ["3q2+7w=="], 2);
    expect(transport.calls[0]).toMatchObject({
      method: "DELETE",
      path: "/mls/key-packages/self/deadbeef",
      json: { key_packages: ["3q2+7w=="] },
    });
    expect(transport.calls[0].options.query).toEqual({ ciphersuite: "0x0002" });
  });

  test("sendCommitBundle posts the raw bytes as message/mls", async () => {
    transport.reply({
      events: [{ type: "conversation.mls-message-add" }],
      time: "2026-01-02T03:04:05.678Z",
      failed_to_send: [kPeer],
    });
    let bundle = new Uint8Array([0, 1, 0, 1, 0xAA, 0, 1, 0, 4, 0xBB]);
    let status = await api.sendCommitBundle(bundle);
    expect(transport.calls[0]).toMatchObject({
      method: "POST", path: "/mls/commit-bundles", contentType: "message/mls",
    });
    expect(transport.calls[0].body).toBe(bundle); // byte-exact, not re-encoded
    expect(status.events[0].type).toBe("conversation.mls-message-add");
    expect(status.failed_to_send).toEqual([kPeer]);
    expect(status.failed).toEqual([]);
  });

  test("sendMLSMessage posts one message as message/mls", async () => {
    transport.reply({ events: [], time: "2026-01-02T03:04:05.678Z" });
    let message = new Uint8Array([0, 1, 0, 2, 0x42]);
    await api.sendMLSMessage(message);
    expect(transport.calls[0]).toMatchObject({
      method: "POST", path: "/mls/messages", contentType: "message/mls", body: message,
    });
  });

  test("getGroupInfo returns the bytes", async () => {
    let groupInfo = new Uint8Array([0, 1, 0, 4, 0x99]);
    transport.reply(groupInfo);
    expect(await api.getGroupInfo(kConversation)).toBe(groupInfo);
    expect(transport.calls[0].path)
      .toBe("/conversations/wire.com/537992e5-3782-4b6c-8718-a5db2cb786ee/groupinfo");
  });

  test("subconversations default to `conference`", async () => {
    transport.reply({
      parent_qualified_id: kConversation,
      subconv_id: "conference",
      group_id: "AAEAAQ==",
      epoch: 7,
      epoch_timestamp: "2026-06-15T09:00:00.000Z",
      cipher_suite: 1,
      members: [{ user_id: kMe.id, domain: kMe.domain, client_id: "93fa36b916a91118" }],
    }, new Uint8Array([1]), null, null);

    let subconversation = await api.getSubconversation(kConversation);
    let base = "/conversations/wire.com/537992e5-3782-4b6c-8718-a5db2cb786ee/subconversations/conference";
    expect(transport.calls[0].path).toBe(base);
    expect(subconversation.epoch).toBe(7);
    expect(subconversation.members[0].client_id).toBe("93fa36b916a91118");

    await api.getSubconversationGroupInfo(kConversation);
    expect(transport.calls[1].path).toBe(base + "/groupinfo");

    await api.leaveSubconversation(kConversation);
    expect(transport.calls[2]).toMatchObject({ method: "DELETE", path: base + "/self" });

    await api.deleteSubconversation(kConversation, "conference", "AAEAAQ==", 7);
    expect(transport.calls[3]).toMatchObject({
      method: "DELETE", path: base, json: { group_id: "AAEAAQ==", epoch: 7 },
    });
  });

  test("resetConversation", async () => {
    transport.reply(null);
    await api.resetConversation("AAEAAQ==", 7);
    expect(transport.calls[0]).toMatchObject({
      method: "POST", path: "/mls/reset-conversation", json: { group_id: "AAEAAQ==", epoch: 7 },
    });
  });
});

describe("Proteus", () => {
  test("claimPrekeys chunks at 128 users, merges the map and keeps the null devices", async () => {
    let userClients: any = { "wire.com": {}, "other.example": {} };
    for (let i = 0; i < 130; i++) {
      let domain = i < 100 ? "wire.com" : "other.example";
      userClients[domain][`00000000-0000-0000-0000-${String(i).padStart(12, "0")}`] = ["93fa36b916a91118"];
    }
    transport.reply(
      {
        qualified_user_client_prekeys: {
          "wire.com": { [kMe.id]: { "93fa36b916a91118": { id: 12, key: "pQABAQcCoQBYID+/abc=" } } },
        },
      },
      {
        qualified_user_client_prekeys: {
          "other.example": { [kPeer.id]: { "2b22b7c59aab5f8": null } }, // device is gone
        },
        failed_to_list: [kPeer],
      });

    let claimed = await api.claimPrekeys(userClients);
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[0].method).toBe("POST");
    expect(transport.calls[0].path).toBe("/users/list-prekeys");
    let requested = (call: any) => Object.values(call.json)
      .reduce((sum: number, users: any) => sum + Object.keys(users).length, 0);
    expect([requested(transport.calls[0]), requested(transport.calls[1])]).toEqual([128, 2]);
    expect(transport.calls[0].json["wire.com"]["00000000-0000-0000-0000-000000000000"])
      .toEqual(["93fa36b916a91118"]);

    expect(claimed.qualified_user_client_prekeys["wire.com"][kMe.id]["93fa36b916a91118"])
      .toEqual({ id: 12, key: "pQABAQcCoQBYID+/abc=" }); // base64 byte-exact
    expect(claimed.qualified_user_client_prekeys["other.example"][kPeer.id]["2b22b7c59aab5f8"])
      .toBe(null);
    expect(claimed.failed_to_list).toEqual([kPeer]);
  });

  test("getUserPrekeys and getClientPrekey", async () => {
    transport.reply(
      {
        user: kPeer.id,
        clients: [{ client: "93fa36b916a91118", prekey: { id: 4711, key: "pQABAQcCoQBYIA==" } }],
      },
      { client: "93fa36b916a91118", prekey: { id: 65535, key: "pQABAQcCoQBYIA==" } });

    let bundle = await api.getUserPrekeys(kPeer);
    expect(transport.calls[0].path)
      .toBe("/users/other.example/7025598b-ffac-4993-8a81-af3f35b7147f/prekeys");
    expect(bundle.clients[0].prekey.id).toBe(4711);

    let prekey = await api.getClientPrekey(kPeer, "93fa36b916a91118");
    expect(transport.calls[1].path)
      .toBe("/users/other.example/7025598b-ffac-4993-8a81-af3f35b7147f/prekeys/93fa36b916a91118");
    expect(prekey.prekey.id).toBe(65535); // the last-resort key
  });

  test("getRemainingPrekeyIDs reads the bare ID array", async () => {
    transport.reply([0, 1, 2, 65535]);
    expect(await api.getRemainingPrekeyIDs("deadbeef")).toEqual([0, 1, 2, 65535]);
    expect(transport.calls[0].path).toBe("/clients/deadbeef/prekeys");
  });

  test("uploadPrekeys sends lastkey only when given one", async () => {
    transport.reply(null, null);
    await api.uploadPrekeys("deadbeef", [{ id: 100, key: "pQABAQcCoQBYIA==" }]);
    expect(transport.calls[0]).toMatchObject({
      method: "PUT", path: "/clients/deadbeef",
      json: { prekeys: [{ id: 100, key: "pQABAQcCoQBYIA==" }] },
    });
    expect(transport.calls[0].json.lastkey).toBeUndefined();

    await api.uploadPrekeys("deadbeef", [], { id: 65535, key: "pQABAQcCoQBYIA==" });
    expect(transport.calls[1].json.lastkey).toEqual({ id: 65535, key: "pQABAQcCoQBYIA==" });
  });

  test("sendProteusMessage posts the protobuf and reports the federation failures", async () => {
    transport.reply({
      time: "2026-08-20T12:34:56.789Z",
      missing: {}, redundant: {}, deleted: {},
      failed_to_send: { "down.example": { [kPeer.id]: ["2b22b7c59aab5f8"] } },
      failed_to_confirm_clients: {},
    });
    let message = new Uint8Array([0x0A, 0x08, 0xDE, 0xAD]);
    let status = await api.sendProteusMessage(kConversation, message);
    expect(transport.calls[0]).toMatchObject({
      method: "POST",
      path: "/conversations/wire.com/537992e5-3782-4b6c-8718-a5db2cb786ee/proteus/messages",
      contentType: "application/x-protobuf",
      body: message, // byte-exact, the protobuf is the caller's
    });
    expect(status.sent).toBe(true);
    expect(status.failed_to_send["down.example"][kPeer.id]).toEqual(["2b22b7c59aab5f8"]);
    expect(status.missing).toEqual({});
  });

  test("a 412 mismatch comes back as sent: false with all the buckets, not as an exception", async () => {
    transport.reply(new FakeWireError(412, "", {
      time: "2026-08-20T12:34:56.789Z",
      missing: { "wire.com": { [kMe.id]: ["93fa36b916a91118", "2b22b7c59aab5f8"] } },
      redundant: { "other.example": { [kPeer.id]: ["aaaa"] } },
      deleted: { "wire.com": { [kMe.id]: ["bbbb"] } },
      failed_to_send: {},
      failed_to_confirm_clients: {},
    }));
    let status = await api.sendProteusMessage(kConversation, new Uint8Array([1]));
    expect(status.sent).toBe(false); // nothing was delivered
    expect(status.missing["wire.com"][kMe.id]).toEqual(["93fa36b916a91118", "2b22b7c59aab5f8"]);
    expect(status.redundant["other.example"][kPeer.id]).toEqual(["aaaa"]);
    expect(status.deleted["wire.com"][kMe.id]).toEqual(["bbbb"]);
    expect(status.time).toBe("2026-08-20T12:34:56.789Z");
  });

  test("any other error from a Proteus send still throws", async () => {
    transport.reply(new FakeWireError(403, "missing-legalhold-consent", {}));
    await expect(api.sendProteusMessage(kConversation, new Uint8Array([1]))).rejects.toThrow();
  });
});

describe("Assets", () => {
  test("uploadAsset builds the multipart/mixed body byte by byte", async () => {
    transport.reply({
      key: "3-1-47de4580-ae51-4650-acbb-d10c028cb0ac",
      domain: "wire.com",
      token: "aGVsbG8",
      expires: "2027-01-01T00:00:00.000Z",
    });
    let bytes = new TextEncoder().encode("test");
    let asset = await api.uploadAsset(bytes, { public: true, retention: "eternal" });

    expect(transport.calls[0].method).toBe("POST");
    expect(transport.calls[0].path).toBe("/assets");
    let boundary = transport.calls[0].contentType.replace("multipart/mixed; boundary=", "");
    expect(boundary).toMatch(/^Frontier[A-Za-z0-9]{32}$/);

    let metadata = '{"public":true,"retention":"eternal"}';
    let body = new TextDecoder().decode(transport.calls[0].body);
    expect(body).toBe(
      `--${boundary}\r\n` +
      "Content-Type: application/json;charset=utf-8\r\n" +
      `Content-length: ${metadata.length}\r\n` +
      "\r\n" +
      metadata + "\r\n" +
      `--${boundary}\r\n` +
      "Content-Type: application/octet-stream\r\n" +
      "Content-length: 4\r\n" +
      "Content-MD5: CY9rzUYh03PK3k6DJie09g==\r\n" + // the MD5 of "test", from the server's own test
      "\r\n" +
      "test\r\n" +
      `--${boundary}--\r\n`);

    expect(asset.key).toBe("3-1-47de4580-ae51-4650-acbb-d10c028cb0ac");
    expect(asset.token).toBe("aGVsbG8");
    expect(asset.expires).toBe("2027-01-01T00:00:00.000Z");
  });

  test("uploadAsset counts the metadata length in bytes, not characters", async () => {
    transport.reply({ key: "3-5-47de4580-ae51-4650-acbb-d10c028cb0ac", domain: "wire.com" });
    await api.uploadAsset(new Uint8Array([1, 2, 3]), {
      public: false,
      retention: "expiring",
      audit: { convID: kConversation, filename: "Beethovens Grüße.txt", filetype: "text/plain" },
    });
    let body = new TextDecoder().decode(transport.calls[0].body);
    let metadata = JSON.stringify({
      public: false, retention: "expiring",
      convId: kConversation, filename: "Beethovens Grüße.txt", filetype: "text/plain",
    });
    expect(body).toContain(metadata);
    expect(metadata.length).toBe(new TextEncoder().encode(metadata).length - 2); // 2 umlauts
    expect(body).toContain(`Content-length: ${new TextEncoder().encode(metadata).length}\r\n`);
  });

  test("downloadAsset sends the token only when there is one", async () => {
    let bytes = new Uint8Array([1, 2, 3]);
    transport.reply(bytes, bytes);
    expect(await api.downloadAsset("wire.com", "3-1-47de4580-ae51-4650-acbb-d10c028cb0ac")).toBe(bytes);
    expect(transport.calls[0].path).toBe("/assets/wire.com/3-1-47de4580-ae51-4650-acbb-d10c028cb0ac");
    expect(transport.calls[0].options.query).toEqual({});

    await api.downloadAsset("wire.com", "3-1-47de4580-ae51-4650-acbb-d10c028cb0ac", "aGVsbG8");
    expect(transport.calls[1].options.query).toEqual({ asset_token: "aGVsbG8" });
  });

  test("assetURL includes the version prefix", async () => {
    expect(api.assetURL("asset.example", "3-1-47de4580-ae51-4650-acbb-d10c028cb0ac"))
      .toBe("https://prod-nginz-https.wire.com/v5/assets/asset.example/3-1-47de4580-ae51-4650-acbb-d10c028cb0ac");
    transport.version = 0;
    expect(api.assetURL("wire.com", "3-1-abc"))
      .toBe("https://prod-nginz-https.wire.com/assets/wire.com/3-1-abc");
  });
});

describe("Notifications", () => {
  let notification = {
    id: "f7a3c8de-1e1b-11f0-9d2a-0242ac120002",
    payload: [{ type: "conversation.otr-message-add", conversation: kConversation.id }],
  };

  test("getNotifications passes since, client and size", async () => {
    transport.reply({ notifications: [notification], has_more: true, time: "2026-08-20T09:41:12.000Z" });
    let page = await api.getNotifications("00000000-1e1b-11f0-9d2a-0242ac120002", "deadbeef");
    expect(transport.calls[0].path).toBe("/notifications");
    expect(transport.calls[0].options.query).toEqual({
      client: "deadbeef", size: 1000, since: "00000000-1e1b-11f0-9d2a-0242ac120002",
    });
    expect(page.has_more).toBe(true);
    expect(page.lost).toBe(false);
    expect(page.notifications[0].payload[0].type).toBe("conversation.otr-message-add");
    expect(page.time).toBe("2026-08-20T09:41:12.000Z");
  });

  test("getNotifications omits since on the first call", async () => {
    transport.reply({ notifications: [], has_more: false });
    await api.getNotifications(null, "deadbeef", 500);
    expect(transport.calls[0].options.query).toEqual({ client: "deadbeef", size: 500 });
  });

  test("a 404 is reported as lost, not thrown - API v3+ error body", async () => {
    transport.reply(new FakeWireError(404, "not-found", { code: 404, label: "not-found" }));
    let page = await api.getNotifications("00000000-1e1b-11f0-9d2a-0242ac120002", "deadbeef");
    expect(page.lost).toBe(true);
    expect(page.notifications).toEqual([]);
  });

  test("a 404 with the partial list keeps it - API v2 and older", async () => {
    transport.reply(new FakeWireError(404, "not-found",
      { notifications: [notification], has_more: false, time: "2026-08-20T09:41:12.000Z" }));
    let page = await api.getNotifications("00000000-1e1b-11f0-9d2a-0242ac120002", "deadbeef");
    expect(page.lost).toBe(true);
    expect(page.notifications).toHaveLength(1);
  });

  test("a 400 for a stale since is lost too, but other errors are thrown", async () => {
    transport.reply(new FakeWireError(400, "bad-request", {}));
    expect((await api.getNotifications("00000000-1e1b-11f0-9d2a-0242ac120002", "deadbeef")).lost).toBe(true);

    transport.reply(new FakeWireError(400, "bad-request", {}));
    await expect(api.getNotifications(null, "deadbeef")).rejects.toThrow();

    transport.reply(new FakeWireError(500, "server-error", {}));
    await expect(api.getNotifications("00000000-1e1b-11f0-9d2a-0242ac120002", "deadbeef")).rejects.toThrow();
  });

  test("getLastNotification, and null when the account has none", async () => {
    transport.reply(notification, new FakeWireError(404, "not-found"));
    let last = await api.getLastNotification("deadbeef");
    expect(transport.calls[0].path).toBe("/notifications/last");
    expect(transport.calls[0].options.query).toEqual({ client: "deadbeef" });
    expect(last.id).toBe("f7a3c8de-1e1b-11f0-9d2a-0242ac120002");

    expect(await api.getLastNotification("deadbeef")).toBe(null);
  });
});
