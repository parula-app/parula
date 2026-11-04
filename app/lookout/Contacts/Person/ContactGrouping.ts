import type { Contact } from "../../../logic/Abstract/Contact";
import { contactColumnLabel, contactColumnValue, type ContactSort } from "./ContactColumns";
import { gt } from "../../../l10n/l10n";

export class ContactGroupHeader {
  readonly id: string;
  readonly label: string;
  readonly contacts: Contact[];
  readonly isCollapsed: boolean;

  constructor(id: string, label: string, contacts: Contact[], isCollapsed: boolean) {
    this.id = id;
    this.label = label;
    this.contacts = contacts;
    this.isCollapsed = isCollapsed;
  }
}

export type ContactRow = Contact | ContactGroupHeader;

export class ContactGrouping {
  readonly groupBy: ContactSort;

  constructor(groupBy: ContactSort) {
    this.groupBy = groupBy;
  }

  groups(sortedContacts: Contact[], collapsedIDs: Set<string> = new Set()): ContactGroupHeader[] {
    let column = this.groupBy.column;
    let byValue = new Map<string, Contact[]>();
    for (let contact of sortedContacts) {
      let value = contactColumnValue(column, contact).trim();
      let key = value.toLocaleLowerCase();
      if (!byValue.has(key)) {
        byValue.set(key, []);
      }
      byValue.get(key).push(contact);
    }
    let direction = this.groupBy.ascending ? 1 : -1;
    let keys = [ ...byValue.keys() ].sort((a, b) =>
      direction * a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
    let columnLabel = contactColumnLabel(column);
    return keys.map(key => {
      let contacts = byValue.get(key);
      let value = contactColumnValue(column, contacts[0]).trim();
      let label = gt`${columnLabel}: ${value || gt`(none) *=> Group for the contacts that have no value in this column`}`;
      return new ContactGroupHeader(key, label, contacts, collapsedIDs.has(key));
    });
  }

  rows(sortedContacts: Contact[], collapsedIDs: Set<string> = new Set()): ContactRow[] {
    return this.groups(sortedContacts, collapsedIDs)
      .flatMap(group => group.isCollapsed ? [ group ] : [ group, ...group.contacts ]);
  }

  static isHeader(row: ContactRow): row is ContactGroupHeader {
    return row instanceof ContactGroupHeader;
  }
}
