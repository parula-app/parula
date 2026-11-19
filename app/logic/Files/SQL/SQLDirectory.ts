import { Directory } from "../Directory";
import type { FileSharingAccount } from "../FileSharingAccount";
import { getDatabase } from "./SQLDatabase";
import { SQLFile } from "./SQLFile";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import sql from "../../../../lib/rs-sqlite";

export class SQLDirectory {
  static async save(dir: Directory): Promise<void> {
    let account = dir.account;
    assert(account?.dbID, "Need account dbID to save directory");
    let parentID = dir.parent?.dbID ?? null;
    let lastMod = Math.floor(dir.lastMod.getTime() / 1000);
    let jsonStr = JSON.stringify(dir.toExtraJSON(), null, 2);

    if (!dir.dbID) {
      let existing = await (await getDatabase()).get(sql`
        SELECT id FROM directory
        WHERE accountID = ${account.dbID} AND path = ${dir.path}
        `) as any;
      if (existing?.id) {
        dir.dbID = existing.id;
      }
    }
    if (!dir.dbID) {
      let insert = await (await getDatabase()).run(sql`
        INSERT INTO directory (
          accountID, parentID, name, path, lastMod, syncState, json
        ) VALUES (
          ${account.dbID}, ${parentID}, ${dir.name}, ${dir.path}, ${lastMod}, ${dir.syncState}, ${jsonStr}
        )`);
      dir.dbID = insert.lastInsertRowid;
    } else {
      await (await getDatabase()).run(sql`
        UPDATE directory SET
          parentID = ${parentID},
          name = ${dir.name},
          path = ${dir.path},
          lastMod = ${lastMod},
          syncState = ${dir.syncState},
          json = ${jsonStr}
        WHERE id = ${dir.dbID}
        `);
    }
  }

  /** Cascades to all files and sub-directories. */
  static async deleteIt(dir: Directory): Promise<void> {
    if (!dir.dbID) {
      return;
    }
    let dbID = dir.dbID;
    dir.dbID = null;
    await (await getDatabase()).run(sql`
      DELETE FROM directory WHERE id = ${dbID}
      `);
  }

  static async read(dbID: number, dir: Directory): Promise<Directory> {
    let row = await (await getDatabase()).get(sql`
      SELECT accountID, parentID, name, path, lastMod, syncState, json
      FROM directory WHERE id = ${dbID}
      `) as any;
    assert(row, `Directory ${dbID} not found in DB`);
    dir.dbID = sanitize.integer(dbID);
    dir.name = sanitize.label(row.name);
    dir.path = sanitize.nonemptystring(row.path);
    dir.lastMod = new Date(sanitize.integer(row.lastMod) * 1000);
    dir.syncState = typeof(row.syncState) == "number"
      ? sanitize.integer(row.syncState, null)
      : sanitize.string(row.syncState, null);
    dir.fromExtraJSON(sanitize.json(row.json, {}) as any);
    return dir;
  }

  /**
   * Loads the full directory tree for an account from the cache.
   * Files in each directory are loaded as well.
   */
  static async readAllHierarchy(account: FileSharingAccount): Promise<void> {
    assert(account.dbID, "Need account dbID to read hierarchy");
    let rows = await (await getDatabase()).all(sql`
      SELECT id, parentID FROM directory WHERE accountID = ${account.dbID}
      `) as any[];

    let readChildren = async (parentID: number | null, parent: Directory | null) => {
      let parentDirs = parent ? parent.subDirs : account.rootDirs;
      let children = rows.filter(row => (row.parentID ?? null) == parentID);
      for (let row of children) {
        if (parentDirs.find(parent => parent.dbID == row.id)) {
          continue;
        }
        let dir = parent ? parent.newDirectory("") : account.newDirectory("");
        await SQLDirectory.read(row.id, dir);
        parentDirs.add(dir);
        await SQLFile.readAll(dir);
        await readChildren(row.id, dir);
      }
    };
    await readChildren(null, null);
  }
}
