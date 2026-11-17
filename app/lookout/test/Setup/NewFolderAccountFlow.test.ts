// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { newCalendarForProtocol } from "../../../logic/Calendar/AccountsList/Calendars";
import { saveLocalFolderAccount } from "../../Setup/NewFolderAccountFlow";
import { expect, test } from "vitest";

test("Create New Folder saves a calendar on this computer", async () => {
  let config = newCalendarForProtocol("calendar-local");
  config.name = "  Holidays ";
  // No database in tests
  config.save = async () => undefined;
  await saveLocalFolderAccount(config);
  expect(config.name).toBe("Holidays");
  expect(appGlobal.calendars.contains(config)).toBe(true);
});
