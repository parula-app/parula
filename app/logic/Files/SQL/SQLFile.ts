import { File } from "../File";
import type { Directory } from "../Directory";
import { getDatabase } from "./SQLDatabase";
import { getFilesDir } from "../../util/backend-wrapper";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import sql from "../../../../lib/rs-sqlite";

type WithServerURL = { serverURL?: string | null };

export class SQLFile {
  static async save(file: File): Promise<void> {
    let directory = file.parent;
    assert(directory?.dbID, "Need parent directory dbID to save file");
    let lastMod = Math.floor(file.lastMod.getTime() / 1000);
    let lastModOnserver = Math.floor(file.lastModOnServer.getTime() / 1000);
    let serverURL = (file as File & WithServerURL).serverURL ?? null;
    filesDir ??= await getFilesDir();
    let pathLocal = file.filepathLocal?.replace(`${filesDir}/files/cloud/${file.account.id}/`, "");
    let jsonStr = JSON.stringify(file.toExtraJSON(), null, 2);

    if (!file.dbID) {
      let existing = await (await getDatabase()).get(sql`
        SELECT id FROM file
        WHERE directoryID = ${directory.dbID} AND path = ${file.path}
        `) as any;
      if (existing?.id) {
        file.dbID = existing.id;
      }
    }
    if (!file.dbID) {
      let insert = await (await getDatabase()).run(sql`
        INSERT INTO file (
          directoryID, name, path, pathLocal, size,
          mimetype, lastMod, lastModOnServer, syncState, serverURL, json
        ) VALUES (
          ${directory.dbID}, ${file.name}, ${file.path}, ${pathLocal}, ${file.size},
          ${file.mimetype}, ${lastMod}, ${lastModOnserver}, ${file.syncState}, ${serverURL},
          ${jsonStr}
        )`);
      file.dbID = insert.lastInsertRowid;
    } else {
      await (await getDatabase()).run(sql`
        UPDATE file SET
          name = ${file.name}, path = ${file.path}, pathLocal = ${pathLocal},
          size = ${file.size}, mimetype = ${file.mimetype},
          lastMod = ${lastMod}, lastModOnServer = ${lastModOnserver},
          syncState = ${file.syncState}, serverURL = ${serverURL}, json = ${jsonStr}
        WHERE id = ${file.dbID}
        `);
    }
  }

  static async deleteIt(file: File): Promise<void> {
    if (!file.dbID) {
      return;
    }
    let dbID = file.dbID;
    file.dbID = null;
    await (await getDatabase()).run(sql`
      DELETE FROM file WHERE id = ${dbID}
      `);
  }

  static async read(dbID: number, file: File): Promise<File> {
    let row = await (await getDatabase()).get(sql`
      SELECT name, path, pathLocal, size, mimetype, lastMod, lastModOnServer,
        syncState, serverURL, json
      FROM file WHERE id = ${dbID}
      `) as any;
    assert(row, `File ${dbID} not found in DB`);
    file.dbID = sanitize.integer(dbID);
    SQLFile.readRow(row, file);
    return file;
  }

  static readRow(row: any, file: File) {
    file.setFileName(sanitize.filename(row.name));
    file.path = sanitize.nonemptystring(row.path);
    file.filepathLocal = row.pathLocal ? `${filesDir}/files/cloud/${file.account.id}/${sanitize.dirname(row.pathLocal)}` : null;
    file.size = sanitize.integerRange(row.size, 0, Number.MAX_SAFE_INTEGER, 0);
    file.mimetype = sanitize.string(row.mimetype, "");
    file.lastMod = sanitize.date(sanitize.integer(row.lastMod, null) * 1000, new Date());
    file.lastModOnServer = sanitize.date(sanitize.integer(row.lastModOnServer, null) * 1000, new Date());
    file.syncState = typeof(row.syncState) == "number"
      ? sanitize.integer(row.syncState, null)
      : sanitize.string(row.syncState, null);
    (file as File & WithServerURL).serverURL = sanitize.url(row.serverURL, null);
    file.fromExtraJSON(sanitize.json(row.json, {}) as any);
  }

  /** Populates a `directory` with all its files from the cache. */
  static async readAll(directory: Directory): Promise<void> {
    assert(directory.dbID, "Need directory dbID to read files");
    filesDir ??= await getFilesDir();
    let rows = await (await getDatabase()).all(sql`
      SELECT id, name, path, pathLocal, size, mimetype, lastMod, lastModOnServer,
        syncState, serverURL, json
      FROM file WHERE directoryID = ${directory.dbID}
      `) as any[];
    for (let row of rows) {
      let id = sanitize.integer(row.id);
      if (directory.files.find(file => file.dbID == id)) {
        continue;
      }
      let file = directory.newFile("");
      file.dbID = id;
      SQLFile.readRow(row, file);
      directory.files.add(file);
    }
  }
}

let filesDir: string = null;
