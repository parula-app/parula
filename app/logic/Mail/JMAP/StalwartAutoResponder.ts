import { JMAPAutoResponder } from "./JMAPAutoResponder";
import type { TJMAPChangeResponse, TJMAPGetResponse } from "./TJMAPGeneric";
import type { TJMAPSieveScript } from "./TJMAPMail";
import { checkChangeError } from "./JMAPError";
import { assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";

/** Stalwart runs only one Sieve script, the active one. Its `VacationResponse` is a Sieve script
 * named "vacation", and `isEnabled` makes that the active script. That turns off the user's
 * filter script, and turning the automatic replies off doesn't turn the filters back on.
 *
 * So while a filter script is active, we save the reply without `isEnabled`, and activate
 * our own script, which runs "vacation" and then the filters:
 * - Turn on: `VacationResponse/set` -> upload our script -> activate it
 * - Turn off: `VacationResponse/set` -> activate the filter script -> delete our script
 * Without an active filter script, we use `isEnabled`, like other apps.
 *
 * <https://www.rfc-editor.org/rfc/rfc9661.html> */
export class StalwartAutoResponder extends JMAPAutoResponder {
  /** Our script is named this plus the name of the filter script */
  protected static readonly kPrefix = "vacation+";

  async load(): Promise<void> {
    await super.load();
    let active = (await this.listScripts()).find(script => script.isActive);
    this.isOn ||= !!active?.name?.startsWith(StalwartAutoResponder.kPrefix);
  }

  async save(): Promise<void> {
    this.validate();
    let scripts = await this.listScripts();
    let active = scripts.find(script => script.isActive);
    let isOurs = !!active?.name?.startsWith(StalwartAutoResponder.kPrefix);
    let haveFilters = !!active && active.name?.toLowerCase() != "vacation"; // Our script runs them, too
    await this.setVacationResponse(this.isOn && !haveFilters);
    if (this.isOn && haveFilters && !isOurs) {
      await this.activateOurScript(active);
    } else if (!this.isOn && isOurs) {
      let filters = scripts.find(script => script.name == active.name.slice(StalwartAutoResponder.kPrefix.length));
      await this.activateFilters(filters, active);
    }
  }

  /** Stalwart takes only replies with less than 2048 bytes */
  protected validate() {
    super.validate();
    assert(new TextEncoder().encode(this.internalHTML).length < 2048, gt`The automatic reply is too long for the server. Please shorten it.`);
  }

  protected async listScripts(): Promise<TJMAPSieveScript[]> {
    let response = await this.account.makeSingleCall("SieveScript/get", {
      accountId: this.account.accountID,
      properties: ["name", "isActive"],
    }) as TJMAPGetResponse<TJMAPSieveScript>;
    return response.list;
  }

  /** "vacation" first, because filters often `stop`. The filter script may be deleted while we include it. */
  protected async activateOurScript(filters: TJMAPSieveScript) {
    let filtersName = filters.name.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
    let script = `require "include";\r\ninclude :personal "vacation";\r\ninclude :personal :optional "${filtersName}";\r\n`;
    let response = await this.account.makeCombinedCall([
      [
        "Blob/upload", {
          accountId: this.account.accountID,
          create: {
            script: {
              data: [{ "data:asText": script }],
              type: "application/sieve",
            },
          },
        },
        "upload",
      ], [
        "SieveScript/set", {
          accountId: this.account.accountID,
          create: {
            ours: {
              name: StalwartAutoResponder.kPrefix + filters.name,
              blobId: "#script",
            },
          },
          onSuccessActivateScript: "#ours",
        },
        "set",
      ],
    ]);
    checkChangeError(response["upload"] as TJMAPChangeResponse<any>);
    checkChangeError(response["set"] as TJMAPChangeResponse<TJMAPSieveScript>);
  }

  /** @param filters null, if the user deleted it meanwhile */
  protected async activateFilters(filters: TJMAPSieveScript | null, ourScript: TJMAPSieveScript) {
    let response = await this.account.makeCombinedCall([
      [
        "SieveScript/set", {
          accountId: this.account.accountID,
          onSuccessActivateScript: filters?.id,
          onSuccessDeactivateScript: filters ? undefined : true,
        },
        "activate",
      ], [
        // Only after the activation, because the server doesn't delete the active script
        "SieveScript/set", {
          accountId: this.account.accountID,
          destroy: [ourScript.id],
        },
        "delete",
      ],
    ]);
    checkChangeError(response["delete"] as TJMAPChangeResponse<TJMAPSieveScript>);
  }
}
