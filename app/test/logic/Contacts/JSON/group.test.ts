// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { Person } from "../../../../logic/Abstract/Person";
import { Group } from "../../../../logic/Abstract/Group";
import { JSONGroup } from "../../../../logic/Contacts/JSON/JSONGroup";
import { errorsForServer } from "../../../../logic/util/error";
import { notifications, NotificationSeverity } from "../../../../logic/util/Notification";
import { expect, test, vi } from "vitest";

test("A group member that we cannot read is a data error, and we still read the other members", () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  let addressbook = new Addressbook();
  let person = new Person(addressbook);
  addressbook.persons.add(person);
  let group = new Group(addressbook);

  JSONGroup.readMembers(group, { members: ["", person.id] });

  expect(group.participants.contents).toEqual([person]);
  // Development builds show data errors as warning, but don't log them to the server
  expect(notifications.contents.map(notification => notification.severity)).toEqual([NotificationSeverity.Warning]);
  expect(errorsForServer.isEmpty).toBe(true);
});
