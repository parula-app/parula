// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { setupTestFolder } from "./setup";
import { SQLSearchEMail } from "../../../../logic/Mail/SQL/SQLSearchEMail";
import { beforeAll, expect, test } from "vitest";

beforeAll(async () => {
  await setupTestFolder();
});

test("Searching before the user set up a mail account finds nothing", async () => {
  expect(appGlobal.emailAccounts.isEmpty).toBe(true);
  let search = new SQLSearchEMail(); // as the Files pane does, to list the persons who sent us files
  search.hasAttachment = true;

  let emails = await search.startSearch();

  expect(emails.isEmpty).toBe(true);
});
