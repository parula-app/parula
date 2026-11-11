import { MustangApp } from "../AppsBar/MustangApp";
import SettingsIcon from "lucide-svelte/icons/settings";
import { gt } from "../../l10n/l10n";

export class SetupMustangApp extends MustangApp {
  id = "setup";
  get name() {
    return gt`Setup`;
  }
  icon = SettingsIcon;
  appURL = "/setup";
  onBack: () => void = null;
}
