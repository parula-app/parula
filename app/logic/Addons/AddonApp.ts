import type { Addon, AddonRegistration } from "./Addon";
import type { AddonAppContribution } from "./AddonManifest";
import { ArrayColl } from "svelte-collections";

/** The apps of all running addons */
export const addonApps = new ArrayColl<AddonApp>();

/** An app of a running addon, for the app bar */
export class AddonApp implements AddonRegistration {
  readonly addon: Addon;
  readonly contribution: AddonAppContribution;

  constructor(addon: Addon, contribution: AddonAppContribution) {
    this.addon = addon;
    this.contribution = contribution;
  }

  /** Unique among all apps, e.g. "addon:@example/notes:notes" */
  get id(): string {
    return `addon:${this.addon.id}:${this.contribution.id}`;
  }

  /** Plain text, sanitized */
  get name(): string {
    return this.contribution.name;
  }

  /** Path of the UI module in the addon package, which shows as the whole app */
  get entry(): string {
    return this.contribution.entry;
  }

  /** Path of an SVG file in the addon package */
  get icon(): string | null {
    return this.contribution.icon ?? this.addon.manifest.icon;
  }

  show(): void {
    addonApps.add(this);
  }

  unregister(): void {
    addonApps.remove(this);
  }
}
