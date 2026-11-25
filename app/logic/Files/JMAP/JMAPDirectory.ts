import { Directory } from "../Directory";
import { JMAPFile } from "./JMAPFile";
import type { JMAPFileAccount } from "./JMAPFileAccount";
import type { File } from "../File";
import type { TJMAPFileNode } from "./TJMAPFileNode";
import { appGlobal } from "../../app";
import { Lock } from "../../util/flow/Lock";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { ArrayColl, type Collection } from "svelte-collections";

export class JMAPDirectory extends Directory {
  declare account: JMAPFileAccount;
  declare readonly files: ArrayColl<JMAPFile>;
  declare readonly subDirs: ArrayColl<JMAPDirectory>;
  declare parent: JMAPDirectory;
  /** FileNode ID. null for the root directory, which holds the top level nodes. */
  nodeID: string | null = null;
  protected readonly listLock = new Lock();

  newDirectory(name: string, dir = new JMAPDirectory()): JMAPDirectory {
    return super.newDirectory(name, dir) as JMAPDirectory;
  }

  newFile(name: string, file = new JMAPFile()): JMAPFile {
    return super.newFile(name, file) as JMAPFile;
  }

  fromJMAP(json: TJMAPFileNode) {
    this.nodeID = sanitize.alphanumdash(json.id);
    this.name = sanitize.nonemptylabel(json.name);
    this.path = this.parent.childPath(this.name, true);
    this.lastMod = sanitize.date(json.modified, this.lastMod);
    this.canDelete = sanitize.boolean(json.myRights?.mayDelete, true);
  }

  async listContents() {
    let lock = await this.listLock.lock();
    try {
      await this.account.jmapAccount.ensureLoggedIn();
      let { nodes, state } = await this.account.listChildren(this.nodeID);
      this.account.recordState(state);
      let listed = new Set<string>();
      for (let json of nodes) {
        try {
          let node = await this.account.applyServerNode(json);
          if (node) {
            listed.add(node.nodeID);
          }
        } catch (ex) {
          this.account.dataError(ex);
        }
      }
      let vanished = [...this.files, ...this.subDirs]
        .filter(node => node.nodeID && !listed.has(node.nodeID))
        .map(node => node.nodeID);
      await this.account.findVanished(vanished);
      await this.saveLocally();
    } finally {
      lock.release();
    }
  }

  /** Also updates the paths of the contents, which contain our name */
  async saveLocally() {
    await super.saveLocally();
    for (let file of this.files) {
      let path = this.childPath(file.name);
      if (file.path != path) {
        file.path = path;
        await file.saveLocally();
      }
    }
    for (let dir of this.subDirs) {
      let path = this.childPath(dir.name, true);
      if (dir.path != path) {
        dir.path = path;
        await dir.saveLocally();
      }
    }
  }

  async renameOnServer(newName: string) {
    if (!this.nodeID) {
      return;
    }
    await this.account.setNodes({
      update: {
        [this.nodeID]: { name: newName },
      },
    });
    this.path = this.parent.childPath(newName, true);
  }

  async createSubDirectory(name: string): Promise<JMAPDirectory> {
    let created = await this.account.setNodes({
      create: {
        dir: this.account.newNodeJSON("Directory", {
          name: name,
          parentId: this.nodeID,
        }),
      },
    });
    let nodeID = sanitize.alphanumdash(created["dir"]?.id);
    let dir = this.account.findDirectory(nodeID); // The push notification may have been faster
    if (!dir) {
      dir = this.newDirectory(name);
      dir.nodeID = nodeID;
      this.subDirs.add(dir);
    }
    await dir.saveLocally();
    return dir;
  }

  async addFile(file: File) {
    await file.download();
    assert(file.contents, `${file.name}: Could not read the file`);
    let mimetype = file.mimetype || file.contents.type || "application/octet-stream";
    let lastMod = file.lastMod ?? new Date();
    let blobID = await this.account.uploadContents(file.contents, file.name, mimetype);
    let created = await this.account.setNodes({
      create: {
        file: this.account.newNodeJSON("File", {
          name: file.name,
          parentId: this.nodeID,
          blobId: blobID,
          mediaType: mimetype,
          modified: lastMod.toISOString(),
        }),
      },
    });
    let nodeID = sanitize.alphanumdash(created["file"]?.id);
    let newFile = this.files.find(f => f.nodeID == nodeID); // The push notification may have been faster
    if (!newFile) {
      newFile = this.newFile(file.name);
      newFile.nodeID = nodeID;
      this.files.add(newFile);
    }
    newFile.blobID = blobID;
    newFile.size = file.contents.size;
    newFile.mimetype = mimetype;
    newFile.lastMod = new Date(lastMod);
    newFile.lastModOnServer = new Date(lastMod);
    await newFile.saveLocally();
  }

  /** Adds a file that we have only on disk, e.g. one of the two versions after a conflict.
   * @param blobID The contents are already on the server */
  async addLocalFile(name: string, filepathLocal: string, mimetype: string, blobID?: string): Promise<JMAPFile> {
    let stat = await appGlobal.remoteApp.statFile(filepathLocal);
    let file = this.newFile(name);
    file.filepathLocal = filepathLocal;
    file.mimetype = mimetype;
    file.size = stat.size;
    file.lastMod = new Date(stat.lastMod);
    file.lastModOnServer = new Date(stat.lastMod);
    this.files.add(file);
    await file.saveLocally(); // If the upload fails, `syncLocalCopy()` tries again later
    await file.createOnServer(blobID);
    return file;
  }

  protected async moveOrCopyFilesOnServer(action: "move" | "copy", files: Collection<File>) {
    let jmapFiles = files as Collection<JMAPFile>;
    if (action == "move") {
      let source = jmapFiles.first.parent;
      let update: Record<string, any> = {};
      for (let file of jmapFiles) {
        update[file.nodeID] = { parentId: this.nodeID };
      }
      try {
        await this.account.setNodes({ update });
      } catch (ex) {
        source.files.addAll(jmapFiles.filterOnce(file => !source.files.contains(file)));
        throw ex;
      }
      for (let file of jmapFiles) {
        file.moveTo(this);
        await file.saveLocally();
      }
      return;
    }

    let originals = new Map<string, JMAPFile>();
    let create: Record<string, any> = {};
    for (let file of jmapFiles) {
      let creationID = "copy" + originals.size;
      originals.set(creationID, file);
      create[creationID] = this.account.newNodeJSON("File", {
        name: file.name,
        parentId: this.nodeID,
        blobId: file.blobID, // Blobs are immutable, so the copy uses the same contents, without upload
        mediaType: file.mimetype,
        modified: file.lastModOnServer?.toISOString(),
      });
    }
    let created = await this.account.setNodes({
      create,
      onExists: "rename",
    });
    for (let [creationID, file] of originals) {
      let json = created[creationID];
      let nodeID = sanitize.alphanumdash(json?.id, null);
      if (!nodeID || this.files.find(f => f.nodeID == nodeID)) {
        continue;
      }
      let copy = this.newFile(sanitize.nonemptylabel(json.name, file.name));
      copy.nodeID = nodeID;
      copy.blobID = file.blobID;
      copy.size = file.size;
      copy.mimetype = file.mimetype;
      copy.lastMod = new Date(file.lastModOnServer ?? file.lastMod);
      copy.lastModOnServer = new Date(copy.lastMod);
      this.files.add(copy);
      await copy.saveLocally();
    }
  }

  async deleteIt() {
    assert(this.nodeID, gt`You cannot delete ${this.name}`);
    await super.deleteIt();
  }

  async deleteOnServer() {
    await this.account.setNodes({
      destroy: [this.nodeID],
      onDestroyRemoveChildren: true,
    });
  }

  /** Also deletes the files on disk */
  async deleteLocally() {
    for (let dir of this.getInclusiveDescendants()) {
      for (let file of dir.files) {
        try {
          await file.deleteLocalCache();
        } catch (ex) {
          this.account.errorCallback(ex);
        }
      }
    }
    await super.deleteLocally();
  }

  /** The server deleted this directory.
   * @param survivor Where to put files that the user changed on disk, so that they are not lost */
  async removedOnServer(survivor: JMAPDirectory) {
    for (let dir of this.getInclusiveDescendants()) {
      for (let file of dir.files.contents) {
        await file.removedOnServer(survivor);
      }
    }
    await this.deleteLocally();
  }

  moveTo(parent: JMAPDirectory) {
    if (parent != this.parent) {
      assert(!parent.getAncestors().contains(this) && parent != this,
        `${this.name}: The server made the directory its own parent or a subdirectory of itself`);
      this.parent?.subDirs.remove(this);
      this.parent = parent;
    }
    if (!parent.subDirs.contains(this)) {
      parent.subDirs.add(this);
    }
    this.path = parent.childPath(this.name, true);
  }

  getInclusiveDescendants(): ArrayColl<JMAPDirectory> {
    let dirs = new ArrayColl<JMAPDirectory>([this]);
    for (let dir of this.subDirs) {
      dirs.addAll(dir.getInclusiveDescendants());
    }
    return dirs;
  }

  getAncestors(): ArrayColl<JMAPDirectory> {
    let ancestors = new ArrayColl<JMAPDirectory>();
    for (let dir = this.parent; dir && !ancestors.contains(dir); dir = dir.parent) {
      ancestors.add(dir);
    }
    return ancestors;
  }

  toExtraJSON(): any {
    let json = super.toExtraJSON();
    json.nodeID = this.nodeID;
    return json;
  }
  fromExtraJSON(json: any) {
    super.fromExtraJSON(json);
    this.nodeID = sanitize.alphanumdash(json?.nodeID, null);
  }
}
