import { getDatabase as getDatabaseMail } from "../SQLDatabase";
import { getDatabase as getDatabaseContacts } from "../../../Contacts/SQL/SQLDatabase";
import { getDatabase as getDatabaseCalendar } from "../../../Calendar/SQL/SQLDatabase";
import { appGlobal } from "../../../app";
import sql from "../../../../../lib/rs-sqlite/index";
import { PersonUID } from "../../../Abstract/PersonUID";
import { sleep } from "../../../util/util";
import { getConfigDir, getFilesDir } from "../../../util/backend-wrapper";

export async function migrateToAccountsDB(): Promise<void> {
  let rows: any[];
  try {
    rows = await (await getDatabaseMail()).all(sql`
      SELECT
        username
      FROM emailAccount
      `) as any[];
  } catch (ex) {
    if (ex?.message?.startsWith("no such column")) {
      // DB is the new version, all good
      return;
    } else {
      // Other problem
      throw ex;
    }
  }

  let contacts = await (await getDatabaseContacts()).all(sql`SELECT id from person where addressbookID = 1;`);
  let events = await (await getDatabaseCalendar()).all(sql`SELECT id from event where calendarID = 1;`);

  if (localStorage.getItem("migrate.sql1") == "cancel") {
    return;
  }
  let configDir = await getConfigDir();
  let filesDir = await getFilesDir();
  if (contacts?.length || events?.length) {
    let homeDir = await appGlobal.remoteApp.directory("home");
    let contactsDBFile = await appGlobal.remoteApp.path.join(homeDir, "contacts.db");
    let calendarDBFile = await appGlobal.remoteApp.path.join(homeDir, "calendar.db");
    await appGlobal.remoteApp.fs.cp(contactsDBFile, homeDir).catch(console.error);
    await appGlobal.remoteApp.fs.cp(calendarDBFile, homeDir).catch(console.error);
  }
  let question = filesDir == configDir
    ? "Delete " + configDir + " ?"
    : "Delete \n" + configDir + " and \n" + filesDir + " ?";
  let ok = confirm(`Dear beta user, thanks for testing Parula.

Unfortunately, we have to make a database change. We decided to avoid database migration for now and instead re-create the database. We're sorry for the inconvenience. The purpose of this database change is in fact to have a more stable database, so that we will hopefully not have to do this again. In fact, this is one of the last steps to get stable and ready to release. Thank you for your understanding. Please simply re-add your accounts.

${question}`);
  if (ok) {
    await appGlobal.remoteApp.fs.rm(configDir, { recursive: true, force: true }).catch(console.log);
    if (filesDir != configDir) {
      await appGlobal.remoteApp.fs.rm(filesDir, { recursive: true, force: true }).catch(console.log);
    }
  } else {
    localStorage.setItem("migrate.sql1", "cancel");
    let account = appGlobal.emailAccounts.first;
    if (account) {
      let email = account.newEMailFrom();
      email.to.add(new PersonUID("parula.support@beonex.com", "Parula support"));
      email.subject = "Could not migrate";
      email.text = "Dear support, please help me with the migration";
      await email.compose.send();
    }
  }

  await appGlobal.remoteApp.restartApp();
  await sleep(1);
}
