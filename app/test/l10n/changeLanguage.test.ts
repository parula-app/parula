// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../logic/app";
import { mailMustangApp } from "../../frontend/Mail/MailMustangApp";
import { settingsCategories } from "../../frontend/Settings/SettingsCategory";
import "../../frontend/Settings/SettingsCategories";
import { SpecialFolder, specialFolderNames } from "../../logic/Mail/Folder";
import { myHarddrive } from "../../logic/Files/Harddrive/HarddriveAccount";
import { gt, setUILocale } from "../../l10n/l10n";
import { get } from "svelte/store";
import { afterEach, expect, test } from "vitest";

afterEach(() => {
  setUILocale("en");
});

test("Strings from .ts modules follow the language change", () => {
  setUILocale("en");
  expect(mailMustangApp.name).toBe("Mail");
  expect(specialFolderNames[SpecialFolder.Inbox]).toBe("Inbox");
  let appTitle = get(mailMustangApp.title);

  setUILocale("de");
  expect(gt`Mail`).not.toBe("Mail");
  expect(mailMustangApp.name).toBe(gt`Mail`);
  expect(get(mailMustangApp.title)).not.toBe(appTitle);
  expect(specialFolderNames[SpecialFolder.Inbox]).toBe(gt`Inbox`);
  expect(settingsCategories.find(category => category.id == "mail").name).toBe(gt`Mail`);
  expect(myHarddrive.name).toBe(gt`My computer *=> My local harddrives`);
});
