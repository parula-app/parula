import { type Person, ContactEntry } from '../../Abstract/Person';
import type { TEmailAddress, TJSContact, TLink, TNameComponent, TOnlineService, TPhone, TPhoneFeature, TOrganization, TOrgUnit } from './TJSContact';
import type { JMAPPerson } from './JMAPPerson';
import type { TID } from '../../Mail/JMAP/TJMAPGeneric';
import { sanitize } from '../../../../lib/util/sanitizeDatatypes';
import { assert, ensureArray, randomID } from '../../util/util';
import type { ArrayColl } from 'svelte-collections';

export class JSContact {
  static toPerson(jscontact: TJSContact, person: Person) {
    (person as JMAPPerson).uid = sanitize.nonemptystring(jscontact.uid, person.id);
    person.name = sanitize.nonemptystring(jscontact.name?.full, "");
    if (!jscontact.name?.full && jscontact.name?.components) {
      let nameConcat = ensureArray(jscontact.name?.components)
        .map(c => sanitize.string(c.value))
        .join(sanitize.string(jscontact.name?.defaultSeparator));
      person.name = sanitize.nonemptystring(nameConcat, "");
    }
    person.firstName = sanitize.nonemptystring(jscontact.name?.components?.find(c => c.kind == "given")?.value, "");
    person.lastName = sanitize.nonemptystring(jscontact.name?.components?.find(c => c.kind == "surname")?.value, "");

    JSContact.toContactEntries(person.emailAddresses, jscontact.emails, e => new ContactEntry(
      // Contacts imported from vCard often have a `mailto:` URL here, not a bare address
      sanitize.emailAddress(e.address?.replace(/^mailto:/i, ""), null),
      null, "mailto"));
    JSContact.toContactEntries(person.phoneNumbers, jscontact.phones, e => new ContactEntry(
      sanitize.nonemptystring(e.number, null),
      null, JSContact.fromPhoneFeatureToProtocol(e.features)));
    JSContact.toContactEntries(person.chatAccounts, jscontact.onlineServices, e => new ContactEntry(
      sanitize.nonemptystring(e.uri ?? e.user, null),
      null, e.service));
    JSContact.toContactEntries(person.urls, jscontact.links, e => {
      let url = sanitize.url(e.uri, null, ["https", "http", "mailto", "tel", "fax"]); // ["*"] ?
      return new ContactEntry(url, null, url ? new URL(url).protocol.slice(0, -1) : null);
    });

    person.picture = sanitize.url(jscontact.media?.avatar?.uri, null, ["https", "data", "blob"]);

    person.notes = sanitize.nonemptystring(getOneValue(person, jscontact, jscontact.notes, "notes", entry => entry.note), "");
    person.position = sanitize.nonemptylabel(getOneValue(person, jscontact, jscontact.titles, "titles", entry => entry.name), "");
    let company = sanitize.object(getOneValue(person, jscontact, jscontact.organizations, "organizations", entry => entry), null) as TOrganization;
    person.company = sanitize.nonemptylabel(company?.name, "");
    person.department = sanitize.nonemptylabel(company?.units?.[0]?.name, "");
  }

  protected static fromContextToPurpose(contexts: Record<string, true>): string | null {
    return contexts?.private
      ? "home"
      : contexts?.work
        ? "work"
        : firstPropertyName(contexts);
  }

  protected static fromPurposeToContext(purpose: string): Record<string, true> {
    return purpose == "home"
      ? { private: true }
      : purpose == "work"
        ? { work: true }
        : { [purpose]: true };
  }

  protected static fromPhoneFeatureToProtocol(features: TPhoneFeature | undefined): string | null {
    let first = Object.keys(features ?? {})[0];
    return first == "voice" ? "tel" : first;
  }

  protected static fromProtocolToPhoneFeature(protocol: string): TPhoneFeature {
    let features = {} as TPhoneFeature;
    if (protocol == "tel") {
      features.voice = true;
    } else if (["mobile", "main-number", "fax", "pager", "text", "textphone", "video"].includes(protocol)) {
      features[protocol] = true;
    } else { // fallback for unsupported protocol
      features.voice = true;
    }
    return features;
  }

  /** Updates `jscontact` with the properties from `person`,
   * leaving any unsupported properties in jscontact as-is. */
  static fromPerson(person: Person, jscontact: TJSContact) {
    let now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    if (!jscontact.uid) {
      jscontact["@type"] = "Card";
      jscontact.version = "1.0";
      jscontact.created = now;
    }
    jscontact.uid = (person as JMAPPerson).uid ??= "urn:uuid:" + crypto.randomUUID();
    jscontact.updated = now;
    jscontact.name ??= {};
    jscontact.name.full = person.name;
    if (person.firstName || person.lastName) {
      jscontact.name.components ??= [];
      let first = jscontact.name.components.find(c => c.kind == "given");
      let last = jscontact.name.components.find(c => c.kind == "surname");
      if (!first) {
        first = {
          kind: "given",
        } as TNameComponent;
        jscontact.name.components.unshift(first);
      }
      if (!last) {
        last = {
          kind: "surname",
        } as TNameComponent;
        jscontact.name.components.push(last);
      }
      first.value = person.firstName;
      last.value = person.lastName;
    }

    jscontact.emails ??= {};
    jscontact.phones ??= {};
    jscontact.onlineServices ??= {};
    jscontact.links ??= {};
    JSContact.fromContactEntries<TEmailAddress>(jscontact.emails, person.emailAddresses, "address",
      () => { });
    JSContact.fromContactEntries<TPhone>(jscontact.phones, person.phoneNumbers, "number",
      (entry: any, personEntry: ContactEntry) => {
        entry.features = JSContact.fromProtocolToPhoneFeature(personEntry.protocol);
      });
    JSContact.fromContactEntries<TOnlineService>(jscontact.onlineServices, person.chatAccounts, "user",
      (entry: any, personEntry: ContactEntry) => {
        entry.service = personEntry.protocol;
      });
    JSContact.fromContactEntries<TLink>(jscontact.links, person.urls, "uri",
      () => { });
    // TODO
    // person.streetAddresses
    // person.popularity

    if (person.picture) {
      jscontact.media ??= {};
      jscontact.media.avatar = {
        uri: person.picture,
        kind: "photo",
      };
    } else {
      delete jscontact.media?.avatar;
    }

    setOneValue(person, jscontact, jscontact.notes, "notes", (entry) => entry.note = person.notes);
    setOneValue(person, jscontact, jscontact.titles, "titles", (entry) => entry.name = person.position);
    let company = {} as TOrganization;
    if (person.company || person.department) {
      company = sanitize.object(getOneValue(person, jscontact, jscontact.organizations, "organizations", entry => entry), {});
      company.name = person.company;
      if (person.department) {
        company.units ??= [];
        company.units[0] ??= {} as TOrgUnit;
        company.units[0].name = person.department;
      } else if (company.units?.length) {
        company.units.shift();
        if (!company.units.length) {
          delete company.units;
        }
      }
    }
    setOneValue(person, jscontact, jscontact.organizations, "organizations", (entry: TOrganization) => {
      entry.name = company.name;
      entry.units = company.units;
    });
  }

  protected static toContactEntries<T extends { pref?: number, contexts?: Record<string, true> }>(
    personEntriesAbstract: ArrayColl<ContactEntry>,
    jscontactEntries: Record<TID, T>,
    getValues: (e: T) => ContactEntry,
  ) {
    let personEntries = personEntriesAbstract as ArrayColl<ContactEntry>;
    for (let jmapID in jscontactEntries) {
      let jscontactEntry = jscontactEntries[jmapID];
      let newCE = getValues(jscontactEntry);
      if (!newCE.value) { // malformed value on the server, e.g. not an email address
        continue;
      }
      newCE.purpose = JSContact.fromContextToPurpose(jscontactEntry.contexts);
      newCE.preference = sanitize.integerRange(jscontactEntry.pref, 0, 100, 100);
      let existing = personEntries.find(p => getJMAPID(p) == jmapID);
      if (existing) {
        existing.value = newCE.value;
        existing.protocol = newCE.protocol;
        existing.purpose = newCE.purpose;
        existing.preference = newCE.preference;
      } else {
        setJMAPID(newCE, sanitize.alphanumdash(jmapID));
        personEntries.add(newCE);
      }
    }
    // Delete old entries
    for (let p of personEntries.contents) { // copy: remove alters personEntries
      let jmapID = getJMAPID(p);
      if (!jmapID || !jscontactEntries[jmapID]) {
        personEntries.remove(p);
      }
    }
  }

  protected static fromContactEntries<T extends { pref?: number, contexts?: Record<string, true> }>(
      jscontactEntries: Record<TID, T>,
      personEntriesAbstract: ArrayColl<ContactEntry>,
      valueProp: string,
      otherPropsFunc: (entry: any, personEntry: ContactEntry) => void
    ) {
    let personEntries = personEntriesAbstract as ArrayColl<ContactEntry>;
    for (let personEntry of personEntries) {
      let jmapID = getJMAPID(personEntry);
      if (!jmapID) {
        jmapID = crypto.randomUUID();
        setJMAPID(personEntry, jmapID);
      }
      let jscontactEntry = jscontactEntries[jmapID] ??= {} as T;
      jscontactEntry[valueProp] = personEntry.value;
      jscontactEntry.pref = personEntry.preference;
      jscontactEntry.contexts = JSContact.fromPurposeToContext(personEntry.purpose);
      otherPropsFunc(jscontactEntry, personEntry);
    }
    // Delete old entries
    for (let jmapID in jscontactEntries) {
      if (personEntries.find(p => getJMAPID(p) == jmapID)) {
        continue;
      }
      delete jscontactEntries[jmapID];
    }
  }
}

function objValues<TValue>(obj: Record<string, TValue>): TValue[] {
  if (!obj) {
    return [];
  }
  return Object.values(obj);
}

function firstPropertyName(obj: Record<string, any>): string | null {
  if (!obj || typeof (obj) != "object") {
    return null;
  }
  return sanitize.alphanumdash(Object.keys(obj)[0], null);
}

/** In order to write back the same ContactEntry to JSContact,
 * we need to save the ID, given that the value may change.
 * `jmapID` here is the ID of the property entry in JSContact, not the ID of the entire JSContact.
 * The right solution would be a `JMAPContactEntry` subclass, but then we would need to
 * adapt *all* places that create `new ContactEntry` to do `person.newContactEntry()`. */
function getJMAPID(contactEntry: ContactEntry): TID {
  return contactEntry.json?.jmapID;
}
function setJMAPID(contactEntry: ContactEntry, jmapID: TID) {
  contactEntry.json ??= {} as any;
  contactEntry.json.jmapID = jmapID;
}

/**
 * Many JSContact properties support multiple values, indexed by ID,
 * but we support only one, e.g. notes, corporate position etc.
 * By default, we read the first one, but the order of values in a JS Object changes
 * when you set a value, so we need to remember which ID we were reading,
 * so that we write back the correct one.
 * Rant: If JMAP used proper arrays instead of ID-based maps, we wouldn't have this problem,
 * we could simply use the index 0 all the time. This is very annoying.
 * @param jscontactEntries `= jscontact[propName]`
 */
function setOneValue<TValueObject>(personGeneric: Person, jscontact: JSContact, jscontactEntries: Record<string, TValueObject>, propName: string, setter: (obj: TValueObject) => void) {
  assert(jscontact[propName] == jscontactEntries, "propName needs to match the entries");
  if (!jscontactEntries) {
    jscontactEntries = jscontact[propName] ??= {};
  }
  let person = personGeneric as JMAPPerson;
  person.propertyFieldIDs ??= {};
  let id = person.propertyFieldIDs[propName] ??= firstPropertyName(jscontactEntries) ?? randomID();
  jscontactEntries[id] ??= {} as TValueObject;
  setter(jscontactEntries[id]);
}

function getOneValue<TValueObject, TValue>(personGeneric: Person, jscontact: JSContact, jscontactEntries: Record<string, TValueObject>, propName: string, getter: (obj: TValueObject) => TValue | null): TValue | null {
  assert(jscontact[propName] == jscontactEntries, "propName needs to match the entries");
  if (!jscontactEntries) {
    return null;
  }
  let person = personGeneric as JMAPPerson;
  person.propertyFieldIDs ??= {};
  let firstID = firstPropertyName(jscontactEntries);
  if (!firstID) {
    return null;
  }
  let id = person.propertyFieldIDs[propName] ??= firstID;
  if (!jscontactEntries[id]) { // our entry was deleted on the server
    id = person.propertyFieldIDs[propName] = firstID;
  }
  return getter(jscontactEntries[id]);
}
