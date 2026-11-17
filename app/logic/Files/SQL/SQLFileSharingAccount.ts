import type { FileSharingAccount } from "../FileSharingAccount";
import { AccountType, SQLAccount, type AccountDBRow } from "../../Mail/SQL/Account/SQLAccount";
import { newFileSharingAccountForProtocol } from "../AccountsList/FileSharingAccounts";
import { getDatabase } from "./SQLDatabase";
import { SQLDirectory } from "./SQLDirectory";
import { SQLFileStorage } from "./SQLFileStorage";
import { internalError } from "../../util/error";
import { assert, exMessage } from "../../util/util";
import { ArrayColl } from "svelte-collections";
import sql from "../../../../lib/rs-sqlite";

/**
 * Persists FileSharingAccount config via the shared `account` table (account.db)
 * AND a row in the local `fileSharingAccount` table (files.db) so that
 * `directory.accountID` has a valid FK target for the file/directory tables.
 */
export class SQLFileSharingAccount {
  static async save(acc: FileSharingAccount): Promise<void> {
    await SQLAccount.save(acc, AccountType.Files);

    if (!acc.dbID) {
      let existing = await (await getDatabase()).get(sql`
        SELECT id FROM fileSharingAccount WHERE idStr = ${acc.id}
        `) as any;
      if (existing?.id) {
        acc.dbID = existing.id;
      }
    }
    if (!acc.dbID) {
      let insert = await (await getDatabase()).run(sql`
        INSERT INTO fileSharingAccount (
          idStr, protocol
        ) VALUES (
          ${acc.id}, ${acc.protocol}
        )`);
      acc.dbID = insert.lastInsertRowid;
    }
  }

  /** Cascades and deletes all directories and files in this account. */
  static async deleteIt(acc: FileSharingAccount): Promise<void> {
    await SQLAccount.deleteIt(acc);
    if (acc.dbID) {
      await (await getDatabase()).run(sql`
        DELETE FROM fileSharingAccount WHERE id = ${acc.dbID}
        `);
    }
  }

  static async read(row: AccountDBRow, acc: FileSharingAccount): Promise<FileSharingAccount> {
    await SQLAccount.read(row, acc);

    let local = await (await getDatabase()).get(sql`
      SELECT id, protocol FROM fileSharingAccount WHERE idStr = ${row.idStr}
      `) as any;
    if (local?.id) {
      assert(local.protocol == acc.protocol, "Protocol in files DB does not match account DB");
      acc.dbID = local.id;
    } else {
      // Recover from a partial wipe: files.db deleted but account.db still has us.
      await SQLFileSharingAccount.save(acc);
    }
    acc.storage = new SQLFileStorage();
    return acc;
  }

  static async readAll(): Promise<ArrayColl<FileSharingAccount>> {
    let rows = await SQLAccount.readAll(AccountType.Files);
    let accounts = new ArrayColl<FileSharingAccount>();
    for (let row of rows) {
      try {
        let acc = newFileSharingAccountForProtocol(row.protocol);
        await SQLFileSharingAccount.read(row, acc);
        await SQLDirectory.readAllHierarchy(acc);
        accounts.add(acc);
      } catch (ex) {
        internalError(exMessage(ex, `Failed to load ${row.protocol} account (ID ${row.idStr}): ${ex.message}`));
      }
    }
    return accounts;
  }
}
