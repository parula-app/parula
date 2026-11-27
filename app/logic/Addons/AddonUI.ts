import type { Addon, AddonRegistration } from "./Addon";
import type { AddonSandbox } from "./AddonSandbox";
import type { AddonUIContribution } from "./AddonManifest";
import type { AddonBridge, AddonService } from "./Bridge/AddonBridge";
import type { Grant } from "./Bridge/Grant";
import type { AddonGroup } from "./API/addon";
import { UserError } from "../util/util";
import { gt } from "../../l10n/l10n";
import { ArrayColl, SetColl } from "svelte-collections";

/** The buttons, menu items and panels of all running addons */
export const addonUIItems = new ArrayColl<AddonUIItem>();

/** A button, menu item or panel of a running addon, at its place in the app */
export class AddonUIItem {
  readonly ui: AddonUI;
  readonly contribution: AddonUIContribution;
  /** What the addon may do with the objects that it gets at this place */
  readonly groups: AddonGroup[];

  constructor(ui: AddonUI, contribution: AddonUIContribution) {
    this.ui = ui;
    this.contribution = contribution;
    this.groups = contribution.place == "composer-toolbar"
      ? ["message", "mail", "mail.compose"]
      : ["message", "mail"];
  }

  get addon(): Addon {
    return this.ui.addon;
  }

  /** e.g. "message-toolbar" */
  get place(): string {
    return this.contribution.place;
  }

  /** Plain text, sanitized */
  get label(): string {
    return this.contribution.label ?? this.addon.name;
  }
}

/** `mustang.ui` of one running addon: its buttons, menu items and panels in the app,
 * and the commands that its main code handles */
export class AddonUI implements AddonService, AddonRegistration {
  readonly sandbox: AddonSandbox;
  readonly items = new ArrayColl<AddonUIItem>();
  /** The commands for which the main code has a handler */
  readonly commands = new SetColl<string>();

  constructor(sandbox: AddonSandbox) {
    this.sandbox = sandbox;
  }

  get addon(): Addon {
    return this.sandbox.addon;
  }

  /** Adds the buttons, menu items and panels of the addon to their places.
   * Only where the addon has the permission for what the place gives it. */
  show(): void {
    for (let contribution of this.addon.manifest.ui) {
      let item = new AddonUIItem(this, contribution);
      if (item.groups.every(group => this.addon.apiGroups.contains(group))) {
        this.items.add(item);
      }
    }
    addonUIItems.addAll(this.items);
  }

  unregister(): void {
    addonUIItems.removeAll(this.items);
    this.items.clear();
    this.commands.clear();
  }

  /** `mustang.ui.onCommand()` */
  call(bridge: AddonBridge, method: string, args: unknown[]): void {
    if (method != "onCommand") {
      throw new Error("Unknown method");
    }
    if (bridge != this.sandbox.logicFrame?.bridge) {
      throw new Error("Only the main code of the addon can handle commands");
    }
    let command = args[0];
    if (typeof command != "string" || !this.addon.manifest.ui.some(contribution => contribution.command == command)) {
      throw new Error("The manifest has no button or menu item with this command");
    }
    this.commands.add(command);
  }

  /** For the objects of one click on a button or menu item of the addon
   * @param groups What the place allows the addon to do with them */
  newGrant(groups: AddonGroup[]): Grant {
    let bridge = this.sandbox.logicFrame?.bridge;
    if (!bridge) {
      throw new Error(`The addon ${this.addon.name} has no main code`);
    }
    return bridge.newGrant(groups);
  }

  /** Sends the user's click on `item` to the main code of the addon
   * @param args `{ messages }` or `{ draft }`. The addon gets them under `grant`.
   * @throws when the command failed in the addon */
  async runCommand(item: AddonUIItem, args: Record<string, unknown>, grant: Grant): Promise<void> {
    const kMaxReasonLength = 200;
    let command = item.contribution.command;
    if (!this.commands.contains(command)) {
      throw new UserError(gt`The addon ${this.addon.name} can't do ${item.label} right now`);
    }
    try {
      await this.sandbox.logicFrame.bridge.request("ui", "command", args, grant, { command });
    } catch (ex) {
      let reason = String(ex?.message).substring(0, kMaxReasonLength);
      throw new UserError(gt`The addon ${this.addon.name} failed to do ${item.label}: ${reason}`);
    }
  }
}
