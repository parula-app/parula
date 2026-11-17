import type { Addressbook } from "../Addressbook";
import { AccountType, SQLAccount, type AccountDBRow } from "../../Mail/SQL/Account/SQLAccount";
import { getDatabase } from "./SQLDatabase";
import { newAddressbookForProtocol } from "../AccountsList/Addressbooks";
import { SQLAddressbookStorage } from "./SQLAddressbookStorage";
import { internalError } from "../../util/error";
import { exMessage } from "../../util/util";
import { ArrayColl } from "svelte-collections";
import sql from "../../../../lib/rs-sqlite";

export class SQLAddressbook {
  static async save(acc: Addressbook) {
    await SQLAccount.save(acc, AccountType.Addressbook);

    if (!acc.dbID) {
      let existing = await (await getDatabase()).get(sql`
        SELECT
          id
        FROM addressbook
        WHERE
          idStr = ${acc.id}
        `) as any;
      if (existing?.id) {
        acc.dbID = existing.id;
      }
    }
    if (!acc.dbID) {
      let insert = await (await getDatabase()).run(sql`
        INSERT INTO addressbook (
          idStr, protocol
        ) VALUES (
          ${acc.id}, ${acc.protocol}
        )`);
      acc.dbID = insert.lastInsertRowid;
    }
  }

  /** Also deletes all persons and groups in this address book */
  static async deleteIt(acc: Addressbook) {
    await SQLAccount.deleteIt(acc);
    await (await getDatabase()).run(sql`
      DELETE FROM addressbook
      WHERE id = ${acc.dbID}
      `);
  }

  static async read(accountRow: AccountDBRow, acc: Addressbook) {
    await SQLAccount.read(accountRow, acc);

    let row = await (await getDatabase()).get(sql`
      SELECT
        id, protocol
      FROM addressbook
      WHERE idStr = ${accountRow.idStr}
      `) as any;
    if (row?.id) {
      acc.dbID = row.id;
    } else {
      // When the type-specific DB has been deleted, but not the accounts DB.
      await SQLAddressbook.save(acc);
    }
    acc.storage = new SQLAddressbookStorage();
    return acc;
  }

  static async readAll(): Promise<ArrayColl<Addressbook>> {
    let rows = await SQLAccount.readAll(AccountType.Addressbook);
    let accounts = new ArrayColl<Addressbook>();
    for (let row of rows) {
      try {
        let account = newAddressbookForProtocol(row.protocol);
        await SQLAddressbook.read(row, account);
        accounts.add(account);
      } catch (ex) {
        internalError(exMessage(ex, `Failed to load ${row.protocol} account (ID ${row.idStr}): ${ex.message}`));
      }
    }
    return accounts;
  }
}
