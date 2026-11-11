import type { Addon } from "./Addon";
import { UserError, removeControlCharacters } from "../util/util";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { gt } from "../../l10n/l10n";

/** An addon stopped an app function, e.g. sending a message, and tells the user why */
export class AddonCancelError extends UserError {
  /** @param reason From the addon. Untrusted. */
  constructor(addon: Addon, reason: string) {
    const kMaxLength = 200;
    let text = removeControlCharacters(reason.substring(0, kMaxLength)).trim();
    super(`${addon.name}: ${sanitize.nonemptylabel(text, gt`Cancelled`)}`);
  }
}
