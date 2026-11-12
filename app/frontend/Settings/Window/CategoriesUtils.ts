import type { SettingsCategory } from "../SettingsCategory";
import { accountSettings, settingsCategories } from "../SettingsCategory";
import type { MustangApp } from "../../AppsBar/MustangApp";
import type { Account } from "../../../logic/Abstract/Account";
import { settingsMustangApp } from "./SettingsMustangApp";
import { openApp } from "../../AppsBar/selectedApp";
import { AppWindow } from "../../MainWindow/AppWindow";
import { selectedAccount, selectedCategory } from "./selected";
import { assert } from "../../../logic/util/util";

export function getAllSettingsCategories(): SettingsCategory[] {
  let results: SettingsCategory[] = []
  function processCat(cat: SettingsCategory) {
    results.push(cat);
    for (let subCat of cat.subCategories) {
      processCat(subCat);
    }
  }
  for (let cat of settingsCategories) {
    processCat(cat);
  }
  return results;
}

export function getSettingsCategoryByID(id: string): SettingsCategory {
  return getAllSettingsCategories().find(cat => cat.id == id);
}

export function getSettingsCategoryForApp(app: MustangApp) {
  return getAllSettingsCategories().find(cat => cat.forApp == app);
}

export function openSettingsCategoryForApp(app: MustangApp) {
  openSettingsCategory(getSettingsCategoryForApp(app));
}

export function openSettingsCategoryByID(id: string) {
  openSettingsCategory(getSettingsCategoryByID(id));
}

export function openSettingsCategory(cat: SettingsCategory) {
  AppWindow.current().mainWindow.uiState(selectedCategory).set(cat);
  openApp(settingsMustangApp, {});
}

export function getSettingsCategoryForAccount(account: Account, categoryID = "main") {
  return accountSettings.find(cat => account instanceof cat.type &&
    cat.id == categoryID || categoryID == "main" && cat.isMain);
}

export function openSettingsCategoryForAccount(account: Account, categoryID = "main") {
  let cat = getSettingsCategoryForAccount(account, categoryID);
  assert(cat, "Account not found in settings");
  let appWindow = AppWindow.current().mainWindow;
  appWindow.uiState(selectedAccount).set(account);
  appWindow.uiState(selectedCategory).set(cat);
  // TODO Mobile? goTo(URLPart`/settings/account/${account.id}`, { category, account }); or goTo(URLPart`/settings/account/${account.id}/${category.id}`, { category, account });
  openApp(settingsMustangApp, { category: cat, account: account });
}
