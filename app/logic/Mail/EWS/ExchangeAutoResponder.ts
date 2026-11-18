import { AutoResponder, AutoResponderAudience } from "../AutoResponder";
import type { ExchangeMailAccount } from "./ExchangeMailAccount";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

/** Exchange Out of Office (OOF), as EWS, OWA and ActiveSync have it.
 * Exchange replies only once per sender, and never to
 * `Precedence: bulk/list/junk`, `X-Auto-Response-Suppress`, junk mail
 * or via distribution lists. */
export class ExchangeAutoResponder extends AutoResponder {
  declare readonly account: ExchangeMailAccount;

  /** Only the owner of the account may access the OOF settings */
  get supported(): boolean {
    return !this.account.isDependentAccount;
  }

  get supportsInternal(): boolean {
    return true;
  }

  get supportsContacts(): boolean {
    return true;
  }

  protected get oofState(): OOFState {
    return !this.isOn ? OOFState.Disabled : this.scheduled ? OOFState.Scheduled : OOFState.Enabled;
  }

  protected set oofState(state: OOFState) {
    this.isOn = state == OOFState.Enabled || state == OOFState.Scheduled;
    this.scheduled = state == OOFState.Scheduled;
  }

  protected get oofAudience(): OOFAudience {
    return ExchangeAutoResponder.kAudiences.indexOf(this.externalAudience);
  }

  protected sanitizeAudience(audience: OOFAudience, fallback: AutoResponderAudience): AutoResponderAudience {
    return sanitize.enum(ExchangeAutoResponder.kAudiences[audience], ExchangeAutoResponder.kAudiences, fallback);
  }

  protected static readonly kAudiences = [
    AutoResponderAudience.Internal,
    AutoResponderAudience.Contacts,
    AutoResponderAudience.All,
  ];
}

/** Exchange's `OofState`. EWS uses the names, OWA and ActiveSync the numbers.
 * `oofState` maps it to `isOn` and `scheduled`. */
export enum OOFState {
  /** No automatic replies. Not `isOn`. */
  Disabled = 0,
  /** Replies to all incoming mail, from now on until the user turns it off.
   * The start and end time don't matter.
   * `isOn`, not `scheduled`. */
  Enabled = 1,
  /** Replies only to mail that arrives between the start and end time.
   * Before and after, Exchange doesn't reply, without the user having to turn it off.
   * `isOn` and `scheduled`. */
  Scheduled = 2,
}

/** Exchange's `ExternalAudience`. EWS uses the names, OWA the numbers. */
export enum OOFAudience {
  None = 0,
  Known = 1,
  All = 2,
}
