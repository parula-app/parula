import { ICalParser, type ICalEntry, type ICalContainer } from "../../Calendar/ICal/ICalParser";
import type { Person } from "../../Abstract/Person";
import { ContactEntry } from "../../Abstract/Person";
import type { CardDAVPerson } from "../CardDAV/CardDAVPerson";
import { StreetAddress } from "../StreetAddress";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import type { ArrayColl, Collection } from 'svelte-collections';
import { gt } from "../../../l10n/l10n";

/** This file contains various functions that map between vCard formats:
 * - `parseContact()` converts from string to a rich intermediate object.
 * - `vCardToContainer()` converts from the rich intermediate object to a record.
 * - `containerToVCard()` converts from the record to a string.
 *
 * Additionally, there are functions to import from and export to Person:
 * - `updatePerson()` imports from the rich intermediate object to Person.
 * - `updateContainerFromPerson()` imports from Person to a record.
 * - `personToVCard()` exports from Person to a string, optionally preserving
 *   unrecognised properties previously extracted from `vCardToContainer()`.
 *
 * The higher level convenience functions are:
 * - `convertVCardToPerson()` combines `parseContact()` and `updatePerson()`.
 * - `getUpdatedVCard()` combines `vCardToContainer()` and `personToVCard()`.
 */

/**
 * Parses an addressbook vCard string to an array of rich intermediate vCard objects.
 * @throws if no vCard could be found
 */
export function parseAddressbook(text: string): ICalContainer[] {
  let parsed = new ICalParser(text);
  if (!parsed.containers.vcard) {
    throw new Error(gt`No vCard found`);
  }
  return parsed.containers.vcard;
}

/**
 * Parses a contact vCard string to a rich intermediate vCard object.
 * @throws if no vCard could be found
 */
export function parseContact(text: string): ICalContainer {
  return parseAddressbook(text)[0];
}

/**
 * Takes a vCard as a string of text and write its data to the Person object.
 */
export function convertVCardToPerson(vcard: string, person: Person) {
  updatePerson(parseContact(vcard), person);
}

/**
 * Writes a rich intermediate vCard object to a Person object.
 */
export function updatePerson(vcard: ICalContainer, person: Person) {
  (person as CardDAVPerson).uid = sanitize.nonemptystring(vcard.entries.uid?.[0].value, person.id);
  person.name = vcard.entries.fn?.[0].value ?? "";
  if (vcard.entries.photo) {
    let photo = vcard.entries.photo[0];
    if (/^b$/i.test(photo.properties.encoding)) { // vCard 3.0
      person.picture = "data:image/" + photo.properties.type?.toLowerCase() + ";base64," + photo.value;
    } else { // vCard 3.0 or 4.0
      person.picture = photo.value;
    }
  } else {
    person.picture = null;
  }
  person.lastName = vcard.entries.n?.[0].values[0] ?? "";
  person.firstName = vcard.entries.n?.[0].values[1] ?? "";
  person.emailAddresses.clear();
  if (vcard.entries.email) {
    for (let entry of vcard.entries.email) {
      person.emailAddresses.add(makeContactEntry(entry, "mailto", true, true));
    }
  }
  person.phoneNumbers.clear();
  if (vcard.entries.tel) {
    for (let entry of vcard.entries.tel) {
      person.phoneNumbers.add(makeContactEntry(entry, "tel", entry.properties.value == "uri", true));
    }
  }
  person.chatAccounts.clear();
  if (vcard.entries.impp) {
    for (let entry of vcard.entries.impp) {
      person.chatAccounts.add(makeContactEntry(entry));
    }
  }
  person.urls.clear();
  if (vcard.entries.url) {
    for (let entry of vcard.entries.url) {
      person.urls.add(makeContactEntry(entry));
    }
  }
  person.streetAddresses.clear();
  if (vcard.entries.adr) {
    for (let entry of vcard.entries.adr) {
      let [ poBox, extra, street, city, state, postalCode, country ] = entry.values;
      let address = new StreetAddress();
      address.street = street;
      address.instructions = poBox || extra ? [extra ?? "", poBox].join("\n") : null;
      address.city = city;
      address.postalCode = postalCode;
      address.state = state;
      address.country = country;
      entry.value = address.toString();
      person.streetAddresses.add(makeContactEntry(entry));
    }
  }
  person.notes = vcard.entries.note?.[0].value ?? "";
  person.company = vcard.entries.org?.[0].values[0] ?? "";
  person.department = vcard.entries.org?.[0].values[1] ?? "";
  if (vcard.entries.title) {
    person.position = vcard.entries.title[0].values[0];
  } else if (vcard.entries.role) {
    person.position = vcard.entries.role[0].values[0];
  } else {
    person.position = "";
  }
  person.custom.clear();
  for (let i = 1; vcard.entries["xcustom" + i]; i++) {
    person.custom.add(new ContactEntry(vcard.entries["xcustom" + i][0].value));
  }
}

/**
 * Takes a vCard file with many contacts (multiple vCards concatenated) and
 * returns Person objects for it.
 * @param vcardFile file contents
 * @param newPerson Factory function to create the subclass of Person that you need
 */
export function convertVCardsToPersons(vcardFile: string, newPerson: () => Person, errorCallback: (ex: Error) => void): Person[] {
  let persons = [];
  let cards = parseAddressbook(vcardFile);
  for (let vCard of cards) {
    try {
      let person = newPerson();
      updatePerson(vCard, person);
      persons.push(person);
    } catch (ex) {
      errorCallback(ex);
    }
  }
  return persons;
}

/**
 * Generates a VCard as a string of text from a Person object, with an optional
 * record object to carry over unrecognised properties.
 */
export function personToVCard(person: Person, container: Record<string, string[]> = Object.create(null)): string {
  updateContainerFromPerson(person, container);
  return containerToVCard(container);
}

/**
 * Exports the given persons into a single large vCard file with all contacts
 * concatenated
 * @param persons what to export
 * @param filenameWithoutExt a suggested filename, without extension.
 *    The name will be name filesystem-safe.
 * @returns vCard file contents, as UTF8 text file
 */
export function personsToVCardFile(persons: Collection<Person>, filenameWithoutExt: string): File {
  let fileContents = "";
  for (let person of persons) {
    fileContents += personToVCard(person);
  }
  let filename = sanitize.filename(filenameWithoutExt) + ".vcf";
  let file = new File([fileContents], filename, { type: "text/vcard" });
  return file;
}

/**
 * Generates a VCard as a string of text from a Person object, carrying over
 * unrecognised properites from a rich intermediate VCard object.
 */
export function getUpdatedVCard(person: Person, vcard: ICalContainer): string {
  let container = vCardToContainer(vcard);
  updateContainerFromPerson(person, container);
  return containerToVCard(container);
}

/**
 * Creates a record object from properties of a rich intermediate VCard object.
 */
export function vCardToContainer(vcard: ICalContainer): Record<string, string[]> {
  let container: Record<string, string[]> = Object.create(null);
  for (let key in vcard.entries) {
    if (key != "version" && key != "prodid") {
      container[key] = vcard.entries[key].map(entry => entry.line);
    }
  }
  return container;
}

/**
 * Updates a record object from a Person object.
 */
export function updateContainerFromPerson(person: Person, container: Record<string, string[]>) {
  if (!container.uid) { // Why not always: Never change the UID that the contact has on the server
    setValue(container, "uid", (person as CardDAVPerson).uid ?? person.id);
  }
  setValue(container, "fn", person.name ?? "");
  setValue(container, "photo", person.picture ?? "", { value: "uri" });
  setValue(container, "n", [person.lastName, person.firstName, "", "", ""]);
  setValues(container, "email", person.emailAddresses);
  setValues(container, "tel", person.phoneNumbers, { value: "text" });
  setValues(container, "impp", person.chatAccounts);
  setValues(container, "url", person.urls);
  setAdrs(container, person.streetAddresses);
  setValue(container, "note", person.notes ?? "");
  setValue(container, "org", [person.company, person.department]);
  setValue(container, "title", person.position ?? "");
  setValue(container, "role", "");
  let i = 0;
  for (; i < person.custom.length; i++) {
    setValue(container, "x-custom" + (i + 1), person.custom.getIndex(i).value);
  }
  while (("xcustom" + ++i) in container) {
    delete container["xcustom" + i];
  }
}

/**
 * Generates a VCard as a string of text from a record object.
 */
function containerToVCard(container: Record<string, string[]>): string {
  return "BEGIN:VCARD\r\nVERSION:4.0\r\nPRODID:-//Beonex//appName//EN\r\n" + Object.values(container).flat().map(line => line.match(/.{1,75}/gu).join("\r\n ")).join("\r\n") + "\r\nEND:VCARD\r\n";
}

function makeContactEntry(entry: ICalEntry, protocol?: string, isURI = true, stripProtocol = false) {
  let value = entry.value;
  if (isURI && /^(\w+):/.test(value)) {
    protocol = RegExp.$1.toLowerCase();
    if (stripProtocol) {
      value = value.slice(protocol.length + 1);
    }
  }
  // An entry's type property can contain multiple tokens; in particular
  // vCard 3.0 supports the token pref for the preferred entry,
  // which is superseded by the pref property in vCard 4.0.
  return new ContactEntry(
    value,
    /work/i.test(entry.properties.type) ? "work" : /home/i.test(entry.properties.type) ? "home" : "other",
    protocol,
    sanitize.integer(entry.properties.pref, /pref/i.test(entry.properties.type) ? 1 : ContactEntry.defaultPreference));
}

function setValue(container: Record<string, string[]>, key: string, value: string | string[] | null, parameters: Record<string, string> = {}) {
  if (Array.isArray(value) ? !value.some(Boolean) : !value) {
    delete container[key];
    return;
  }
  if (typeof value == "string" && parameters.value != "uri") {
    value = value.split(";");
  }
  let line = key.toUpperCase();
  for (let parameter in parameters) {
    // We control parameters, no need to escape
    line += ";" + parameter.toUpperCase() + "=" + parameters[parameter];
  }
  line += ":";
  // `;` and `,` are part of a URI, e.g. of a `data:` URL, and must stay unescaped
  line += typeof value == "string" ? value : value.map(value => escaped(value, false)).join(";");
  container[key.replace("-", "")] = [line];
}

function setValues(container: Record<string, string[]>, key: string, values: ArrayColl<ContactEntry>, parameters: Record<string, string> = {}) {
  container[key] = values.contents.map(entry => {
    let line = key.toUpperCase();
    for (let parameter in parameters) {
      // We control parameters, no need to escape
      line += ";" + parameter.toUpperCase() + "=" + parameters[parameter];
    }
    let type = entry.purpose == "work" || entry.purpose == "home" ? entry.purpose : "";
    if (entry.preference == 1) {
      type = type ? type + ",pref" : "pref";
    }
    if (type) {
      line += ";TYPE=" + type.toUpperCase();
    }
    if (entry.preference && entry.preference != ContactEntry.defaultPreference) {
      line += `;PREF=${entry.preference}`;
    }
    line += ":";
    line += entry.value.split(";").map(value => escaped(value, false)).join(";");
    return line;
  });
}

function setAdrs(container: Record<string, string[]>, contactEntries: ArrayColl<ContactEntry>) {
  container.adr = contactEntries.contents.map(ce => {
    let line = "ADR";
    let type = ce.purpose == "work" || ce.purpose == "home" ? ce.purpose : "";
    if (ce.preference == 1) {
      type = type ? type + ",pref" : "pref";
    }
    if (type) {
      line += ";TYPE=" + type.toUpperCase();
    }
    if (ce.preference && ce.preference != ContactEntry.defaultPreference) {
      line += `;PREF=${ce.preference}`;
    }
    line += ":";
    let address = new StreetAddress(ce.value);
    let extra = address.instructions;
    let poBox = "";
    let spl = address.instructions?.split("\n");
    if (spl?.length == 2) {
      [extra, poBox] = spl;
    }
    let ordered = [
      poBox,
      extra,
      address.street,
      address.city,
      address.state,
      address.postalCode,
      address.country,
    ];
    line += ordered.map(value => escaped(value ?? "", false)).join(";");
    return line;
  });
}

function escaped(s: string, quote: boolean): string {
  if (!s) {
    return "";
  }
  if (quote) {
    // param-value isn't supposed to include these at all;
    // maybe we should just delete them?
    s = s.replace(/["\\]/g, "\\$&").replace(/\r\n?|\n/g, "\\n");
    if (/[\\:;,]/.test(s)) {
      s = `"${s}"`;
    }
  } else {
    s = s.replace(/[\\;,]/g, "\\$&").replace(/\r\n?|\n/g, "\\n");
  }
  return s;
}
