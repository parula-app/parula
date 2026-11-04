import { OWARequest } from "./OWARequest";
import type { ExchangeCondition } from "../../EWS/ExchangeSearchEMail";
import type { OWAEMail } from "../OWAEMail";
import type { ExchangePermission } from "../../EWS/ExchangePermission";
// import { IconIndexPidTag } from "../../EWS/ExchangeEMail";

export function owaFindMsgsInFolderRequest(folderID: string, maxFetchCount: number): OWARequest {
  return new OWARequest("FindItem", {
    __type: "FindItemRequest:#Exchange",
    ItemShape: {
      __type: "ItemResponseShape:#Exchange",
      BaseShape: "IdOnly",
      AdditionalProperties: [{
        __type: "PropertyUri:#Exchange",
        FieldURI: "message:IsRead",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:IsDraft",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:Categories",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:Flag",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:Importance",
        /*}, {
          __type: "ExtendedPropertyUri:#Exchange",
          PropertyTag: IconIndexPidTag,
          PropertyType: "Integer",*/
      }],
    },
    ParentFolderIds: [{
      __type: "FolderId:#Exchange",
      Id: folderID,
    }],
    Traversal: "Shallow",
    Paging: {
      __type: "IndexedPageView:#Exchange",
      BasePoint: "Beginning",
      Offset: 0,
      MaxEntriesReturned: maxFetchCount,
    },
  });
}

/** Searches the `folderIDs`, @see `ExchangeSearchEMail` */
export function owaSearchMsgsRequest(folderIDs: string[], conditions: ExchangeCondition[], maxFetchCount: number): OWARequest {
  return new OWARequest("FindItem", {
    __type: "FindItemRequest:#Exchange",
    ItemShape: {
      __type: "ItemResponseShape:#Exchange",
      BaseShape: "IdOnly",
      AdditionalProperties: [{
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:ParentFolderId",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:DateTimeSent",
      }],
    },
    ParentFolderIds: folderIDs.map(folderID => ({
      __type: "FolderId:#Exchange",
      Id: folderID,
    })),
    Traversal: "Shallow",
    Restriction: {
      Item: conditions.length == 1
        ? toOWA(conditions[0])
        : { __type: "And:#Exchange", Items: conditions.map(toOWA) },
    },
    SortOrder: [{
      __type: "SortResults:#Exchange",
      Order: "Descending",
      Path: {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:DateTimeSent",
      },
    }],
    Paging: {
      __type: "IndexedPageView:#Exchange",
      BasePoint: "Beginning",
      Offset: 0,
      MaxEntriesReturned: maxFetchCount,
    },
  });
}

function toOWA(condition: ExchangeCondition): any {
  let property = condition.propertyTag ? {
    __type: "ExtendedPropertyUri:#Exchange",
    PropertyTag: condition.propertyTag,
    PropertyType: "Integer",
  } : {
    __type: "PropertyUri:#Exchange",
    FieldURI: condition.fieldURI,
  };
  switch (condition.operator) {
    case "Or":
      return { __type: "Or:#Exchange", Items: condition.conditions.map(toOWA) };
    case "Not":
      return { __type: "Not:#Exchange", Item: toOWA(condition.conditions[0]) };
    case "Contains":
      return {
        __type: "Contains:#Exchange",
        Item: property,
        Constant: {
          __type: "Constant:#Exchange",
          Value: condition.value,
        },
        ContainmentMode: condition.containmentMode,
        ContainmentComparison: "IgnoreCase",
      };
    default:
      return {
        __type: `${condition.operator}:#Exchange`,
        Item: property,
        FieldURIOrConstant: {
          __type: "FieldURIOrConstantType:#Exchange",
          Item: {
            __type: "Constant:#Exchange",
            Value: condition.value,
          },
        },
      };
  }
}

export function owaGetNewMsgHeadersRequest(newMessageIDs: string[]): OWARequest {
  return new OWARequest("GetItem", {
    __type: "GetItemRequest:#Exchange",
    ItemShape: {
      __type: "ItemResponseShape:#Exchange",
      BaseShape: "IdOnly",
      AdditionalProperties: [{
        __type: "PropertyUri:#Exchange",
        FieldURI: "message:InternetMessageId",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "message:IsRead",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "message:References",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "message:ReplyTo",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "message:From",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "message:Sender",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "message:ToRecipients",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "message:CcRecipients",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "message:BccRecipients",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:ItemClass",
        /* Non-MIME @see OWAEMail.bodyAndAttachmentsFromJson()
        }, {
          __type: "PropertyUri:#Exchange",
          FieldURI: "item:Attachments",
        */
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:Subject",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:Size",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:DateTimeReceived",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:InReplyTo",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:IsDraft",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:DateTimeSent",
        /* Non-MIME
        }, {
          __type: "PropertyUri:#Exchange",
          FieldURI: "item:Body",
        */
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:Categories",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:Flag",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:Importance",
        /* Non-MIME
        }, {
          __type: "PropertyUri:#Exchange",
          FieldURI: "item:TextBody",
        */
        /*}, {
          __type: "ExtendedPropertyUri:#Exchange",
          PropertyTag: IconIndexPidTag,
          PropertyType: "Integer",*/
      }],
    },
    ItemIds: newMessageIDs.map(id => ({
      __type: "ItemId:#Exchange",
      Id: id,
    })),
  });
}

export function owaDownloadMsgsRequest(messages: OWAEMail[]): OWARequest {
  return new OWARequest("GetItem", {
    __type: "GetItemRequest:#Exchange",
    ItemShape: {
      __type: "ItemResponseShape:#Exchange",
      BaseShape: "IdOnly",
      AdditionalProperties: [{ // Work around Office365 bug
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:Size"
      }],
      IncludeMimeContent: true,
    },
    ItemIds: messages.map(message => ({
      __type: "ItemId:#Exchange",
      Id: message.itemID,
    })),
  });
}

export function owaMoveOrCopyMsgsIntoFolderRequest(action: "Move" | "Copy", folderID: string, messages: OWAEMail[]): OWARequest {
  return new OWARequest(action + "Item", {
    __type: action + "ItemRequest:#Exchange",
    ItemIds: messages.map(message => ({
      __type: "ItemId:#Exchange",
      Id: message.itemID,
    })),
    ToFolderId: {
      __type: "TargetFolderId:#Exchange",
      BaseFolderId: {
        __type: "FolderId:#Exchange",
        Id: folderID,
      },
    },
    // ReturnNewItemIds: false,
  });
}

export function owaFindFoldersRequest(deep: boolean, sharedFolderRoot?: string | null, username?: string): OWARequest {
  return new OWARequest("FindFolder", {
    __type: "FindFolderRequest:#Exchange",
    FolderShape: {
      BaseShape: "Default",
      AdditionalProperties: [{
        __type: "PropertyUri:#Exchange",
          FieldURI: "folder:FolderClass",
      }, {
        __type: "PropertyUri:#Exchange",
          FieldURI: "folder:ParentFolderId",
      }, {
        __type: "PropertyUri:#Exchange",
          FieldURI: "folder:DistinguishedFolderId",
      }],
    },
    Paging: null,
    ParentFolderIds: [sharedFolderRoot
    ? {
      __type: "DistinguishedFolderId:#Exchange",
      Id: sharedFolderRoot,
      Mailbox: {
        EmailAddress: username,
      },
    }
    : {
      __type: "DistinguishedFolderId:#Exchange",
      Id: "msgfolderroot",
    }],
    ReturnParentFolder: true,
    Traversal: deep ? "Deep" : "Shallow",
  });
}

export function owaMoveEntireFolderRequest(sourceFolderID: string, newParentFolderId: string): OWARequest {
  return new OWARequest("MoveFolder", {
    __type: "MoveFolderRequest:#Exchange",
    FolderIds: [{
      FolderId: {
        __type: "FolderId:#Exchange",
        Id: sourceFolderID,
      },
    }],
    ToFolderId: {
      __type: "TargetFolderId:#Exchange",
      FolderId: {
        __type: "FolderId:#Exchange",
        Id: newParentFolderId,
      },
    },
  });
}

export function owaCreateNewSubFolderRequest(name: string, parentFolderID: string): OWARequest {
  return new OWARequest("CreateFolder", {
    __type: "CreateFolderRequest:#Exchange",
    ParentFolderId: {
      __type: "TargetFolderId:#Exchange",
      BaseFolderId: {
        __type: "FolderId:#Exchange",
        Id: parentFolderID,
      },
    },
    Folders: [{
      __type: "Folder:#Exchange",
      FolderClass: "IPF.Note",
      DisplayName: name,
    }],
  });
}

export function owaCreateNewTopLevelFolderRequest(name: string, username: string | null): OWARequest {
  return new OWARequest("CreateFolder", {
    __type: "CreateFolderRequest:#Exchange",
    ParentFolderId: {
      __type: "TargetFolderId:#Exchange",
      BaseFolderId: username
      ? {
        __type: "DistinguishedFolderId:#Exchange",
        Id: "msgfolderroot",
        Mailbox: {
          EmailAddress: username,
        },
      }
      : {
        __type: "DistinguishedFolderId:#Exchange",
        Id: "msgfolderroot",
      },
    },
    Folders: [{
      __type: "Folder:#Exchange",
      FolderClass: "IPF.Note",
      DisplayName: name,
    }],
  });
}

export function owaRenameFolderRequest(name: string, folderID: string): OWARequest {
  return new OWARequest("UpdateFolder", {
    __type: "UpdateFolderRequest:#Exchange",
    FolderChanges: [{
      __type: "FolderChange:#Exchange",
      FolderId: {
        __type: "FolderId:#Exchange",
        Id: folderID,
      },
      Updates: [{
        __type: "SetFolderField:#Exchange",
        Folder: {
          __type: "Folder:#Exchange",
          DisplayName: name,
        },
        Path: {
          __type: "PropertyUri:#Exchange",
          FieldURI: "FolderDisplayName",
        },
      }],
    }],
  });
}

export function owaSharedFolderRequest(distinguishedIDs: string[], emailAddress: string): OWARequest {
  return new OWARequest("GetFolder", {
    __type: "GetFolderRequest:#Exchange",
    FolderShape: {
      __type: "FolderResponseShape:#Exchange",
      BaseShape: "Default",
      AdditionalProperties: [{
        __type: "PropertyUri:#Exchange",
        FieldURI: "folder:FolderClass",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "folder:ParentFolderId",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "folder:DistinguishedFolderId",
      }],
    },
    FolderIds: distinguishedIDs.map(distinguishedID => ({
      __type: "DistinguishedFolderId:#Exchange",
      Id: distinguishedID,
      Mailbox: {
        EmailAddress: emailAddress,
      },
    })),
  });
}

export function owaGetFolderRequest(folderID: string): OWARequest {
  return new OWARequest("GetFolder", {
    __type: "GetFolderRequest:#Exchange",
    FolderShape: {
      __type: "FolderResponseShape:#Exchange",
      BaseShape: "Default",
      AdditionalProperties: [{
        __type: "PropertyUri:#Exchange",
        FieldURI: "folder:FolderClass",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "folder:DistinguishedFolderId",
      }],
    },
    FolderIds: [{
      __type: "FolderId:#Exchange",
      Id: folderID,
    }],
  });
}

/** Subtly different to owaSetFolderPermissionsRequst */
export function owaSetCalendarPermissionsRequest(folderID: string, permissions: ExchangePermission[]): OWARequest {
  return new OWARequest("UpdateFolder", {
    __type: "UpdateFolderRequest:#Exchange",
    FolderChanges: [{
      __type: "FolderChange:#Exchange",
      FolderId: {
        __type: "FolderId:#Exchange",
        Id: folderID,
      },
      Updates: [{
        __type: "SetFolderField:#Exchange",
        Folder: {
          __type: "CalendarFolder:#Exchange",
          PermissionSet: {
            CalendarPermissions: permissions.map(permission => permission.toOWACalendarPermission()),
          },
        },
        Path: {
          __type: "PropertyUri:#Exchange",
          FieldURI: "PermissionSet",
        },
      }],
    }],
  });
}

export function owaSetFolderPermissionsRequest(folderID: string, permissions: ExchangePermission[]): OWARequest {
  return new OWARequest("UpdateFolder", {
    __type: "UpdateFolderRequest:#Exchange",
    FolderChanges: [{
      __type: "FolderChange:#Exchange",
      FolderId: {
        __type: "FolderId:#Exchange",
        Id: folderID,
      },
      Updates: [{
        __type: "SetFolderField:#Exchange",
        Folder: {
          __type: "Folder:#Exchange",
          PermissionSet: {
            __type: "PermissionSet:#Exchange",
            Permissions: permissions.map(permission => permission.toOWAFolderPermission()),
          },
        },
        Path: {
          __type: "PropertyUri:#Exchange",
          FieldURI: "PermissionSet",
        },
      }],
    }],
  });
}

/** Also works with calendars, but returns CalendarFolder permissions */
export function owaGetPermissionsRequest(folderID: string): OWARequest {
  return new OWARequest("GetFolder", {
    __type: "GetFolderRequest:#Exchange",
    FolderShape: {
      __type: "FolderResponseShape:#Exchange",
      BaseShape: "IdOnly",
      AdditionalProperties: [{
        __type: "PropertyUri:#Exchange",
        FieldURI: "folder:PermissionSet",
      }],
    },
    FolderIds: [{
      __type: "FolderId:#Exchange",
      Id: folderID,
    }],
  });
}

export function owaFolderCountsRequest(folderID: string): OWARequest {
  return new OWARequest("GetFolder", {
    __type: "GetFolderRequest:#Exchange",
    FolderShape: {
      __type: "FolderResponseShape:#Exchange",
      BaseShape: "IdOnly",
      AdditionalProperties: [{
        __type: "PropertyUri:#Exchange",
        FieldURI: "folder:UnreadCount",
      }, {
        __type: "PropertyUri:#Exchange",
        FieldURI: "folder:TotalCount",
      }],
    },
    FolderIds: [{
      __type: "FolderId:#Exchange",
      Id: folderID,
    }],
  });
}

export function owaDeleteFolderRequest(folderID: string): OWARequest {
  return new OWARequest("DeleteFolder", {
    __type: "DeleteFolderRequest:#Exchange",
    FolderIds: [{
      __type: "FolderId:#Exchange",
      Id: folderID,
    }],
    DeleteType: "SoftDelete",
  });
}

export function owaFolderMarkAllMsgsReadRequest(folderID: string): OWARequest {
  return new OWARequest("MarkAllItemsAsRead", {
    __type: "MarkAllItemsAsReadRequest:#Exchange",
    ReadFlag: true,
    SuppressReadReceipts: true,
    FolderIds: [{
      __type: "FolderId:#Exchange",
      Id: folderID,
    }],
    ItemIdsToExclude: [],
  });
}
