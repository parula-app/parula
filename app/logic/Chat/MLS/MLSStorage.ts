/** How MLS reaches the application's database, RFC 9420 § 16.9.
 *
 * MLS state cannot be recomputed and it cannot be re-fetched from a server:
 * losing the private keys of an epoch means losing the group. So the two state
 * holders, `MLSClient` and `MLSGroup`, call this interface whenever they change
 * something that a restart would otherwise lose — a new epoch, a KeyPackage we
 * published, a proposal we still have to commit.
 *
 * The application implements it, e.g. over SQL. Everything in MLS is
 * synchronous, so an implementation that writes to a real database should take
 * the JSON here and write it in the background.
 *
 * The other direction is the application's: it holds the JSON, and calls
 * `MLSClient.fromJSON()` and then `MLSGroup.fromJSON(client, json)` per group
 * to bring them back. */
import type { MLSClient } from "./MLSClient";
import type { MLSGroup } from "./MLSGroup";

export interface MLSStorage {
  /** Our identity or our published KeyPackages changed. @see `MLSClient.toJSON()` */
  saveClient(client: MLSClient): void;
  /** The group entered a new epoch, or cached a proposal. @see `MLSGroup.toJSON()` */
  saveGroup(group: MLSGroup): void;
  /** A Commit removed us from the group, so there is nothing left to keep. */
  deleteGroup(group: MLSGroup): void;
}
