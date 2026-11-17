import type { Calendar } from "../Calendar";
import { AccountType, SQLAccount, type AccountDBRow } from "../../Mail/SQL/Account/SQLAccount";
import { getDatabase } from "./SQLDatabase";
import { newCalendarForProtocol } from "../AccountsList/Calendars";
import { SQLCalendarStorage } from "./SQLCalendarStorage";
import { internalError } from "../../util/error";
import { exMessage } from "../../util/util";
import { ArrayColl } from "svelte-collections";
import sql from "../../../../lib/rs-sqlite";

export class SQLCalendar {
  static async save(cal: Calendar) {
    await SQLAccount.save(cal, AccountType.Calendar);

    if (!cal.dbID) {
      let existing = await (await getDatabase()).get(sql`
        SELECT
          id
        FROM calendar
        WHERE
          idStr = ${cal.id}
        `) as any;
      if (existing?.id) {
        cal.dbID = existing.id;
      }
    }
    if (!cal.dbID) {
      let insert = await (await getDatabase()).run(sql`
        INSERT INTO calendar (
          idStr, protocol
        ) VALUES (
          ${cal.id}, ${cal.protocol}
        )`);
      cal.dbID = insert.lastInsertRowid;
    }
  }

  /** Also deletes all persons and groups in this address book */
  static async deleteIt(cal: Calendar) {
    await SQLAccount.deleteIt(cal);
    await (await getDatabase()).run(sql`
      DELETE FROM calendar
      WHERE id = ${cal.dbID}
      `);
  }

  static async read(accountRow: AccountDBRow, cal: Calendar) {
    await SQLAccount.read(accountRow, cal);

    let row = await (await getDatabase()).get(sql`
      SELECT
        id, protocol
      FROM calendar
      WHERE idStr = ${accountRow.idStr}
      `) as any;
    if (row?.id) {
      cal.dbID = row.id;
    } else {
      // When the type-specific DB has been deleted, but not the accounts DB.
      await SQLCalendar.save(cal);
    }
    cal.storage = new SQLCalendarStorage();
    return cal;
  }

  static async readAll(): Promise<ArrayColl<Calendar>> {
    let rows = await SQLAccount.readAll(AccountType.Calendar);
    let calendars = new ArrayColl<Calendar>();
    for (let row of rows) {
      try {
        let calendar = newCalendarForProtocol(row.protocol);
        await SQLCalendar.read(row, calendar);
        calendars.add(calendar);
      } catch (ex) {
        internalError(exMessage(ex, `Failed to load ${row.protocol} account (ID ${row.idStr}): ${ex.message}`));
      }
    }
    return calendars;
  }
}
