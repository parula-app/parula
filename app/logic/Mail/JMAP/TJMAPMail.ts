/** <https://www.rfc-editor.org/rfc/rfc8621.html#section-2.6> */
export interface TJMAPFolder {
  id: string,
  name: string,
  parentId: string,
  role: string,
  isSubscribed: boolean,
  sortOrder: number,
  totalEmails: number,
  unreadEmails: number,
  totalThreads: number,
  unreadThreads: number,
  myRights: TJMAPFolderRights,
  /** Principal ID -> their rights. RFC 8621 doesn't define mailbox sharing,
   * so the rights names differ per server. @see `JMAPAccount.mailShareRights()` */
  shareWith?: Record<string, Record<string, boolean>>,
}

export interface TJMAPFolderRights {
  mayAddItems: boolean,
  mayRename: boolean,
  maySubmit: boolean,
  mayDelete: boolean,
  maySetKeywords: boolean,
  mayRemoveItems: boolean,
  mayCreateChild: boolean,
  maySetSeen: boolean,
  mayReadItems: boolean,
}

/** <https://www.rfc-editor.org/rfc/rfc8621.html#section-4.2.1> */
export interface TJMAPEMailHeaders {
  id: string,
  messageId: string[] | null,
  blobId: string,
  mailboxIds: Record<string, boolean>,
  subject: string,
  inReplyTo: string[] | null,
  threadId: string,

  sender: string,
  from: TJMAPPerson[],
  to: TJMAPPerson[],
  cc: TJMAPPerson[],
  bcc: TJMAPPerson[],
  replyTo: string,

  receivedAt: string,
  sentAt: string,
  hasAttachment: boolean,
  size: number,
  keywords: Record<string, boolean>,
  preview: string,
}

export interface TJMAPPerson {
  name: string | null,
  email: string,
}

/** <https://www.rfc-editor.org/rfc/rfc8621.html#section-6> */
export interface TJMAPIdentity {
  id: string,
  name: string,
  /** Immutable. `*@example.com` = catch-all */
  email: string,
  replyTo: TJMAPEmailAddress[] | null,
  bcc: TJMAPEmailAddress[] | null,
  textSignature: string,
  htmlSignature: string,
  mayDelete: boolean,
}

/** <https://www.rfc-editor.org/rfc/rfc8621.html#section-4.1.4> */
export interface TJMAPEmailBodyPart {
  partId?: string;
  blobId: string;
  size: number;
  name?: string | null;
  type: string;
  charset?: string | null;
  disposition?: string | null;
  cid?: string | null;
  headers?: TJMAPEmailHeader[];
  language?: string[] | null;
  location?: string | null;
  subParts?: TJMAPEmailBodyPart[] | null;
  bodyStructure?: TJMAPEmailBodyPart;
  bodyValues?: { [key: string]: TJMAPEmailBodyPart };
  textBody?: TJMAPEmailBodyPart[];
  htmlBody?: TJMAPEmailBodyPart[];
  attachments?: TJMAPEmailBodyPart[];
  hasAttachment?: boolean;
  preview?: string;
}

export interface TJMAPEmailHeader {
  name: string,
  value: string,
}

export interface TJMAPEmailAddress {
  name: string | null,
  email: string,
}
