import type { AddonGroup } from "./API/addon";
import { gt } from "../../l10n/l10n";
import { ArrayColl, MapColl } from "svelte-collections";

/** Which app objects an addon can reach with a permission */
export enum AddonObjectScope {
  /** Only the objects that the user acts on: the clicked or shown message, the draft, or the arguments of a hook call */
  Current = "current",
  /** The root collections, e.g. `mustang.mail.accounts`, and everything reachable from them */
  Roots = "roots",
  /** No app objects */
  None = "none",
}

/** What an addon may do. The addon lists the IDs in its `package.json` `mustang.permissions`,
 * and the user grants them during the install. */
export class AddonPermission {
  /** Same string as the `@addon("...")` group that it enables, e.g. "mail.all" */
  readonly id: string;
  /** Shown to the user in the install prompt */
  readonly label: string;
  /** Lets the addon read a lot of the user's data, or send it anywhere */
  readonly risky: boolean;
  /** The `@addon("...")` groups whose members the addon can use */
  readonly apiGroups: ArrayColl<AddonGroup>;
  readonly scope: AddonObjectScope;

  constructor(id: string, label: string, risky: boolean, apiGroups: AddonGroup[], scope: AddonObjectScope) {
    this.id = id;
    this.label = label;
    this.risky = risky;
    this.apiGroups = new ArrayColl(apiGroups);
    this.scope = scope;
  }
}

/** permission ID -> permission */
export const addonPermissions = new MapColl<string, AddonPermission>();
for (let permission of [
  new AddonPermission("mail", gt`Read the messages where you use this addon`, false, ["message", "mail"], AddonObjectScope.Current),
  new AddonPermission("mail.compose", gt`Read and change the message you are writing, when you use this addon or send it`, false, ["message", "mail", "mail.compose"], AddonObjectScope.Current),
  new AddonPermission("mail.all", gt`Read all your mail, in all accounts`, true, ["message", "mail", "mail.all"], AddonObjectScope.Roots),
  new AddonPermission("chat", gt`Read the chat messages where you use this addon`, false, ["message", "chat"], AddonObjectScope.Current),
  new AddonPermission("chat.all", gt`Read all your chats`, true, ["message", "chat", "chat.all"], AddonObjectScope.Roots),
  new AddonPermission("network.any", gt`Connect to any internet server`, true, [], AddonObjectScope.None),
]) {
  addonPermissions.set(permission.id, permission);
}

/** Hook point ID -> the `@addon("...")` group of its arguments, @see `addonHook()` */
export const addonHookPoints = new MapColl<string, AddonGroup>();
addonHookPoints.set("mail.send", "mail.compose");
