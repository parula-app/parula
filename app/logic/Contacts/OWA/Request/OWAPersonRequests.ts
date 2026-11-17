import { OWARequest } from "../../../Mail/OWA/Request/OWARequest";

export function owaFindGALPersonsRequest(searchTerm: string): OWARequest {
  return new OWARequest("FindPeople", {
    __type: "FindPeopleRequest:#Exchange",
    IndexedPageItemView: {
      __type: "IndexedPageView:#Exchange",
      BasePoint: "Beginning",
      Offset: 0,
      MaxEntriesReturned: 100,
    },
    ParentFolderId: {
      __type: "TargetFolderId:#Exchange",
      BaseFolderId: {
        __type: "DistinguishedFolderId:#Exchange",
        Id: "directory",
      },
    },
    PersonaShape: {
      __type: "PersonaResponseShape:#Exchange",
      BaseShape: "Default",
    },
    QueryString: searchTerm,
    SearchPeopleSuggestionIndex: false,
    ShouldResolveOneOffEmailAddress: false,
  });
}

/** Resolves `searchTerm` against the Global Address List (GAL).
 * Unlike `FindPeople`, this returns the S/MIME certificates of the persons. */
export function owaResolveNamesRequest(searchTerm: string): OWARequest {
  return new OWARequest("ResolveNames", {
    __type: "ResolveNamesRequest:#Exchange",
    UnresolvedEntry: searchTerm,
    ReturnFullContactData: true,
    // The S/MIME certificates are not in the default property set
    ContactDataShape: "AllProperties",
  });
}

export function owaFindPersonsRequest(folderID: string, maxFetchCount: number): OWARequest {
  return new OWARequest("FindPeople", {
    __type: "FindPeopleRequest:#Exchange",
    IndexedPageItemView: {
      __type: "IndexedPageView:#Exchange",
      BasePoint: "Beginning",
      Offset: 0,
      MaxEntriesReturned: maxFetchCount,
    },
    ParentFolderId: {
      __type: "TargetFolderId:#Exchange",
      BaseFolderId: {
        __type: "FolderId:#Exchange",
        Id: folderID,
      },
    },
    PersonaShape: {
      __type: "PersonaResponseShape:#Exchange",
      BaseShape: "Default",
    },
    QueryString: null,
    SearchPeopleSuggestionIndex: false,
    ShouldResolveOneOffEmailAddress: false,
  });
}

/** Fetches the attachments of the contacts, which is where the pictures are.
 * @param itemIDs the ItemIds of the contacts, not the PersonaIds */
export function owaGetContactAttachmentsRequest(itemIDs: string[]): OWARequest {
  return new OWARequest("GetItem", {
    __type: "GetItemRequest:#Exchange",
    ItemShape: {
      __type: "ItemResponseShape:#Exchange",
      BaseShape: "IdOnly",
      AdditionalProperties: [{
        __type: "PropertyUri:#Exchange",
        FieldURI: "item:Attachments",
      }],
    },
    ItemIds: itemIDs.map(itemID => ({
      __type: "ItemId:#Exchange",
      Id: itemID,
    })),
  });
}

export function owaGetPersonaRequest(personaID: string): OWARequest {
  return new OWARequest("GetPersona", {
    __type: "GetPersonaRequest:#Exchange",
    PersonaId: {
      __type: "ItemId:#Exchange",
      Id: personaID,
    },
  });
}
