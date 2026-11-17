import type { TopicAccount } from "../TopicAccount";
import { AccountType, SQLAccount, type AccountDBRow } from "../../Mail/SQL/Account/SQLAccount";
import { getDatabase } from "./SQLDatabase";
import { newTopicAccountForProtocol } from "../TopicAccounts";
import { SQLTopicStorage } from "./SQLTopicStorage";
import { internalError } from "../../util/error";
import { exMessage } from "../../util/util";
import { ArrayColl } from "svelte-collections";
import sql from "../../../../lib/rs-sqlite";

export class SQLTopicAccount {
  static async save(acc: TopicAccount) {
    await SQLAccount.save(acc, AccountType.Topic);

    if (!acc.dbID) {
      let existing = await (await getDatabase()).get(sql`
        SELECT
          id
        FROM topicAccount
        WHERE
          idStr = ${acc.id}
        `) as any;
      if (existing?.id) {
        acc.dbID = existing.id;
      }
    }
    if (!acc.dbID) {
      let insert = await (await getDatabase()).run(sql`
        INSERT INTO topicAccount (
          idStr, protocol
        ) VALUES (
          ${acc.id}, ${acc.protocol}
        )`);
      acc.dbID = insert.lastInsertRowid;
    }
  }

  /** Also deletes all folders and messages in this account */
  static async deleteIt(acc: TopicAccount) {
    await SQLAccount.deleteIt(acc);
    await (await getDatabase()).run(sql`
      DELETE FROM topicAccount
      WHERE id = ${acc.dbID}
      `);
  }

  static async read(accountRow: AccountDBRow, acc: TopicAccount) {
    await SQLAccount.read(accountRow, acc);

    let row = await (await getDatabase()).get(sql`
      SELECT
        id, protocol
      FROM topicAccount
      WHERE idStr = ${accountRow.idStr}
      `) as any;
    acc.storage = new SQLTopicStorage();
    if (row?.id) {
      acc.dbID = row.id;
    } else {
      // When the type-specific DB has been deleted, but not the accounts DB.
      await SQLTopicAccount.save(acc);
    }
    return acc;
  }

  static async readAll(): Promise<ArrayColl<TopicAccount>> {
    let rows = await SQLAccount.readAll(AccountType.Topic);
    let accounts = new ArrayColl<TopicAccount>();
    for (let row of rows) {
      try {
        let account = newTopicAccountForProtocol(row.protocol);
        await SQLTopicAccount.read(row, account);
        accounts.add(account);
      } catch (ex) {
        internalError(exMessage(ex, `Failed to load ${row.protocol} account (ID ${row.idStr}): ${ex.message}`));
      }
    }
    return accounts;
  }
}
