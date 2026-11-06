// An in-memory JMAP server for FileNode, as per draft-ietf-jmap-filenode-18,
// or -14 like Stalwart v0.16 (`draft14`), with blobs and the push state.
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";

export const kAccountID = "u1";

interface Node {
  "@type": "File" | "Directory" | "SymLink";
  id: string;
  parentId: string | null;
  name: string;
  blobId?: string;
  size?: number;
  mediaType?: string;
  modified: string;
  target?: string[];
}

export class FakeFileNodeServer {
  nodes = new Map<string, Node>();
  blobs = new Map<string, Uint8Array>();
  /** Up to draft -14: `nodeType` and `type` instead of `@type` and `mediaType`, and no `supportedNodeTypes` */
  draft14 = false;
  /** Supports draft-ietf-jmap-conditional */
  conditional = true;
  state = 1;
  /** state -> what changed to reach this state */
  log: { state: number, id: string, change: "created" | "updated" | "destroyed" }[] = [];
  /** All method calls that the client made, with their arguments */
  calls: [string, Record<string, any>][] = [];
  /** Called before each `FileNode/set`, to simulate another client */
  beforeSet: (() => void) | null = null;
  /** Called with the response of each method call, to simulate a buggy or hostile server */
  changeResponse: ((method: string, args: Record<string, any>, response: Record<string, any>) => void) | null = null;
  protected nextID = 1;

  session(): TJMAPSession {
    let filenode: Record<string, any> = {
      maxFileNodeDepth: null,
      maxSizeFileNodeName: 255,
      forbiddenNameChars: "/",
      forbiddenNodeNames: [".", ".."],
      fileNodeQuerySortOptions: ["name"],
      mayCreateTopLevelFileNode: true,
      caseInsensitiveNames: false,
      webTrashUrl: null,
      webUrlTemplate: null,
      webWriteUrlTemplate: null,
    };
    if (!this.draft14) {
      filenode.supportedNodeTypes = ["Directory", "File", "SymLink"];
    }
    let capabilities: Record<string, any> = {
      "urn:ietf:params:jmap:core": { maxSizeUpload: 1000000, maxObjectsInGet: 3, maxObjectsInSet: 500, maxConcurrentRequests: 4 },
      "urn:ietf:params:jmap:filenode": {},
    };
    if (this.conditional) {
      capabilities["urn:ietf:params:jmap:conditional"] = {};
    }
    return {
      apiUrl: "http://jmap.example.com/jmap/",
      downloadUrl: "http://jmap.example.com/download/{accountId}/{blobId}/{name}?accept={type}",
      uploadUrl: "http://jmap.example.com/upload/{accountId}/",
      eventSourceUrl: "http://jmap.example.com/events/",
      capabilities,
      accounts: {
        [kAccountID]: {
          name: "alice@example.com",
          isPersonal: true,
          isReadOnly: false,
          accountCapabilities: { "urn:ietf:params:jmap:filenode": filenode },
        },
      },
      primaryAccounts: { "urn:ietf:params:jmap:filenode": kAccountID },
      username: "alice@example.com",
      state: "s1",
    } as TJMAPSession;
  }

  /** A JMAP account that talks to this server */
  newAccount(): JMAPAccount {
    let account = new JMAPAccount();
    account.accountID = kAccountID;
    account.session = this.session();
    account.name = "Alice";
    account.save = async () => {};
    account.httpPost = async (url: string, request: any) => this.answer(request);
    account.uploadBlob = async (bytes: any, mimeType: string) => {
      let blobId = this.addBlob(new Uint8Array(bytes));
      return { accountId: kAccountID, blobId, type: mimeType, size: bytes.length };
    };
    account.downloadBlob = async (blobID: string, name: string, mimeType: string) => {
      let bytes = this.blobs.get(blobID);
      if (!bytes) {
        throw new Error("404 blob not found");
      }
      return new Blob([bytes], { type: mimeType });
    };
    return account;
  }

  addBlob(bytes: Uint8Array | string): string {
    let blobId = "B" + this.nextID++;
    this.blobs.set(blobId, typeof bytes == "string" ? new TextEncoder().encode(bytes) : bytes);
    return blobId;
  }

  addDirectory(name: string, parentId: string | null = null): string {
    return this.create({ "@type": "Directory", name, parentId });
  }

  addFile(name: string, contents: string, parentId: string | null = null, modified = "2026-10-01T10:00:00.000Z"): string {
    return this.create({ "@type": "File", name, parentId, blobId: this.addBlob(contents), mediaType: "text/plain", modified });
  }

  /** Another client changed the contents */
  changeFile(id: string, contents: string, modified = new Date().toISOString()) {
    let node = this.nodes.get(id);
    node.blobId = this.addBlob(contents);
    node.size = this.blobs.get(node.blobId).length;
    node.modified = modified;
    this.changed(id, "updated");
  }

  update(id: string, patch: Partial<Node>) {
    Object.assign(this.nodes.get(id), patch);
    this.changed(id, "updated");
  }

  destroy(id: string) {
    for (let child of [...this.nodes.values()].filter(node => node.parentId == id)) {
      this.destroy(child.id);
    }
    this.nodes.delete(id);
    this.changed(id, "destroyed");
  }

  contents(id: string): string {
    return new TextDecoder().decode(this.blobs.get(this.nodes.get(id).blobId));
  }

  find(name: string, parentId: string | null = null): Node | undefined {
    return [...this.nodes.values()].find(node => node.name == name && node.parentId == parentId);
  }

  protected create(properties: Omit<Node, "id" | "modified"> & { modified?: string }): string {
    let node = { modified: "2026-10-01T10:00:00.000Z", ...properties, id: "n" + this.nextID++ } as Node;
    if (node.blobId) {
      node.size = this.blobs.get(node.blobId).length;
    }
    this.nodes.set(node.id, node);
    this.changed(node.id, "created");
    return node.id;
  }

  protected changed(id: string, change: "created" | "updated" | "destroyed") {
    this.state++;
    this.log.push({ state: this.state, id, change });
  }

  protected toWire(node: Node): Record<string, any> {
    if (!this.draft14) {
      return { ...node };
    }
    let { "@type": type, mediaType, ...json } = node as any;
    json.nodeType = type.toLowerCase();
    json.type = mediaType ?? null;
    json.blobId ??= null;
    json.size ??= null;
    return json;
  }

  protected fromWire(json: Record<string, any>): Partial<Node> {
    let { nodeType, type, ...node } = json;
    if (this.draft14) {
      if (json["@type"] || json.mediaType) {
        throw new Error("invalidProperties: @type");
      }
      if (nodeType) {
        node["@type"] = nodeType == "file" ? "File" : nodeType == "directory" ? "Directory" : "SymLink";
      }
      if (type) {
        node.mediaType = type;
      }
    } else if (nodeType || type) {
      throw new Error("invalidProperties: nodeType");
    }
    return node;
  }

  answer(request: { using: string[], methodCalls: [string, Record<string, any>, string][] }) {
    let results: Record<string, any> = {};
    let methodResponses: any[] = [];
    for (let [method, args, callID] of request.methodCalls) {
      this.calls.push([method, args]);
      try {
        let result = this.call(method, this.resolveReferences(args, results));
        this.changeResponse?.(method, args, result);
        results[callID] = result;
        methodResponses.push([method, result, callID]);
      } catch (ex) {
        methodResponses.push(["error", { type: ex.message.split(":")[0], description: ex.message }, callID]);
      }
    }
    return { methodResponses, sessionState: "s1" };
  }

  protected resolveReferences(args: Record<string, any>, results: Record<string, any>) {
    let ref = args["#ids"];
    if (!ref) {
      return args;
    }
    let { "#ids": _, ...resolved } = args;
    resolved.ids = results[Object.keys(results).find(callID => callID == ref.resultOf)]?.[ref.path.substring(1)];
    return resolved;
  }

  protected call(method: string, args: Record<string, any>): Record<string, any> {
    if (method == "FileNode/get") {
      let ids: string[] = args.ids ?? [...this.nodes.keys()];
      let list = ids.filter(id => this.nodes.has(id)).map(id => this.nodes.get(id));
      if (args.fetchParents) {
        for (let node of [...list]) {
          for (let parent = this.nodes.get(node.parentId); parent && !list.includes(parent); parent = this.nodes.get(parent.parentId)) {
            list.push(parent);
          }
        }
      }
      return {
        accountId: kAccountID,
        state: "s" + this.state,
        list: list.map(node => this.toWire(node)),
        notFound: ids.filter(id => !this.nodes.has(id)),
      };
    }
    if (method == "FileNode/query") {
      let all = [...this.nodes.values()]
        .filter(node => args.filter?.isTopLevel ? node.parentId == null : node.parentId == args.filter?.parentId)
        .map(node => node.id);
      let position = args.position ?? 0;
      let ids = all.slice(position, position + (args.limit ?? all.length));
      return { accountId: kAccountID, queryState: "s" + this.state, position, ids, total: args.calculateTotal ? all.length : undefined, canCalculateChanges: true };
    }
    if (method == "FileNode/changes") {
      let since = parseInt(args.sinceState.substring(1));
      if (since < 1) {
        throw new Error("cannotCalculateChanges");
      }
      let entries = this.log.filter(entry => entry.state > since);
      let created = new Set<string>(), updated = new Set<string>(), destroyed = new Set<string>();
      for (let { id, change } of entries) {
        if (change == "created") {
          created.add(id);
        } else if (change == "updated" && !created.has(id)) {
          updated.add(id);
        } else if (change == "destroyed") {
          if (!created.delete(id)) {
            destroyed.add(id);
          }
          updated.delete(id);
        }
      }
      return { accountId: kAccountID, oldState: args.sinceState, newState: "s" + this.state, hasMoreChanges: false, created: [...created], updated: [...updated], destroyed: [...destroyed] };
    }
    if (method == "FileNode/set") {
      return this.set(args);
    }
    throw new Error("unknownMethod");
  }

  protected set(args: Record<string, any>): Record<string, any> {
    this.beforeSet?.();
    if (args.ifInState && args.ifInState != "s" + this.state) {
      throw new Error("stateMismatch");
    }
    if (args.ifUnchangedBy) {
      if (!this.conditional) {
        throw new Error("The client sent ifUnchangedBy to a server without draft-ietf-jmap-conditional");
      }
      for (let [id, patch] of Object.entries(args.ifUnchangedBy)) {
        let node = this.nodes.get(id);
        if (!node || Object.entries(patch).some(([key, value]) => (node as any)[key] != value)) {
          throw new Error("stateMismatch");
        }
      }
    }
    let oldState = "s" + this.state;
    let response: Record<string, any> = { accountId: kAccountID, oldState };
    for (let [creationID, json] of Object.entries(args.create ?? {})) {
      let properties = this.fromWire(json);
      let name = properties.name;
      if (this.find(name, properties.parentId ?? null)) {
        if (args.onExists != "rename") {
          (response.notCreated ??= {})[creationID] = { type: "alreadyExists", existingId: this.find(name, properties.parentId ?? null).id };
          continue;
        }
        let dot = name.lastIndexOf(".");
        for (let i = 2; this.find(name, properties.parentId ?? null); i++) {
          name = dot > 0 ? `${properties.name.substring(0, dot)} (${i})${properties.name.substring(dot)}` : `${properties.name} (${i})`;
        }
      }
      let id = this.create({ ...properties, name } as any);
      (response.created ??= {})[creationID] = name == properties.name ? { id } : { id, name };
    }
    for (let [id, json] of Object.entries(args.update ?? {})) {
      if (!this.nodes.has(id)) {
        (response.notUpdated ??= {})[id] = { type: "notFound" };
        continue;
      }
      let patch = this.fromWire(json);
      let node = { ...this.nodes.get(id), ...patch };
      let existing = this.find(node.name, node.parentId);
      if (existing && existing.id != id) {
        (response.notUpdated ??= {})[id] = { type: "alreadyExists", existingId: existing.id };
        continue;
      }
      if (patch.blobId) {
        patch.size = this.blobs.get(patch.blobId).length;
      }
      this.update(id, patch);
      (response.updated ??= {})[id] = null;
    }
    for (let id of args.destroy ?? []) {
      if (!this.nodes.has(id)) {
        (response.notDestroyed ??= {})[id] = { type: "notFound" };
        continue;
      }
      if (!args.onDestroyRemoveChildren && [...this.nodes.values()].some(node => node.parentId == id)) {
        (response.notDestroyed ??= {})[id] = { type: "nodeHasChildren" };
        continue;
      }
      this.destroy(id);
      (response.destroyed ??= []).push(id);
    }
    response.newState = "s" + this.state;
    return response;
  }
}
