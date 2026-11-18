// @vitest-environment happy-dom
import { ContactGrouping, ContactGroupHeader } from "../../../Contacts/Person/ContactGrouping";
import { ContactColumn } from "../../../Contacts/Person/ContactColumns";
import { Person } from "../../../../logic/Abstract/Person";
import { expect, test } from "vitest";

function person(name: string, company: string): Person {
  let contact = new Person();
  contact.name = name;
  contact.company = company;
  return contact;
}

const kAnna = person("Anna", "Contoso");
const kBert = person("Bert", "");
const kCarl = person("Carl", "contoso");
const kDora = person("Dora", "Adatum");

test("Contacts are grouped by the field, groups sorted, empty first", () => {
  let grouping = new ContactGrouping({ column: ContactColumn.Company, ascending: true });
  let groups = grouping.groups([ kAnna, kBert, kCarl, kDora ]);
  expect(groups.map(group => group.label)).toEqual([ "Company: (none)", "Company: Adatum", "Company: Contoso" ]);
  expect(groups[2].contacts).toEqual([ kAnna, kCarl ]);
});

test("Descending groups reverse the group order, not the contacts in a group", () => {
  let grouping = new ContactGrouping({ column: ContactColumn.Company, ascending: false });
  let groups = grouping.groups([ kAnna, kBert, kCarl, kDora ]);
  expect(groups.map(group => group.id)).toEqual([ "contoso", "adatum", "" ]);
  expect(groups[0].contacts).toEqual([ kAnna, kCarl ]);
});

test("Rows have a header per group, and collapsed groups hide their contacts", () => {
  let grouping = new ContactGrouping({ column: ContactColumn.Company, ascending: true });
  let rows = grouping.rows([ kAnna, kBert, kCarl, kDora ], new Set([ "adatum" ]));
  expect(rows.map(row => row instanceof ContactGroupHeader ? `[${row.id}]` : (row as Person).name))
    .toEqual([ "[]", "Bert", "[adatum]", "[contoso]", "Anna", "Carl" ]);
  let collapsed = rows[2] as ContactGroupHeader;
  expect(collapsed.isCollapsed).toBe(true);
  expect(collapsed.contacts).toEqual([ kDora ]);
  expect(ContactGrouping.isHeader(collapsed)).toBe(true);
  expect(ContactGrouping.isHeader(kAnna)).toBe(false);
});
