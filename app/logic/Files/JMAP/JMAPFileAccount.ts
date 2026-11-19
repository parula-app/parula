import { FileSharingAccount } from "../FileSharingAccount";
import { JMAPDirectory } from "./JMAPDirectory";
import { JMAPFile } from "./JMAPFile";
import type { JMAPAccount } from "../../Mail/JMAP/JMAPAccount";
import type { TJMAPFileNode } from "./TJMAPFileNode";
import type { TJMAPChangeResponse, TJMAPGetResponse, TJMAPQueryResponse } from "../../Mail/JMAP/TJMAPGeneric";
import { checkChangeError } from "../../Mail/JMAP/JMAPError";
import { LoopGuard } from "../../util/flow/LoopGuard";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { UserError, assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { Buffer } from "buffer";
import { ArrayColl, SetColl } from "svelte-collections";

/** Files on a JMAP server, as per draft-ietf-jmap-filenode.
 * The JMAP mail account is our main account, and gives us the session.
 * The algorithm for the locally cached files is in `JMAPFileSync.md`. */
export class JMAPFileAccount extends FileSharingAccount {
  readonly protocol: string = "files-jmap";
  declare readonly rootDirs: ArrayColl<JMAPDirectory>;
  protected localChangesPoller: ReturnType<typeof setInterval> | null = null;

  get jmapAccount(): JMAPAccount {
    assert(this.mainAccount, gt`The files of ${this.name} lost the connection to their account`);
    return this.mainAccount as JMAPAccount;
  }

  get isLoggedIn(): boolean {
    return !!this.mainAccount?.isLoggedIn;
  }

  newDirectory(name: string, dir = new JMAPDirectory()): JMAPDirectory {
    return super.newDirectory(name, dir) as JMAPDirectory;
  }

  /** Holds the top level nodes, which have no parent on the server */
  get rootDir(): JMAPDirectory {
    return this.rootDirs.first;
  }

  async syncOnStartup() {
    this.startPolling();
    await super.syncOnStartup();
  }

  async sync() {
    await this.jmapAccount.ensureLoggedIn();
    if (this.rootDirs.isEmpty) {
      let root = this.newDirectory(gt`Files`);
      root.path = "/";
      this.rootDirs.add(root);
      await root.saveLocally();
    }
    if (this.jmapAccount.syncState.has("FileNode")) {
      await this.fetchChanges();
    } else {
      await this.listKnownDirectories();
    }
    await this.syncLocalCopies();
  }

  async disconnect() {
    this.stopPolling();
    await super.disconnect();
  }

  /** The local copies are edited by other apps, and we don't get events for that */
  protected startPolling() {
    this.stopPolling();
    const kIntervalSeconds = 60;
    this.localChangesPoller = setInterval(async () => {
      if (!this.isLoggedIn) {
        return;
      }
      try {
        await this.syncLocalCopies();
      } catch (ex) {
        this.errorCallback(ex);
      }
    }, kIntervalSeconds * 1000);
  }

  protected stopPolling() {
    if (!this.localChangesPoller) {
      return;
    }
    clearInterval(this.localChangesPoller);
    this.localChangesPoller = null;
  }

  async syncLocalCopies() {
    for (let file of this.allFiles().filterOnce(file => !!file.filepathLocal)) {
      try {
        await file.syncLocalCopy();
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
  }

  /** Applies the changes on the server to the nodes that we know.
   * Called by the push notification.
   * <https://www.rfc-editor.org/rfc/rfc8620#section-5.2> */
  async fetchChanges() {
    let changedFiles = new SetColl<JMAPFile>();
    let lock = await this.jmapAccount.stateLock.lock();
    try {
      const kMaxRounds = 1000;
      let loop = new LoopGuard(kMaxRounds, () =>
        this.errorCallback(new Error(`${this.name}: File changes: The server keeps reporting more changes. Stopped.`)));
      while (loop.nextRound()) {
        let sinceState = this.jmapAccount.syncState.get("FileNode");
        if (!sinceState) {
          await this.listKnownDirectories();
          return;
        }
        if (loop.isSameAsLastRound(sinceState)) {
          break;
        }
        let response: Record<string, any>;
        try {
          response = await this.jmapAccount.makeCombinedCall([
            [
              "FileNode/changes", {
                accountId: this.jmapAccount.accountID,
                sinceState: sinceState,
                maxChanges: this.jmapAccount.maxObjectsInGet,
              },
              "changes",
            ], [
              "FileNode/get", {
                accountId: this.jmapAccount.accountID,
                "#ids": {
                  resultOf: "changes",
                  name: "FileNode/changes",
                  path: "/created",
                },
              },
              "created",
            ], [
              "FileNode/get", {
                accountId: this.jmapAccount.accountID,
                "#ids": {
                  resultOf: "changes",
                  name: "FileNode/changes",
                  path: "/updated",
                },
              },
              "updated",
            ],
          ]);
        } catch (ex) {
          if (ex.code == "cannotCalculateChanges") {
            this.jmapAccount.syncState.delete("FileNode");
            await this.listKnownDirectories();
            return;
          }
          throw ex;
        }
        let changes = response["changes"] as TJMAPChangeResponse<TJMAPFileNode>;
        let destroyedIDs = sanitize.array(changes.destroyed, [])
          .map(id => sanitize.alphanumdash(id, null))
          .filter(id => id);
        await this.removedOnServer(destroyedIDs);
        let nodes = new ArrayColl((response["created"] as TJMAPGetResponse<TJMAPFileNode>).list);
        nodes.addAll((response["updated"] as TJMAPGetResponse<TJMAPFileNode>).list);
        for (let json of nodes) {
          try {
            let node = await this.applyServerNode(json);
            if (node instanceof JMAPFile) {
              changedFiles.add(node);
            } else if (node instanceof JMAPDirectory) { // e.g. renamed, so the files in it move on disk
              for (let dir of node.getInclusiveDescendants()) {
                changedFiles.addAll(dir.files);
              }
            }
          } catch (ex) {
            this.dataError(ex);
          }
        }

        this.jmapAccount.syncState.set("FileNode", changes.newState);
        await this.jmapAccount.save();
        if (!changes.hasMoreChanges) {
          break;
        }
      }
    } finally {
      lock.release();
    }
    for (let file of changedFiles) {
      if (!file.filepathLocal) {
        continue;
      }
      try {
        await file.syncLocalCopy();
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
  }

  /** For the first sync, and after the server could not tell us the changes:
   * Lists again all directories that we have */
  protected async listKnownDirectories() {
    for (let dir of this.allDirectories()) {
      if (this.allDirectories().contains(dir)) { // not removed by an earlier listing
        await dir.listContents();
      }
    }
    await this.jmapAccount.save();
  }

  /** The first listing gives the state from which we follow the changes */
  recordState(state: string) {
    if (state && !this.jmapAccount.syncState.has("FileNode")) {
      this.jmapAccount.syncState.set("FileNode", state);
    }
  }

  /** Puts a node from the server into our tree, or updates it there.
   * @returns null, if it is not in a directory that we know, or not a file or directory */
  async applyServerNode(json: TJMAPFileNode): Promise<JMAPFile | JMAPDirectory | null> {
    let type = this.nodeType(json);
    if (type != "File" && type != "Directory") {
      return null; // SymLinks and unknown types. The UI cannot show them.
    }
    let node = this.findNode(sanitize.alphanumdash(json.id));
    let parentID = sanitize.alphanumdash(json.parentId, null);
    let parent = parentID ? this.findDirectory(parentID) : this.rootDir;
    if (!parent) {
      if (!node) {
        return null; // In a directory that the user did not open yet. `listContents()` will get it.
      }
      parent = await this.fetchDirectory(parentID); // We know the node, and it was moved there
    }
    if (!node) {
      node = type == "File" ? parent.newFile("") : parent.newDirectory("");
      node.fromJMAP(json);
      if (node instanceof JMAPFile) {
        parent.files.add(node);
      } else {
        parent.subDirs.add(node);
      }
    } else {
      if ((node instanceof JMAPFile) != (type == "File")) {
        throw new Error(`${this.name}: The server changed the type of ${node.name}`);
      }
      node.moveTo(parent);
      node.fromJMAP(json);
    }
    await node.saveLocally();
    return node;
  }

  /** Our tree has only the directories that the user opened, so creates the
   * directory and its parents, without their other contents. */
  protected async fetchDirectory(nodeID: string): Promise<JMAPDirectory> {
    let response = await this.jmapAccount.makeSingleCall("FileNode/get", {
      accountId: this.jmapAccount.accountID,
      ids: [nodeID],
      fetchParents: true,
    }) as TJMAPGetResponse<TJMAPFileNode>;
    let byID = new Map(response.list.map(json => [json.id, json]));
    let path = new ArrayColl<TJMAPFileNode>();
    let ancestorID = nodeID;
    for (let i = 0; ancestorID && !this.findDirectory(ancestorID) && i <= byID.size; i++) {
      let json = byID.get(ancestorID);
      assert(json, `${this.name}: The server did not return the parent directories of ${nodeID}`);
      path.add(json);
      ancestorID = json.parentId;
    }
    for (let json of path.reverse()) {
      await this.applyServerNode(json);
    }
    let dir = this.findDirectory(nodeID);
    assert(dir, `${this.name}: Directory ${nodeID} not found`);
    return dir;
  }

  /** @param nodeIDs The server destroyed these nodes */
  async removedOnServer(nodeIDs: string[]) {
    let gone = new Set(nodeIDs);
    for (let nodeID of nodeIDs) {
      let node = this.findNode(nodeID);
      if (!node) {
        continue; // Not in our tree, or a descendant of a node that we already removed
      }
      let survivor = node.parent;
      for (let i = 0; survivor?.nodeID && gone.has(survivor.nodeID) && i < 1000; i++) {
        survivor = survivor.parent;
      }
      try {
        await node.removedOnServer(survivor ?? this.rootDir);
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
  }

  /** Children that disappeared from a directory listing were either deleted or moved elsewhere */
  async findVanished(nodeIDs: string[]) {
    let pageSize = this.jmapAccount.maxObjectsInGet;
    for (let i = 0; i < nodeIDs.length; i += pageSize) {
      let response = await this.jmapAccount.makeSingleCall("FileNode/get", {
        accountId: this.jmapAccount.accountID,
        ids: nodeIDs.slice(i, i + pageSize),
      }) as TJMAPGetResponse<TJMAPFileNode>;
      for (let json of response.list) {
        try {
          await this.applyServerNode(json);
        } catch (ex) {
          this.dataError(ex);
        }
      }
      await this.removedOnServer(sanitize.array(response.notFound, [])
        .map(id => sanitize.alphanumdash(id, null))
        .filter(id => id));
    }
  }

  /** Lists the children of a directory
   * @param parentID null: top level nodes */
  async listChildren(parentID: string | null): Promise<{ nodes: ArrayColl<TJMAPFileNode>, state: string }> {
    let nodes = new ArrayColl<TJMAPFileNode>();
    let state: string = null;
    let pageSize = this.jmapAccount.maxObjectsInGet;
    const kMaxRounds = 1000; // 500 000 entries in one directory
    let loop = new LoopGuard(kMaxRounds, () =>
      this.errorCallback(new Error(`${this.name}: The server keeps listing more files. Stopped.`)));
    while (loop.nextRound()) {
      let response = await this.jmapAccount.makeCombinedCall([
        [
          "FileNode/query", {
            accountId: this.jmapAccount.accountID,
            filter: parentID ? { parentId: parentID } : { isTopLevel: true },
            position: nodes.length,
            limit: pageSize,
            calculateTotal: true,
          },
          "query",
        ], [
          "FileNode/get", {
            accountId: this.jmapAccount.accountID,
            "#ids": {
              resultOf: "query",
              name: "FileNode/query",
              path: "/ids",
            },
          },
          "nodes",
        ],
      ]);
      let query = response["query"] as TJMAPQueryResponse;
      let get = response["nodes"] as TJMAPGetResponse<TJMAPFileNode>;
      state ??= get.state;
      let ids = sanitize.array(query.ids, []).join(",");
      if (!ids) {
        break;
      }
      if (loop.isSameAsLastRound(ids)) {
        break;
      }
      nodes.addAll(get.list);
      let total = sanitize.integer(query.total, null);
      if (total != null ? nodes.length >= total : query.ids.length < pageSize) {
        break;
      }
    }
    return { nodes, state };
  }

  /** @returns the IDs of the nodes that the server created */
  async setNodes(args: Record<string, any>): Promise<Record<string, any>> {
    let response = await this.jmapAccount.makeSingleCall("FileNode/set", {
      accountId: this.jmapAccount.accountID,
      ...args,
    }) as TJMAPChangeResponse<TJMAPFileNode>;
    checkChangeError(response);
    return response.created ?? {};
  }

  /** Updates a file, but only if nobody else changed its contents since we got them.
   * @param blobID The contents that we expect on the server
   * @returns false, if somebody else changed the contents, or deleted the file */
  async updateFileIfUnchanged(nodeID: string, blobID: string, update: Record<string, any>): Promise<boolean> {
    if (this.jmapAccount.hasCapability("urn:ietf:params:jmap:conditional")) {
      try {
        await this.setNodes({
          ifUnchangedBy: {
            [nodeID]: { blobId: blobID },
          },
          update: {
            [nodeID]: update,
          },
        });
        return true;
      } catch (ex) {
        if (ex.code == "stateMismatch") {
          return false;
        }
        throw ex;
      }
    }

    // Without draft-ietf-jmap-conditional, only `ifInState` can protect the update.
    // It fails also when other nodes changed, so we try again.
    const kMaxRounds = 5;
    let loop = new LoopGuard(kMaxRounds, () => {
      throw new Error(`${this.name}: The files keep changing on the server. We'll try again later.`);
    });
    while (loop.nextRound()) {
      let response = await this.jmapAccount.makeSingleCall("FileNode/get", {
        accountId: this.jmapAccount.accountID,
        ids: [nodeID],
        properties: ["blobId"],
      }) as TJMAPGetResponse<TJMAPFileNode>;
      if (response.list.find(json => json.id == nodeID)?.blobId != blobID) {
        break;
      }
      try {
        await this.setNodes({
          ifInState: response.state,
          update: {
            [nodeID]: update,
          },
        });
        return true;
      } catch (ex) {
        if (ex.code != "stateMismatch") {
          throw ex;
        }
      }
    }
    return false;
  }

  /** @returns blob ID */
  async uploadContents(contents: Blob, name: string, mimetype: string): Promise<string> {
    let maxSize = sanitize.integer(this.jmapAccount.getCapability("urn:ietf:params:jmap:core")?.maxSizeUpload, null);
    if (maxSize && contents.size > maxSize) {
      throw new UserError(gt`The file ${name} is too large for the server`);
    }
    let bytes = Buffer.from(await contents.arrayBuffer()); // Buffer needed for JPC
    let upload = await this.jmapAccount.uploadBlob(bytes, mimetype || "application/octet-stream", name);
    return sanitize.alphanumdash(upload.blobId);
  }

  async downloadContents(blobID: string, name: string, mimetype: string): Promise<Blob> {
    return await this.jmapAccount.downloadBlob(blobID, name, mimetype || "application/octet-stream");
  }

  /** A new node, in the format of the server's draft version.
   * @param properties e.g. `{ name, parentId, blobId, mediaType }` */
  newNodeJSON(type: "File" | "Directory", properties: Record<string, any>): Record<string, any> {
    // <compat for="Stalwart" reason="Implements draft-ietf-jmap-filenode-14, which has `nodeType` and `type` instead of `@type` and `mediaType`">
    if (this.isFileNodeDraft14) {
      let { mediaType, ...json } = properties;
      json.nodeType = type == "File" ? "file" : "directory";
      if (mediaType) {
        json.type = mediaType;
      }
      return json;
    }
    // </compat>
    return { "@type": type, ...properties };
  }

  nodeType(json: TJMAPFileNode): string {
    // <compat for="Stalwart" reason="draft-ietf-jmap-filenode-14">
    if (!json["@type"]) {
      return { file: "File", directory: "Directory", symlink: "SymLink" }[json.nodeType] ?? json.nodeType;
    }
    // </compat>
    return json["@type"];
  }

  /** Since draft -15, a server must tell which node types it supports */
  protected get isFileNodeDraft14(): boolean {
    return !this.capability?.supportedNodeTypes;
  }

  get capability(): Record<string, any> | null {
    return this.jmapAccount.accountCapabilities["urn:ietf:params:jmap:filenode"] ?? null;
  }

  findNode(nodeID: string): JMAPFile | JMAPDirectory | null {
    return this.findDirectory(nodeID) ?? this.allFiles().find(file => file.nodeID == nodeID) ?? null;
  }

  findDirectory(nodeID: string): JMAPDirectory | null {
    return this.allDirectories().find(dir => dir.nodeID == nodeID) ?? null;
  }

  allDirectories(): ArrayColl<JMAPDirectory> {
    let dirs = new ArrayColl<JMAPDirectory>();
    for (let root of this.rootDirs) {
      dirs.addAll(root.getInclusiveDescendants());
    }
    return dirs;
  }

  allFiles(): ArrayColl<JMAPFile> {
    let files = new ArrayColl<JMAPFile>();
    for (let dir of this.allDirectories()) {
      files.addAll(dir.files);
    }
    return files;
  }
}
