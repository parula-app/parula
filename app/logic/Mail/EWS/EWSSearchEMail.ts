import { ExchangeSearchEMail, type ExchangeCondition } from "./ExchangeSearchEMail";
import type { EWSAccount } from "./EWSAccount";
import { type EWSFolder, getEWSItems, kMaxCount } from "./EWSFolder";
import { EWSItemError } from "./EWSError";
import type { EMail } from "../EMail";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { ensureArray } from "../../util/util";
import { ArrayColl } from "svelte-collections";

/** Sends the search @see `ExchangeSearchEMail` as EWS `FindItem`.
 * <https://learn.microsoft.com/en-us/exchange/client-developer/web-service-reference/finditem-operation> */
export class EWSSearchEMail extends ExchangeSearchEMail {
  declare account: EWSAccount;

  async startSearch(limit?: number): Promise<ArrayColl<EMail>> {
    let results = new ArrayColl<EMail>();
    let conditions = this.conditions();
    if (!conditions) {
      return results;
    }
    let folders = (this.folder ? [this.folder] : this.account.getAllFolders().contents) as EWSFolder[];
    let request = {
      m$FindItem: {
        m$ItemShape: {
          t$BaseShape: "IdOnly",
          t$AdditionalProperties: {
            t$FieldURI: [{
              FieldURI: "item:ParentFolderId",
            }, {
              FieldURI: "item:DateTimeSent",
            }],
          },
        },
        m$IndexedPageItemView: {
          BasePoint: "Beginning",
          Offset: 0,
          MaxEntriesReturned: limit ?? kMaxCount,
        },
        m$Restriction: conditions.length == 1
          ? toEWS(conditions[0])
          : { t$And: mergeSameTag(conditions.map(toEWS)) },
        m$SortOrder: {
          t$FieldOrder: {
            Order: "Descending",
            t$FieldURI: {
              FieldURI: "item:DateTimeSent",
            },
          },
        },
        m$ParentFolderIds: {
          t$FolderId: folders.map(folder => ({ Id: folder.id })),
        },
        Traversal: "Shallow",
      },
    };
    let items: any[] = [];
    for (let response of ensureArray(await this.account.callEWS(request))) { // 1 per folder
      if (response.ResponseClass == "Error") {
        throw new EWSItemError(response, request);
      }
      if (response.RootFolder?.Items) {
        items = items.concat(getEWSItems(response.RootFolder.Items));
      }
    }
    items = this.newestFirst(items, limit);

    for (let folder of folders) {
      let newItemIDs: any[] = [];
      for (let item of items) {
        if (item.ParentFolderId?.Id != folder.id) {
          continue;
        }
        let itemID = sanitize.nonemptystring(item.ItemId.Id);
        if (folder.deletions.has(itemID)) {
          continue;
        }
        let email = folder.getEmailByItemID(itemID);
        if (email) {
          results.add(email);
        } else {
          newItemIDs.push(item.ItemId);
        }
      }
      results.addAll(await folder.getNewMessageHeaders(newItemIDs));
    }
    return results;
  }
}

/** @returns the condition as a single-entry object, e.g. `{ t$IsEqualTo: ... }` */
function toEWS(condition: ExchangeCondition): any {
  let property = condition.propertyTag
    ? { t$ExtendedFieldURI: { PropertyTag: condition.propertyTag, PropertyType: "Integer" } }
    : { t$FieldURI: { FieldURI: condition.fieldURI } };
  switch (condition.operator) {
    case "Or":
      return { t$Or: mergeSameTag(condition.conditions.map(toEWS)) };
    case "Not":
      return { t$Not: toEWS(condition.conditions[0]) };
    case "Contains":
      return {
        t$Contains: {
          ContainmentMode: condition.containmentMode,
          ContainmentComparison: "IgnoreCase",
          ...property,
          t$Constant: { Value: condition.value },
        },
      };
    default:
      return {
        [`t$${condition.operator}`]: {
          ...property,
          t$FieldURIOrConstant: { t$Constant: { Value: condition.value } },
        },
      };
  }
}

/** Puts the conditions into one parent element. Conditions of the same kind
 * become an array, because a JS object cannot hold the same key twice. */
function mergeSameTag(conditions: any[]): any {
  let merged: any = {};
  for (let condition of conditions) {
    for (let tag in condition) {
      merged[tag] = tag in merged
        ? ensureArray(merged[tag]).concat(condition[tag])
        : condition[tag];
    }
  }
  return merged;
}
