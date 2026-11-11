import type { URLString } from "../../util/util";
import type { UUID, IDString, DateTimeString, MIMEType } from "./TGraphGeneric";

/** <https://learn.microsoft.com/en-us/graph/api/resources/mailfolder> */
export interface TGraphFolder {
  id: UUID,
  displayName: string,
  parentFolderId: UUID,
  wellKnownName: string, // only available in beta
  childFolderCount: number,
  unreadItemCount: number,
  totalItemCount: number,
  isHidden: boolean, // by default, only visible folders are returned
}
//export const TGraphFolderProperties = ["id", "displayName", "parentFolderId",
//  "wellKnownName", "childFolderCount", "unreadItemCount", "totalItemCount"];

/** <https://learn.microsoft.com/en-us/graph/api/resources/message> */
export interface TGraphEMail {
  id: IDString,
  parentFolderId?: IDString,
  conversationId?: IDString,
  conversationIndex?: string,
  subject: string,
  createdDateTime?: DateTimeString,
  sentDateTime?: DateTimeString,
  receivedDateTime?: DateTimeString,
  lastModifiedDateTime?: DateTimeString,
  changeKey?: string,
  hasAttachments: boolean,
  isRead: boolean,
  isDraft: boolean,
  sender?: TGraphPersonUID,
  from: TGraphPersonUID,
  toRecipients: TGraphPersonUID[],
  ccRecipients: TGraphPersonUID[],
  bccRecipients: TGraphPersonUID[],
  replyTo?: TGraphPersonUID[],
  internetMessageHeaders?: TGraphEMailHeader[],
  internetMessageId?: string,
  categories: string[],
  importance: "normal" | "low" | "high",
  inferenceClassification?: "focused" | "other",
  bodyPreview?: string,
  body?: {
    contentType: "html" | "text",
    content: string,
  },
  isDeliveryReceiptRequested?: boolean,
  isReadReceiptRequested?: boolean,
  unsubscribeData?: string[],
  unsubscribeEnabled?: false,
  mentionsPreview?: any,
  webLink?: URLString,
  flag?: {
    flagStatus: "notFlagged" | "flagged" | "complete",
    startDateTime: DateTimeString,
    dueDateTime: DateTimeString,
    completedDateTime: DateTimeString,
  },
  attachments?: TGraphMailAttachment[];
}
export const TGraphEMailHeaderProperties = [
  "id",
  "conversationId",
  "subject",
  "createdDateTime",
  "sentDateTime",
  "receivedDateTime",
  "changeKey",
  "hasAttachments",
  "isRead",
  "isDraft",
  "from",
  "toRecipients",
  "ccRecipients",
  "bccRecipients",
  "replyTo",
  "internetMessageId",
  "categories",
  "flag",
];

export interface TGraphMailAttachment {
  id: IDString;
  /** file name */
  name: string,
  /** MIME type */
  contentType: MIMEType,
  isInline: boolean,
  /** in bytes */
  size: number,
  lastModifiedDateTime?: DateTimeString,
  contentId: string,
  contentLocation?: null,
  /** content of the attachment
   * base64 encoded */
  contentBytes?: string,
}

export interface TGraphEMailHeader {
  name: string,
  value: string,
}

/** <https://learn.microsoft.com/en-us/graph/api/resources/recipient> */
export interface TGraphPersonUID {
  emailAddress: {
    name: string,
    address: string,
  }
}

export interface TGraphFolderChanges {
}

/** <https://learn.microsoft.com/en-us/graph/api/resources/automaticrepliessetting>
 * The server is not consistent in the casing of the values. */
export interface TGraphAutoReplies {
  /** "disabled", "alwaysEnabled" or "scheduled" */
  status: string,
  /** "none", "contactsOnly" or "all" */
  externalAudience: string,
  scheduledStartDateTime?: TGraphDateTimeZone,
  scheduledEndDateTime?: TGraphDateTimeZone,
  /** HTML */
  internalReplyMessage: string,
  externalReplyMessage: string,
}

/** <https://learn.microsoft.com/en-us/graph/api/resources/datetimetimezone> */
export interface TGraphDateTimeZone {
  /** Without time zone, e.g. "2026-10-05T07:00:00.0000000" */
  dateTime: string,
  /** E.g. "UTC" */
  timeZone: string,
}
