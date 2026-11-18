import { availableTags, getTagByName, saveTagsList, type Tag } from "../../Abstract/Tag";
import type { ExchangeMailAccount } from "./ExchangeMailAccount";
import { Lock } from "../../util/flow/Lock";
import { AbstractFunction } from "../../util/util";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

/** The tags that the Exchange mailbox knows, with their colors.
 * Exchange calls them categories. A mail has only the names of its tags.
 * Shared mailboxes use the tags of the main account.
 *
 * Protocols that support it override `supported`, `loadFromServer()` and `addOnServer()`. */
export class ExchangeTags {
  readonly account: ExchangeMailAccount;
  /** Lowercase names of the tags on the server. Exchange compares the names case-insensitive. */
  protected names = new Set<string>();
  /** Tagging several mails at once must add the tag only once */
  protected lock = new Lock();

  constructor(account: ExchangeMailAccount) {
    this.account = account;
  }

  /** ActiveSync has no command for the tags of the mailbox, only the tags on the mails */
  get supported(): boolean {
    return false;
  }

  /** Reads the tags from the server and adds them, with their colors, to `availableTags`.
   * Never removes local tags, because `availableTags` is shared by all accounts. */
  async load(): Promise<void> {
    if (!this.supported || this.account.isDependentAccount) {
      return;
    }
    let serverTags = (await this.loadFromServer())
      .map(serverTag => ({
        name: sanitize.nonemptylabel(serverTag.name, null),
        color: this.colorFromServer(serverTag.color),
      }))
      .filter(serverTag => serverTag.name);
    this.names = new Set(serverTags.map(serverTag => serverTag.name.toLowerCase()));
    let changed = false;
    for (let { name, color } of serverTags) {
      let tag = getTagByName(name, false);
      if (!availableTags.contains(tag)) {
        availableTags.add(tag);
        changed = true;
      }
      if (color && tag.color != color) {
        tag.color = color;
        changed = true;
      }
    }
    if (changed) {
      await saveTagsList();
    }
  }

  /** Adds the tag to the server, unless the server has it already */
  async add(tag: Tag): Promise<void> {
    if (this.account.isDependentAccount) {
      await (this.account.mainAccount as ExchangeMailAccount).tags.add(tag);
      return;
    }
    let name = tag.name.toLowerCase();
    // Exchange doesn't allow commas in category names
    if (!this.supported || name.includes(",")) {
      return;
    }
    let lock = await this.lock.lock();
    try {
      if (this.names.has(name)) {
        return;
      }
      await this.addOnServer(tag);
      this.names.add(name);
    } finally {
      lock.release();
    }
  }

  /** @returns the tags as the server has them, with `color` = index in `kColors`. `load()` sanitizes them. */
  protected async loadFromServer(): Promise<{ name: string, color: number | string }[]> {
    throw new AbstractFunction();
  }

  /** Adds the tag to the server, unless somebody else added it meanwhile */
  protected async addOnServer(tag: Tag): Promise<void> {
    throw new AbstractFunction();
  }

  /** @param color index in `kColors`, -1 = no color
   * @returns hex color, or null for no color */
  colorFromServer(color: number | string): string | null {
    return ExchangeTags.kColors[sanitize.integerRange(color, -1, ExchangeTags.kColors.length - 1, -1)] ?? null;
  }

  /** @param hex color of a tag, e.g. "#4AB63F"
   * @returns index of the nearest color in `kColors`, -1 = no color */
  colorToServer(hex: string): number {
    let rgb = this.hexToRGB(hex);
    if (!rgb) {
      return -1;
    }
    let nearest = -1;
    let nearestDistance = Infinity;
    ExchangeTags.kColors.forEach((serverHex, index) => {
      let distance = this.hexToRGB(serverHex).reduce((sum, value, i) => sum + (value - rgb[i]) ** 2, 0);
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    });
    return nearest;
  }

  protected hexToRGB(hex: string): number[] | null {
    if (hex?.length != 7 || !hex.startsWith("#")) {
      return null;
    }
    let rgb = [1, 3, 5].map(i => Number("0x" + hex.substring(i, i + 2)));
    return rgb.some(isNaN) ? null : rgb;
  }

  /** Exchange's colors 0 to 24, as MS-OXOCFG 2.2.5.2.2 defines them. Each client renders them slightly differently. */
  static readonly kColors = [
    "#D6252E", "#F06C15", "#FFCA4C", "#FFFE3D", "#4AB63F",
    "#40BD95", "#859A52", "#3267B8", "#613DB4", "#A34E78",
    "#C4CCDD", "#8C9CBD", "#C4C4C4", "#A5A5A5", "#1C1C1C",
    "#AF1E25", "#B14F0D", "#AB7B05", "#999400", "#35792B",
    "#2E7D64", "#5F6C3A", "#2A5191", "#50328F", "#82375F",
  ];
}
