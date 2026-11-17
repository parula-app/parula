// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import type { OWACalendar } from "../../../../logic/Calendar/OWA/OWACalendar";
import { OWAError } from "../../../../logic/Mail/OWA/OWAError";
import { expect, test } from "vitest";

/* Outlook on the web reads the calendar shortcuts in "Common Views" on the
 * server, with `GetCalendarFolders`, and returns the other users' calendars
 * as `LinkedCalendarEntry`, with the owner's email address already resolved. */

const kCalendarGroups = [{
  __type: "CalendarGroup:#Exchange",
  GroupName: "My Calendars",
  Calendars: [{
    __type: "LocalCalendarEntry:#Exchange",
    CalendarName: "Calendar",
    CalendarFolderId: { Id: "alice-calendar-id" },
  }],
}, {
  __type: "CalendarGroup:#Exchange",
  GroupName: "People's Calendars",
  Calendars: [{
    // Default calendar of Bob. Exchange returns no folder ID for these.
    __type: "LinkedCalendarEntry:#Exchange",
    CalendarName: "Bob Builder",
    OwnerEmailAddress: "Bob@Example.com",
    IsGeneralScheduleCalendar: true,
    IsOwnerEmailAddressInvalid: false,
  }, {
    // Another calendar of Carol
    __type: "LinkedCalendarEntry:#Exchange",
    CalendarName: "Carol: Projects",
    OwnerEmailAddress: "carol@example.com",
    SharedFolderId: { Id: "carol-projects-id" },
    IsGeneralScheduleCalendar: false,
    IsOwnerEmailAddressInvalid: false,
  }, {
    // The server could not find Dave's address. It then returns the legacy DN.
    __type: "LinkedCalendarEntry:#Exchange",
    CalendarName: "Dave",
    OwnerEmailAddress: "/o=Example/ou=Exchange Administrative Group (FYDIBOHF23SPDLT)/cn=Recipients/cn=dave",
    IsGeneralScheduleCalendar: true,
    IsOwnerEmailAddressInvalid: true,
  }, {
    // A public folder calendar. Exchange returns our own address as owner.
    __type: "LinkedCalendarEntry:#Exchange",
    CalendarName: "Holidays",
    OwnerEmailAddress: "alice@example.com",
    SharedFolderId: { Id: "public-holidays-id" },
    IsGeneralScheduleCalendar: false,
    IsOwnerEmailAddressInvalid: false,
  }],
}];

/** `callOWA()` returns the single response message of the server's answer */
class TestOWAAccount extends OWAAccount {
  readonly requests: any[] = [];
  /** Error code for Bob's calendar, e.g. when he stopped sharing it */
  bobCalendarError: string | null = null;

  async callOWA(request: any): Promise<any> {
    this.requests.push({ action: request.action, ...JSON.parse(JSON.stringify(request)) });
    switch (request.action) {
      case "GetPeopleFilters":
        return [];
      case "FindFolder": // our own folders
        return { RootFolder: { Folders: [] } };
      case "GetCalendarFolders":
        return { CalendarGroups: kCalendarGroups, CalendarFolders: [] };
      case "ResolveNames": {
        // Exchange finds the owner by `smtp:` + email address, and returns the plain email address.
        // Accept the plain email address as well.
        let emailAddress = request.Body.UnresolvedEntry.replace(/^smtp:/i, "");
        let person = kPersons[emailAddress];
        if (!person) {
          throw new OWAError({ status: 200, json: { ResponseMessages: { Items: [{ ResponseClass: "Error", ResponseCode: "ErrorNameResolutionNoResults", MessageText: "No results" }] } } });
        }
        return { ResolutionSet: [{ Mailbox: { Name: person, EmailAddress: emailAddress, RoutingType: "SMTP" } }] };
      }
      case "GetFolder": {
        let folderID = request.Body.FolderIds[0];
        if (folderID.__type == "FolderId:#Exchange") {
          expect(folderID.Id).toBe("carol-projects-id");
          return calendarFolder("carol-projects-id", "Projects");
        }
        expect(folderID.Id).toBe("calendar");
        expect(folderID.Mailbox.EmailAddress).toBe("bob@example.com");
        if (this.bobCalendarError) {
          throw new OWAError({ status: 200, json: { ResponseMessages: { Items: [{ ResponseClass: "Error", ResponseCode: this.bobCalendarError, MessageText: this.bobCalendarError }] } } });
        }
        return calendarFolder("bob-calendar-id", "Calendar", "calendar");
      }
    }
    throw new Error("Unexpected request " + request.action);
  }
}

const kPersons: Record<string, string> = {
  "bob@example.com": "Bob Builder",
  "carol@example.com": "Carol Singer",
};

function calendarFolder(id: string, displayName: string, distinguishedFolderID?: string): any {
  return {
    ResponseClass: "Success",
    Folders: [{
      __type: "CalendarFolder:#Exchange",
      FolderId: { Id: id },
      DisplayName: displayName,
      FolderClass: "IPF.Appointment",
      DistinguishedFolderId: distinguishedFolderID,
    }],
  };
}

function newTestAccount(): TestOWAAccount {
  appGlobal.remoteApp ??= { OWA: {} } as any; // `OWAAccount` needs the backend only for the login
  let account = new TestOWAAccount();
  account.name = "Alice";
  account.username = "alice@example.com";
  account.emailAddress = account.username;
  return account;
}

test("OWA: Offer the calendars of other users that the user opened in Outlook", async () => {
  let account = newTestAccount();

  let calendars = (await account.listPossibleSubAccounts()).contents as OWACalendar[];

  expect(calendars.map(calendar => calendar.name)).toEqual(["Bob Builder Calendar", "Carol Singer Projects"]);
  let [bob, carol] = calendars;
  expect(bob.protocol).toBe("calendar-owa");
  expect(bob.username).toBe("bob@example.com");
  expect(bob.folderID).toBe("bob-calendar-id");
  expect(bob.useForInvitations).toBe(true);
  expect(bob.mainAccount).toBe(account);
  expect(carol.username).toBe("carol@example.com");
  expect(carol.folderID).toBe("carol-projects-id");
  expect(carol.useForInvitations).toBe(false);
  expect(account.requests.find(request => request.action == "GetCalendarFolders")).toBeDefined();
});

test("OWA: Skip a calendar that is not shared with us anymore", async () => {
  let account = newTestAccount();
  account.bobCalendarError = "ErrorAccessDenied";

  let calendars = (await account.listPossibleSubAccounts()).contents as OWACalendar[];

  expect(calendars.map(calendar => calendar.folderID)).toEqual(["carol-projects-id"]);
});
