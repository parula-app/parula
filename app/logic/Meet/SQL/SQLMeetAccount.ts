import type { MeetAccount } from "../MeetAccount";
import { AccountType, SQLAccount, type AccountDBRow } from "../../Mail/SQL/Account/SQLAccount";
import { getDatabase } from "./SQLDatabase";
import { SQLMeetStorage } from "./SQLMeetStorage";
import { newMeetAccountForProtocol } from "../AccountsList/MeetAccounts";
import { internalError } from "../../util/error";
import { exMessage } from "../../util/util";
import { ArrayColl } from "svelte-collections";
import sql from "../../../../lib/rs-sqlite";

export class SQLMeetAccount {
  static async save(acc: MeetAccount) {
    await SQLAccount.save(acc, AccountType.Meet);

    if (!acc.dbID) {
      let existing = await (await getDatabase()).get(sql`
        SELECT
          id
        FROM meetAccount
        WHERE
          idStr = ${acc.id}
        `) as any;
      if (existing?.id) {
        acc.dbID = existing.id;
      }
    }
    if (!acc.dbID) {
      let insert = await (await getDatabase()).run(sql`
        INSERT INTO meetAccount (
          idStr, protocol
        ) VALUES (
          ${acc.id}, ${acc.protocol}
        )`);
      acc.dbID = insert.lastInsertRowid;
    }
  }

  /** Also deletes all persons and groups in this address book */
  static async deleteIt(acc: MeetAccount) {
    await SQLAccount.deleteIt(acc);
    await (await getDatabase()).run(sql`
      DELETE FROM meetAccount
      WHERE id = ${acc.dbID}
      `);
  }

  static async read(accountRow: AccountDBRow, acc: MeetAccount) {
    await SQLAccount.read(accountRow, acc);

    let row = await (await getDatabase()).get(sql`
      SELECT
        id, protocol
      FROM meetAccount
      WHERE idStr = ${accountRow.idStr}
      `) as any;
    if (row?.id) {
      acc.dbID = row.id;
    } else {
      // When the type-specific DB has been deleted, but not the accounts DB.
      await SQLMeetAccount.save(acc);
    }
    acc.storage = new SQLMeetStorage();
    return acc;
  }

  static async readAll(): Promise<ArrayColl<MeetAccount>> {
    let rows = await SQLAccount.readAll(AccountType.Meet);
    let accounts = new ArrayColl<MeetAccount>();
    for (let row of rows) {
      try {
        let account = newMeetAccountForProtocol(row.protocol);
        await SQLMeetAccount.read(row, account);
        accounts.add(account);
      } catch (ex) {
        internalError(exMessage(ex, `Failed to load ${row.protocol} account (ID ${row.idStr}): ${ex.message}`));
      }
    }
    return accounts;
  }
}
