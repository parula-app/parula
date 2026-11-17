import type { URLString } from "../../util/util";

/**
 * String of 1-255 octets containing only URL and Filename Safe base64url
 * alphabet characters (A-Za-z0-9, hyphen, underscore), excluding padding
 */
export type TID = string;

/**
 * TUnsignedInt: Integer in the range 0 to 2^53-1
 */
export type TInteger = number;

/**
 * String in RFC3339 "date-time" format with uppercase letters
 * and "Z" time offset. Fractional seconds must not have trailing zeros.
 * Example: "2010-10-10T10:10:10.003Z"
 */
export type TUTCDateTime = string;

/** <https://www.rfc-editor.org/rfc/rfc8620.html#section-2> */
export interface TJMAPSession {
  capabilities: Record<string, Record<string, any>>;
  /** accountID -> account. Ours, plus the accounts shared with us that we subscribed to.
   * @see <https://www.rfc-editor.org/rfc/rfc9670.html#section-1.4> */
  accounts: Record<TID, TJMAPSessionAccount>;
  /** capability URL -> accountID */
  primaryAccounts: Record<string, string>;
  username: string;
  /** URL to use for JMAP API requests */
  apiUrl: URLString;
  /** URL to use when downloading files, in URI Template format, e.g. https://foo/{var}/ */
  downloadUrl: URLString;
  /** URL to use when uploading files, in URI Template format, e.g. https://foo/{var}/ */
  uploadUrl: URLString;
  /** URL to connect to for push events, in URI Template format, e.g. https://foo/{var}/ */
  eventSourceUrl: URLString;
  state: string;
}

export interface TJMAPSessionAccount {
  /** A user-friendly string to show when presenting content from
   * this account, e.g., the email address representing the owner of
   * the account. */
  name: string;
  /** Our user is the primary owner of this account */
  isPersonal: boolean;
  isReadOnly: boolean;
  accountCapabilities: Record<string, Record<string, any>>;
}

/** A user, group, room or other entity that we can share our data with.
 * <https://www.rfc-editor.org/rfc/rfc9670.html#section-2> */
export interface TJMAPPrincipal {
  id: TID;
  type: "individual" | "group" | "resource" | "location" | "other";
  name: string;
  description?: string;
  email?: string;
  timeZone?: string;
  capabilities?: Record<string, Record<string, any>>;
  /** accountID -> `accountCapabilities`, for this principal's accounts that we
   * may access. Cyrus instead returns a single `accountId`. */
  accounts?: Record<TID, Record<string, any>>;
}

/** Another user changed our access to their data.
 * <https://www.rfc-editor.org/rfc/rfc9670.html#section-3> */
export interface TJMAPShareNotification {
  id: TID;
  created: TUTCDateTime;
  changedBy: { name: string, email?: string, principalId?: TID };
  // `objectType` intentionally omitted: Cyrus hardcodes it to "Calendar", and we don't need it
  /** The account that the object is in, i.e. the account shared with us */
  objectAccountId: TID;
  objectId: TID;
  oldRights?: Record<string, boolean>;
  /** Null when they revoked our access */
  newRights?: Record<string, boolean>;
  name: string;
}

/** <https://www.rfc-editor.org/rfc/rfc8620.html#section-3.3> */
export interface TJMAPAPIRequest {
  using: string[];
  methodCalls: TJMAPMethodCall[];
}

/** <https://www.rfc-editor.org/rfc/rfc8620.html#section-3.4> */
export interface TJMAPAPIResponse {
  methodResponses: TJMAPMethodResponse[];
  sessionState: string;
}

/** <https://www.rfc-editor.org/rfc/rfc8620#section-5.1> */
export interface TJMAPGetResponse<T> {
  accountId: string;
  state: string;
  list: T[];
  notFound: string[];
  total: number;
}

/** <https://www.rfc-editor.org/rfc/rfc8620#section-5.5> */
export interface TJMAPQueryResponse {
  accountId: string;
  queryState: string;
  ids: string[];
  position: number;
  limit?: number;
  total?: number;
  canCalculateChanges: boolean;
}

/** <https://www.rfc-editor.org/rfc/rfc8620#section-5.2> */
export interface TJMAPChangeResponse<T> {
  accountId: string;
  oldState?: string;
  newState: string;
  hasMoreChanges: boolean;
  created?: Record<string, T>,
  updated?: Record<string, T | null>;
  destroyed?: string[];
  notCreated?: Record<string, TJMAPSetError>,
  notUpdated?: Record<string, TJMAPSetError>;
  notDestroyed?: Record<string, TJMAPSetError>;
}

/** <https://www.rfc-editor.org/rfc/rfc8620.html#section-3.6.1> */
export interface TJMAPAPIErrorResponse {
  type: string;
  status: number;
  detail: string;
  limit?: number;
}

export interface TJMAPError {
  type: string;
}

/** <https://www.rfc-editor.org/rfc/rfc8620.html#section-3.6.2> */
export interface TJMAPAPICallError extends TJMAPError {
  status: number;
  detail: string;
}

/** <https://www.rfc-editor.org/rfc/rfc8620.html#section-5.3> */
export interface TJMAPSetError extends TJMAPError {
  description?: string;
  properties: string[];
}

/** Contents: method name, arguments, call number */
export type TJMAPMethodCall = [string, Record<string, any>, string];
/** Contents: method name, arguments, call number */
export type TJMAPMethodResponse = [string, Record<string, any>, string];
export type TJMAPObjectType = "Mailbox" | "Email" | "Identity" | "EmailSubmission" | "Thread" | "AddressBook" | "ContactCard" | "Calendar" | "CalendarEvent" | "CalendarEventNotification" | "ParticipantIdentity" | "ShareNotification";
export const TJMAPObjectTypes = ["Mailbox", "Email", "Identity", "EmailSubmission", "Thread", "AddressBook", "ContactCard", "Calendar", "CalendarEvent", "CalendarEventNotification", "ParticipantIdentity", "ShareNotification" ];


/** <https://www.rfc-editor.org/rfc/rfc8620.html#section-6.1> */
export interface TJMAPUpload {
  accountId: string,
  blobId: string,
  type: string,
  size: number,
}

/** <https://www.rfc-editor.org/rfc/rfc8620.html#section-7.1> */
export interface TJMAPStateChange {
  "@type": string,
  changed: Record<string, Record<TJMAPObjectType, string>>,
}
