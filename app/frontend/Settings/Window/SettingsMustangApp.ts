import { MustangApp } from "../../AppsBar/MustangApp";
import SettingsIcon from "lucide-svelte/icons/settings";
import { gt } from "../../../l10n/l10n";

export class SettingsMustangApp extends MustangApp {
  id = "settings";
  get name() {
    return gt`Settings`;
  }
  icon = SettingsIcon;
  appURL = "/settings";
}

export const settingsMustangApp = new SettingsMustangApp();
