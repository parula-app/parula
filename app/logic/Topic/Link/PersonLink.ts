import { TopicLink, TopicLinkType } from "./TopicLink";
import { Person } from "../../Abstract/Person";
import { findPerson } from "../../Abstract/PersonUID";
import { appGlobal } from "../../app";

/** `mailto:` URL with the email address, `tel:` with the phone number,
 * or the chat protocol and the chat ID, e.g. `xmpp:fred@jabber.org` or `matrix:@fred:matrix.org`.
 * Each user has their own contact for the same person. */
export class PersonLink extends TopicLink {
  readonly type = TopicLinkType.Person;
  static readonly targetClass = Person;
  protected readonly idProperty = "@id";
  protected readonly dateProperty = "dateCreated";
  declare target: Person | null;

  setTarget(person: Person) {
    super.setTarget(person);
    let emailAddress = person.emailAddresses.first?.value;
    let phoneNumber = person.phoneNumbers.first?.value;
    let chatAccount = person.chatAccounts.find(entry => !!entry.protocol);
    this.targetID = emailAddress ? "mailto:" + emailAddress.toLowerCase()
      : phoneNumber ? "tel:" + phoneNumber
      : chatAccount ? chatAccount.protocol + ":" + chatAccount.value.toLowerCase()
      : null;
    this.name = person.name;
  }

  async findTarget(): Promise<Person | null> {
    await Promise.all(appGlobal.addressbooks.contents.map(addressbook => addressbook.readFromDB()));
    if (this.targetID.startsWith("mailto:")) {
      this.target = findPerson(this.targetID.substring("mailto:".length)) ?? null;
    } else if (this.targetID.startsWith("tel:")) {
      let phoneNumber = this.targetID.substring("tel:".length);
      this.target = appGlobal.persons.find(person => person.phoneNumbers.some(entry => entry.value == phoneNumber)) ?? null;
    } else {
      this.target = appGlobal.persons.find(person => person.chatAccounts.some(entry => entry.protocol + ":" + entry.value?.toLowerCase() == this.targetID)) ?? null;
    }
    return this.target;
  }
}
