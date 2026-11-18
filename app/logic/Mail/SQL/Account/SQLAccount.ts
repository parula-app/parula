import type { Account } from "../../../Abstract/Account";
import { getDatabase } from "./SQLDatabase";
import { passwordDecrypt, passwordEncrypt, passwordEncryptAgain } from "../../../Auth/passwordEncrypt";
import { sanitize } from "../../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../../util/util";
import sql from "../../../../../lib/rs-sqlite";

export class SQLAccount {
  static async save(acc: Account, type: AccountType) {
    let json = acc.toConfigJSON();
    json.passwordEncrypted = await passwordEncrypt(acc.password);
    // acc.oAuth2.refreshToken changes every few minutes, so should not save in configJSON
    let jsonStr = JSON.stringify(json, null, 2);

    let existing = await (await getDatabase()).get(sql`
      SELECT
        protocol
      FROM account
      WHERE
        idStr = ${acc.id}
      `) as any;
    if (!existing) {
      await (await getDatabase()).run(sql`
        INSERT INTO account (
          idStr, type, protocol, mainAccountIDStr, json
        ) VALUES (
          ${acc.id}, ${type}, ${acc.protocol}, ${acc.mainAccount?.id ?? acc._mainAccountID},
          ${jsonStr}
        )`);
    } else {
      assert(existing.protocol == acc.protocol, "Protocol in accounts DB does not match");
      await (await getDatabase()).run(sql`
        UPDATE account SET
          mainAccountIDStr = ${acc.mainAccount?.id ?? acc._mainAccountID},
          json = ${jsonStr}
        WHERE idStr = ${acc.id}
        `);
    }
  }

  /** Also deletes all folders and messages in this account */
  static async deleteIt(account: Account) {
    assert(account.dbID, "Need account DB ID to delete");
    await (await getDatabase()).run(sql`
      DELETE FROM account
      WHERE idStr = ${account.id}
      `);
  }

  static async read(row: AccountDBRow, acc: Account) {
    assert(row.idStr, "Need account ID to read it");
    assert(row.protocol == acc.protocol, "Protocol doesn't match between the 2 databases");
    // Note: acc.dbID and acc.storage are not yet set
    let json = sanitize.json(row.json, {});
    json.id = row.idStr;
    acc.fromConfigJSON(json);
    acc.password = await passwordDecrypt(json.passwordEncrypted);
    // Older versions only obfuscated the password
    let encryptedAgain = await passwordEncryptAgain(json.passwordEncrypted, acc.password);
    if (encryptedAgain) {
      await (await getDatabase()).run(sql`
        UPDATE account SET
          json = json_set(json, '$.passwordEncrypted', ${encryptedAgain})
        WHERE idStr = ${row.idStr}
        `);
    }
    acc._mainAccountID = sanitize.alphanumdash(row.mainAccountIDStr, null);
    return acc;
  }

  /**
   * Called by SQLMailAccount.readAll() etc.
   */
  static async readAll(type: AccountType): Promise<AccountDBRow[]> {
    let rows = await (await getDatabase()).all(sql`
      SELECT
        idStr, protocol, json, mainAccountIDStr
      FROM account
      WHERE type = ${type}
      `) as AccountDBRow[];
    return rows;
  }
}

export enum AccountType {
  Mail = 1,
  Chat = 2,
  Addressbook = 3,
  Calendar = 4,
  Files = 5,
  Apps = 6,
  Meet = 7,
  Topic = 8,
}

export type AccountDBRow = {
  idStr: string;
  protocol: string;
  json: string;
  mainAccountIDStr: string;
}
