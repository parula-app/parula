import { ContactEntry } from "../../../logic/Abstract/Person";
import type { ArrayColl } from "svelte-collections";
import { gt } from "../../../l10n/l10n";

export class ContactSlot {
  readonly id: string;
  readonly label: string;
  readonly purpose: string | null;
  readonly isFax: boolean;
  readonly index: number;

  constructor(id: string, label: string, purpose: string | null, isFax: boolean, index: number) {
    this.id = id;
    this.label = label;
    this.purpose = purpose;
    this.isFax = isFax;
    this.index = index;
  }

  matches(entry: ContactEntry): boolean {
    return (this.purpose == null || entry.purpose == this.purpose) &&
      (entry.protocol == "fax") == this.isFax;
  }

  entryIn(entries: ArrayColl<ContactEntry>): ContactEntry | null {
    return entries.contents.filter(entry => this.matches(entry))[this.index] ?? null;
  }

  valueIn(entries: ArrayColl<ContactEntry>): string {
    return this.entryIn(entries)?.value ?? "";
  }

  setValueIn(entries: ArrayColl<ContactEntry>, value: string, slots: readonly ContactSlot[]): ContactSlot {
    value = value.trim();
    let entry = this.entryIn(entries);
    if (entry) {
      if (value) {
        entry.value = value;
      } else {
        entries.remove(entry);
      }
      return this;
    }
    if (!value) {
      return this;
    }
    entry = new ContactEntry(value, this.purpose ?? "work", this.isFax ? "fax" : null);
    entries.add(entry);
    return slots.find(slot => slot.entryIn(entries) == entry) ?? this;
  }
}

export const emailSlots: readonly ContactSlot[] = [
  new ContactSlot("email1", gt`E-mail *=> Email address of the person`, null, false, 0),
  new ContactSlot("email2", gt`E-mail 2`, null, false, 1),
  new ContactSlot("email3", gt`E-mail 3`, null, false, 2),
];

export const phoneSlots: readonly ContactSlot[] = [
  new ContactSlot("business", gt`Business *=> Business address or phone number`, "work", false, 0),
  new ContactSlot("business2", gt`Business 2`, "work", false, 1),
  new ContactSlot("business-fax", gt`Business Fax`, "work", true, 0),
  new ContactSlot("home", gt`Home *=> Private address or phone number`, "home", false, 0),
  new ContactSlot("home2", gt`Home 2`, "home", false, 1),
  new ContactSlot("home-fax", gt`Home Fax`, "home", true, 0),
  new ContactSlot("mobile", gt`Mobile *=> Cell phone number`, "mobile", false, 0),
  new ContactSlot("other", gt`Other *=> Email address or phone number that is not home or work`, "other", false, 0),
  new ContactSlot("other-fax", gt`Other Fax`, "other", true, 0),
];

export const addressSlots: readonly ContactSlot[] = [
  new ContactSlot("business", gt`Business *=> Business address or phone number`, "work", false, 0),
  new ContactSlot("home", gt`Home *=> Private address or phone number`, "home", false, 0),
  new ContactSlot("other", gt`Other *=> Email address or phone number that is not home or work`, "other", false, 0),
];

export function phoneSlot(id: string): ContactSlot {
  return phoneSlots.find(slot => slot.id == id);
}

export function slotOfEntry(entry: ContactEntry, entries: ArrayColl<ContactEntry>, slots: readonly ContactSlot[]): ContactSlot | null {
  return slots.find(slot => slot.entryIn(entries) == entry) ?? null;
}
