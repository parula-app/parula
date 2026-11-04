import type { PersonOrGroup } from "../../frontend/Contacts/Person/PersonOrGroup";

export class LetterIndex<T extends PersonOrGroup> {
  static readonly symbolLetter = "#";
  static readonly alphabet: readonly string[] = [LetterIndex.symbolLetter, ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
  protected static readonly collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

  protected readonly firstContacts = new Map<string, T>();

  constructor(sortedContacts: Iterable<T>) {
    for (let contact of sortedContacts) {
      let letter = LetterIndex.letterFor(contact.name);
      if (!this.firstContacts.has(letter)) {
        this.firstContacts.set(letter, contact);
      }
    }
  }

  static compareByName(a: PersonOrGroup, b: PersonOrGroup): number {
    return LetterIndex.collator.compare(a.name?.trim() ?? "", b.name?.trim() ?? "");
  }

  static letterFor(name: string | null | undefined): string {
    let first = Array.from(name?.trim().normalize("NFD") ?? "")[0];
    if (!first || !/\p{L}/u.test(first)) {
      return LetterIndex.symbolLetter;
    }
    return first.toLocaleUpperCase();
  }

  hasLetter(letter: string): boolean {
    return this.firstContacts.has(letter);
  }

  contactAtOrAfter(letter: string): T | null {
    let start = LetterIndex.alphabet.indexOf(letter);
    if (start < 0) {
      return this.firstContacts.get(letter) ?? null;
    }
    for (let nextLetter of LetterIndex.alphabet.slice(start)) {
      let contact = this.firstContacts.get(nextLetter);
      if (contact) {
        return contact;
      }
    }
    return null;
  }
}
