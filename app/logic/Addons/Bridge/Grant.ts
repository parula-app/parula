import type { AddonGroup } from "../API/addon";
import type { HandleEntry, HandleTable } from "./HandleTable";
import { SetColl, type Collection } from "svelte-collections";

/** What an addon may do with the app objects that it got in one situation,
 * e.g. the message where the user clicked the addon's button.
 * App objects that the addon reaches from them get the same grant. */
export class Grant {
  /** The `@addon` groups whose members the addon may use on these objects */
  readonly groups: SetColl<AddonGroup>;
  isRevoked = false;
  /** App object -> its handle under this grant */
  readonly handles = new Map<object, HandleEntry>();
  protected table: HandleTable;

  constructor(table: HandleTable, groups: Collection<AddonGroup>) {
    this.table = table;
    this.groups = new SetColl(groups);
  }

  /** @returns This grant has one of these groups */
  allows(groups: AddonGroup[] | undefined): boolean {
    return !!groups?.some(group => this.groups.contains(group));
  }

  /** The addon can no longer use any of the objects that it got with this grant */
  revoke(): void {
    if (this.isRevoked) {
      return;
    }
    this.isRevoked = true;
    this.table.dropGrant(this);
  }
}
