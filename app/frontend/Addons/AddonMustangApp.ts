import { MustangApp } from "../AppsBar/MustangApp";
import { mustangApps, openApp, selectedApp } from "../AppsBar/selectedApp";
import { mailMustangApp } from "../Mail/MailMustangApp";
import { settingsMustangApp } from "../Settings/Window/SettingsMustangApp";
import type { Addon } from "../../logic/Addons/Addon";
import { addonApps, type AddonApp } from "../../logic/Addons/AddonApp";
import { minorError, showError } from "../Util/error";
import PuzzleIcon from "lucide-svelte/icons/puzzle";
import { ArrayColl } from "svelte-collections";
import { get } from "svelte/store";

/** An app that an addon adds to the app bar. Its page is a UI module of the addon. */
export class AddonMustangApp extends MustangApp {
  readonly addonApp: AddonApp;

  constructor(addonApp: AddonApp) {
    super();
    this.addonApp = addonApp;
    this.id = addonApp.id;
    this.name = addonApp.name;
    this.icon = PuzzleIcon;
    this.appURL = `/addon-app/${encodeURIComponent(addonApp.addon.id)}/${addonApp.contribution.id}`;
  }

  get addon(): Addon {
    return this.addonApp.addon;
  }

  async loadIcon(): Promise<void> {
    if (!this.addonApp.icon) {
      return;
    }
    try {
      this.icon = new URL(await this.addon.iconURL(this.addonApp.icon));
    } catch (ex) {
      minorError(ex);
    }
  }

  revokeIcon(): void {
    if (this.icon instanceof URL) {
      URL.revokeObjectURL(this.icon.href);
    }
  }
}

/** The apps of the running addons, in the app bar */
class AddonMustangApps extends ArrayColl<AddonMustangApp> {
  constructor() {
    super();
    addonApps.registerObserver(this);
    this.added(addonApps.contents);
  }

  /** Puts the addon apps before Settings */
  insertInto(target: ArrayColl<MustangApp>, apps: AddonMustangApp[] = this.contents): void {
    let settingsPos = target.indexOf(settingsMustangApp);
    target.splice(settingsPos < 0 ? target.length : settingsPos, 0, ...apps);
  }

  /** Observes `addonApps` */
  added(apps: AddonApp[]) {
    for (let addonApp of apps) {
      this.show(addonApp)
        .catch(showError);
    }
  }

  removed(apps: AddonApp[]) {
    for (let app of this.contents.filter(app => apps.includes(app.addonApp))) {
      this.hide(app);
    }
  }

  protected async show(addonApp: AddonApp): Promise<void> {
    let app = new AddonMustangApp(addonApp);
    // The app bar shows the icon that the app has when it's added
    await app.loadIcon();
    if (!addonApps.includes(addonApp)) {
      app.revokeIcon();
      return;
    }
    this.add(app);
    this.insertInto(mustangApps, [app]);
  }

  /** If the app is open, the window shows Mail instead */
  protected hide(app: AddonMustangApp): void {
    this.remove(app);
    mustangApps.remove(app);
    if (get(selectedApp) == app) {
      openApp(mailMustangApp, {});
    }
    app.revokeIcon();
  }
}

export const addonMustangApps = new AddonMustangApps();
