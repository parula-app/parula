/**
 * Separate bulk mail fetches from interactive user commands.
 * If they share the same pool, the user commands are blocked.
 *
 * Separate file breaks import cycle from `NTLMConnectionPool` to `EWSAccount`.
 */
export enum ConnectionPurpose {
  /** Background mail fetch: Message list and mail content. */
  Fetch = "fetch",
  /** Interactive user commands: Delete a mail, open an uncached email,
   * search the address book. Highest priority. */
  Display = "display",
}
