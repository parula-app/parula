import type { ChatAccount } from "../ChatAccount";
import { AccountType, SQLAccount, type AccountDBRow } from "../../Mail/SQL/Account/SQLAccount";
import { getDatabase } from "./SQLDatabase";
import { newChatAccountForProtocol } from "../AccountsList/ChatAccounts";
import { SQLChatStorage } from "./SQLChatStorage";
import { internalError } from "../../util/error";
import { exMessage } from "../../util/util";
import { ArrayColl } from "svelte-collections";
import sql from "../../../../lib/rs-sqlite";

export class SQLChatAccount {
  static async save(acc: ChatAccount) {
    await SQLAccount.save(acc, AccountType.Chat);

    if (!acc.dbID) {
      let existing = await (await getDatabase()).get(sql`
        SELECT
          id
        FROM chatAccount
        WHERE
          idStr = ${acc.id}
        `) as any;
      if (existing?.id) {
        acc.dbID = existing.id;
      }
    }
    if (!acc.dbID) {
      let insert = await (await getDatabase()).run(sql`
        INSERT INTO chatAccount (
          idStr, protocol
        ) VALUES (
          ${acc.id}, ${acc.protocol}
        )`);
      acc.dbID = insert.lastInsertRowid;
    }
  }

  /** Also deletes all folders and messages in this account */
  static async deleteIt(acc: ChatAccount) {
    await SQLAccount.deleteIt(acc);
    await (await getDatabase()).run(sql`
      DELETE FROM chatAccount
      WHERE id = ${acc.dbID}
      `);
  }

  static async read(accountRow: AccountDBRow, acc: ChatAccount) {
    await SQLAccount.read(accountRow, acc);

    let row = await (await getDatabase()).get(sql`
      SELECT
        id, protocol
      FROM chatAccount
      WHERE idStr = ${accountRow.idStr}
      `) as any;
    acc.storage = new SQLChatStorage();
    if (row?.id) {
      acc.dbID = row.id;
    } else {
      // When the type-specific DB has been deleted, but not the accounts DB.
      await SQLChatAccount.save(acc);
    }
    return acc;
  }

  static async readAll(): Promise<ArrayColl<ChatAccount>> {
    let rows = await SQLAccount.readAll(AccountType.Chat);
    let accounts = new ArrayColl<ChatAccount>();
    for (let row of rows) {
      try {
        let account = newChatAccountForProtocol(row.protocol);
        await SQLChatAccount.read(row, account);
        accounts.add(account);
      } catch (ex) {
        internalError(exMessage(ex, `Failed to load ${row.protocol} account (ID ${row.idStr}): ${ex.message}`));
      }
    }
    return accounts;
  }
}
