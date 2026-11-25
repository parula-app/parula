// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { OWACalendarShortcut } from "../../../../logic/Calendar/OWA/OWACalendarShortcut";
import { expect, test } from "vitest";

/** An account stub which searches the directory like Exchange does: Without routing type
 * prefix, it matches only the start of the names, like a directory which does not
 * search the `mail` attribute. With an `smtp:` prefix, it matches the start of
 * the email address. Some OWA servers have no `ResolveNames`. */
function fakeAccount(): any {
  return {
    async callOWA(request: any) {
      if (request.action == "GetFolder") {
        return { Folders: [{ FolderClass: "IPF.Appointment" }] };
      }
      expect(request.action).toBe("FindPeople");
      let entry = request.Body.QueryString.toLowerCase();
      let matches = entry.startsWith("smtp:")
        ? "sally@example.com".startsWith(entry.slice("smtp:".length))
        : "sally smith".startsWith(entry);
      return {
        ResultSet: matches ? [{
          DisplayName: "Sally Smith",
          EmailAddresses: [{ EmailAddress: "Sally@Example.com", RoutingType: "SMTP" }],
        }] : [],
      };
    },
    createCalendarAccount: (folder: any, options: any) => options,
    colorForSharedAccount: () => "#008000",
    isMyEMailAddress: () => false,
  };
}

test("The calendar of another user has the name of its owner", async () => {
  let shortcut = new OWACalendarShortcut(fakeAccount(), { OwnerEmailAddress: "Sally@Example.com" });
  let calendar = await shortcut.createCalendar();
  expect(calendar.name).toBe("Sally Smith");
  expect(calendar.username).toBe("sally@example.com");
});

test("Owner who is not in the GAL", async () => {
  let account = fakeAccount();
  let getFolder = account.callOWA;
  account.callOWA = async function(request: any) {
    if (request.action == "FindPeople") {
      return { ResultSet: [] };
    }
    return await getFolder.call(this, request);
  };
  let shortcut = new OWACalendarShortcut(account, { OwnerEmailAddress: "sally@example.com" });
  let calendar = await shortcut.createCalendar();
  expect(calendar.name).toBe("sally@example.com");
});
