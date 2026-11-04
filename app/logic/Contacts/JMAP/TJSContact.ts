import type { TID, TInteger, TUTCDateTime } from "../../Mail/JMAP/TJMAPGeneric";

/** <https://www.rfc-editor.org/rfc/rfc9553.html#name-card> */
export interface TJMAPContact extends TJSContact {
  id: TID;
  addressBookIds: Record<TID, boolean>;
}

/** <https://www.rfc-editor.org/rfc/rfc9553.html#name-card> */
export interface TJSContact {
  /** JSContact version (e.g., "1.0") */
  version: string;
  /** Stable ID for this card */
  uid?: string;
  /** Software that wrote this data */
  prodId?: string;
  /** Creation timestamp */
  created?: TUTCDateTime;
  /** Last update timestamp */
  updated?: TUTCDateTime;
  /** Kind of entity */
  kind?: "individual" | "group" | "org" | "application" | "device" | "location";
  /** Primary language tag */
  language?: string;
  /** Members of this group (if kind is "group") */
  members?: Record<string, true>;

  name?: TName;
  nicknames?: Record<TID, TNickname>;
  organizations?: Record<TID, TOrganization>;
  /** Job titles and roles */
  titles?: Record<TID, {
    "@type"?: "Title";
    /** The title or role */
    name: string;
    /** Kind of title */
    kind?: "role" | "title";
    /** Reference to organization */
    organizationId?: string;
  }>;
  speakToAs?: {
    "@type"?: "SpeakToAs";
    grammaticalGender?: "common" | "masculine" | "feminine";
  };

  // Contact information
  emails?: Record<TID, TEmailAddress>;
  phones?: Record<TID, TPhone>;
  onlineServices?: Record<TID, TOnlineService>;
  links?: Record<TID, TLink>;
  preferredLanguages?: Record<TID, TLanguagePref>;

  /** Postal street addresses */
  addresses?: Record<TID, TAddress>;

  calendars?: Record<TID, TCalendar>;
  schedulingAddresses?: Record<TID, TSchedulingAddress>;

  /** Photos, logos, sounds */
  media?: Record<TID, TMedia>;
  cryptoKeys?: Record<TID, TCryptoKey>;
  directories?: Record<TID, TDirectory>;

  /** Free-text notes */
  notes?: Record<TID, TNote>;
  /** Hobbies, interests, expertise */
  personalInfo?: Record<TID, TPersonalInfo>;
  /** Tags */
  keywords?: Record<string, true>;
  /** Friends, family etc. */
  relatedTo?: Record<string, TRelation>;
  anniversaries?: Record<TID, TAnniversary>;

  localizations?: Record<string, Record<string, any>>;
}

/**
 * Base type for resources identified by URI
 */
export interface TResource {
  "@type"?: string;
  uri: string;
  mediaType?: string;
  /** Preference order (1-100, lower values indicate higher preference) */
  pref?: TInteger;
  label?: string;
  contexts?: Record<string, true>;
}

export type TNameComponentKind =
  | "credential"
  | "generation"
  | "given"
  | "given2"
  | "separator"
  | "surname"
  | "surname2"
  | "title";

export interface TNameComponent {
  "@type"?: "NameComponent";
  kind: TNameComponentKind;
  value: string;
  phonetic?: string;
}

export type TPhoneticSystem =
  | "ipa"
  | "jyut"
  | "piny"
  | "script";

export interface TName {
  "@type"?: "Name";
  full?: string;
  /** Name components making up this name */
  components?: TNameComponent[];
  isOrdered?: boolean;
  defaultSeparator?: string;
  sortAs?: Record<string, string>;
  phoneticSystem?: TPhoneticSystem;
  phoneticScript?: string;
}

export type TAddressComponentKind =
  | "apartment"
  | "block"
  | "building"
  | "country"
  | "direction"
  | "district"
  | "floor"
  | "landmark"
  | "locality"
  | "name"
  | "number"
  | "postcode"
  | "postOfficeBox"
  | "region"
  | "room"
  | "separator"
  | "subdistrict";

export interface TAddressComponent {
  "@type"?: "AddressComponent";
  kind: TAddressComponentKind;
  value: string;
  phonetic?: string;
}

export interface TAddress {
  "@type"?: "Address";
  full?: string;
  /** Address components making up this address */
  components?: TAddressComponent[];
  isOrdered?: boolean;
  defaultSeparator?: string;
  /** Geographical coordinates (e.g., "geo:37.786971,-122.399677") */
  coordinates?: string;
  /** 2-letter ISO 3166-1 alpha-2 country code */
  countryCode?: string;
  /** Contexts in which to use this address */
  contexts?: Record<"billing" | "delivery" | "private" | "work", true>;
  /** Preference order */
  pref?: TInteger;
  timeZone?: string;
  phoneticSystem?: TPhoneticSystem;
  phoneticScript?: string;
}

export type TPrivateOrWork = Record<"private" | "work", true>;

export interface TEmailAddress {
  "@type"?: "EmailAddress";
  address: string;
  /** Contexts in which to use this email */
  contexts?: TPrivateOrWork;
  /** Preference order */
  pref?: TInteger;
  label?: string;
}

export type TPhoneFeature = Record<"voice" | "mobile" | "main-number" | "fax" | "pager" | "text" | "textphone" | "video", true>;

export interface TPhone {
  "@type"?: "Phone";
  /** Phone number, either URI or free-form, e.g.
   * `tel:+1-650-555-1234;ext=1234` or
   * `650-555-1234 x 1234`
   */
  number: string;
  /** Phone, fax etc. */
  features?: TPhoneFeature;
  /** Contexts in which to use this phone */
  contexts?: TPrivateOrWork;
  pref?: TInteger;
  label?: string;
}

export interface TOnlineService {
  "@type"?: "OnlineService";
  /** URI of the user, e.g.
   * `xmpp:alice@example.com` or
   *  `https://example2.com/@alice` */
  uri?: string;
  /** User ID, e.g. `@alice@example2.com` */
  user?: string;
  /** Name of the online service, e.g. "Mastodon" */
  service?: string;
  /** Contexts in which to use this service */
  contexts?: TPrivateOrWork;
  /** Preference order */
  pref?: TInteger;
  label?: string;
}

export interface TLanguagePref {
  "@type"?: "LanguagePref";
  /** Language tag (RFC 5646) */
  language: string;
  contexts?: Record<string, true>;
  pref?: TInteger;
}

export interface TOrganization {
  "@type"?: "Organization";
  name?: string;
  units?: TOrgUnit[];
  sortAs?: string;
  contexts?: TPrivateOrWork;
}

export interface TOrgUnit {
  "@type"?: "OrgUnit";
  name: string;
  sortAs?: string;
}

export interface TNickname {
  "@type"?: "Nickname";
  name: string;
  contexts?: TPrivateOrWork;
  pref?: TInteger;
}

export interface TAnniversary {
  "@type"?: "Anniversary";
  kind?: "birth" | "death" | "wedding";
  /** Date of the anniversary */
  date: {
    "@type": "Timestamp";
    utc: TUTCDateTime;
  } | {
    "@type"?: "PartialDate";
    /** Year */
    year?: TInteger;
    /** Month (1-12) */
    month?: TInteger;
    /** Day of month (1-31) */
    day?: TInteger;
    /** Default: "gregorian" */
    calendarScale?: string;
  };
  /** Place associated with the anniversary */
  place?: TAddress;
}

export interface TMedia extends TResource {
  "@type"?: "Media";
  kind: "logo" | "photo" | "sound";
}

export interface TLink extends TResource {
  "@type"?: "Link";
  kind?: "contact";
}

export interface TCryptoKey extends TResource {
  "@type"?: "CryptoKey";
  /** Kind of cryptographic key */
  kind: string;
}

export interface TDirectory extends TResource {
  "@type"?: "Directory";
  kind: "directory" | "entry";
  listAs?: TInteger;
}

export interface TCalendar extends TResource {
  "@type"?: "Calendar";
  kind: "calendar" | "freeBusy";
}

export interface TSchedulingAddress {
  "@type"?: "SchedulingAddress";
  uri: string;
  contexts?: Record<string, true>;
  pref?: TInteger;
  label?: string;
}

export interface TNote {
  "@type"?: "Note";
  note: string;
  author?: {
    "@type"?: "Author";
    name?: string;
    uri?: string;
  };
  created?: TUTCDateTime;
}

export interface TPersonalInfo {
  "@type"?: "PersonalInfo";
  kind: "expertise" | "hobby" | "interest";
  value: string;
  /** Level of expertise or engagement */
  level?: "high" | "low" | "medium";
  listAs?: TInteger;
  label?: string;
}

export type TRelationType =
  | "acquaintance"
  | "agent"
  | "child"
  | "colleague"
  | "contact"
  | "co-resident"
  | "co-worker"
  | "crush"
  | "date"
  | "emergency"
  | "friend"
  | "kin"
  | "me"
  | "met"
  | "muse"
  | "neighbor"
  | "parent"
  | "sibling"
  | "spouse"
  | "sweetheart";

export interface TRelation {
  "@type"?: "Relation";
  relation: Record<TRelationType, true>;
  /** URI of the related person's card */
  uri: string;
}
