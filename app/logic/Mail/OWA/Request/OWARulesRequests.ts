import { OWARequest } from "./OWARequest";
import { OutlookRulesCopy } from "../../EWS/OutlookRulesCopy";

/** The hidden messages in the Inbox with the copy of the rules that Outlook keeps */
export function owaFindOutlookRulesCopyRequest(): OWARequest {
  return new OWARequest("FindItem", {
    __type: "FindItemRequest:#Exchange",
    ItemShape: {
      __type: "ItemResponseShape:#Exchange",
      BaseShape: "IdOnly",
    },
    ParentFolderIds: [{
      __type: "DistinguishedFolderId:#Exchange",
      Id: "inbox",
    }],
    Traversal: "Associated",
    Restriction: {
      Item: {
        __type: "IsEqualTo:#Exchange",
        Item: {
          __type: "PropertyUri:#Exchange",
          FieldURI: "item:ItemClass",
        },
        FieldURIOrConstant: {
          __type: "FieldURIOrConstantType:#Exchange",
          Item: {
            __type: "Constant:#Exchange",
            Value: OutlookRulesCopy.kItemClass,
          },
        },
      },
    },
    Paging: {
      __type: "IndexedPageView:#Exchange",
      BasePoint: "Beginning",
      Offset: 0,
      MaxEntriesReturned: 10,
    },
  });
}

/** The copy of the rules in a hidden message from `owaFindOutlookRulesCopyRequest()` */
export function owaGetOutlookRulesStreamRequest(itemID: string): OWARequest {
  return new OWARequest("GetItem", {
    __type: "GetItemRequest:#Exchange",
    ItemShape: {
      __type: "ItemResponseShape:#Exchange",
      BaseShape: "IdOnly",
      AdditionalProperties: [{
        __type: "ExtendedPropertyUri:#Exchange",
        PropertyTag: OutlookRulesCopy.kPropertyTag,
        PropertyType: "Binary",
      }],
    },
    ItemIds: [{
      __type: "ItemId:#Exchange",
      Id: itemID,
    }],
  });
}
