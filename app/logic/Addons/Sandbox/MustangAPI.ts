import type { ChatAccount, EMail, HookPoints, MailAccount, SpecialFolder } from "../API/addon-api";
import type { Collection } from "svelte-collections";

export interface MustangAPI {
  readonly addon: AddonInfo;
  readonly ui: AddonUI;
  /** Needs the permission `mail.all` */
  readonly mail: { readonly accounts: Collection<MailAccount> };
  /** Needs the permission `chat.all` */
  readonly chat: { readonly accounts: Collection<ChatAccount> };
  readonly hooks: AddonHooks;
  readonly protocols: AddonProtocols;
  readonly storage: AddonStorage;
  /** Waits until a collection of app objects has all its items.
   * Collections in arguments and results come with their items. The collections of those items load when read, in the background. */
  loaded(collection: Collection<any>): Promise<void>;
}

export interface AddonInfo {
  readonly name: string;
  readonly version: string;
}

export interface AddonUI {
  onCommand(command: string, handler: (event: CommandEvent) => void | Promise<void>): void;
  /** In UI frames */
  readonly context: Subscribable<UIContext>;
}

export interface CommandEvent {
  /** From `message-toolbar` and `message-menu` */
  messages?: EMail[];
  /** From `composer-toolbar` */
  draft?: EMail;
}

export interface UIContext {
  /** In `message-panel` */
  message?: EMail;
  /** In a popup of `message-toolbar` and `message-menu` */
  messages?: EMail[];
  /** In a popup of `composer-toolbar` */
  draft?: EMail;
  theme: { dark: boolean };
}

export interface AddonHooks {
  /** Return `{ cancel }` to stop the app function, with this reason for the user. */
  before<P extends keyof HookPoints>(point: P, hook: (args: HookPoints[P]["args"]) => Promise<HookCancel | void> | HookCancel | void): void;
  /** Runs after the app function succeeded, with read-only arguments. */
  after<P extends keyof HookPoints>(point: P, hook: (args: HookPoints[P]["args"], result: HookPoints[P]["result"]) => void): void;
}

export interface HookCancel {
  cancel: string;
}

export interface AddonProtocols {
  /** In the main code: Implements the protocol with this `id` from `mustang.protocols` in the manifest */
  register(id: string, implementation: Protocol): void;
  /** In the main code: The server has new messages in this mail folder or chat room, e.g. from a push notification.
   * The app then calls `listMessages()` for it. */
  newMessages(accountID: string, folderOrRoomID: string): void;
  /** In the `setup` UI of a protocol: The account as the user entered it so far.
   * When the user continues, the app checks the login with the last values and creates the account. */
  setupAccount(account: AccountSetup): void;
}

/** From the `setup` UI. At most 10 KB together. */
export interface AccountSetup {
  /** Shown to the user, e.g. "Work" */
  name: string;
  username: string;
  /** The app stores it in its password storage. Only the protocol's `login()` gets it. */
  password?: string;
  /** https */
  serverURL?: string;
  /** Anything else that the protocol needs for this account */
  extra?: JSONValue;
}

/** The account, as the protocol operations get it */
export interface AccountData {
  /** For `mustang.protocols.newMessages()` */
  id: string;
  name: string;
  /** Of mail accounts */
  emailAddress: string | null;
  username: string;
  serverURL: string | null;
  extra: JSONValue | null;
}

/** A mail protocol, implemented by the addon. IDs are those of the server.
 * Every operation gets the account as first argument. Errors reach the user with their message. */
export interface MailProtocol {
  /** Before any other operation of this account. Also after the addon restarted. */
  login(account: AccountData, password: string | null): Promise<void>;
  listFolders(account: AccountData): Promise<FolderData[]>;
  /** The new, changed and removed messages since `syncState`, at most 1,000 per call.
   * The app calls again with the returned `syncState`, while `hasMore` is true.
   * @param syncState null = list all messages; else the `syncState` of the last call */
  listMessages(account: AccountData, folderID: string, syncState: string | null): Promise<MessageList>;
  /** @returns The complete messages in RFC 5322 format, at most 50 MB each */
  downloadMessages(account: AccountData, folderID: string, ids: string[]): Promise<{ id: string, mime: Uint8Array }[]>;
  /** Sets only the given flags */
  setFlags(account: AccountData, folderID: string, ids: string[], flags: MessageFlags): Promise<void>;
  moveMessages(account: AccountData, folderID: string, ids: string[], targetFolderID: string): Promise<void>;
  copyMessages(account: AccountData, folderID: string, ids: string[], targetFolderID: string): Promise<void>;
  deleteMessages(account: AccountData, folderID: string, ids: string[]): Promise<void>;
  /** @param parentID null = top level */
  createFolder(account: AccountData, parentID: string | null, name: string): Promise<FolderData>;
  renameFolder(account: AccountData, folderID: string, name: string): Promise<void>;
  /** Also deletes its messages and subfolders */
  deleteFolder(account: AccountData, folderID: string): Promise<void>;
  /** @param mime The complete message, made by the app, without Bcc header
   * @param from The envelope sender
   * @param recipients The envelope recipients, including Bcc */
  send(account: AccountData, mime: Uint8Array, from: string, recipients: string[]): Promise<void>;
}

/** The implementation of a protocol of the type that the manifest says */
export type Protocol = MailProtocol | ChatProtocol | CalendarProtocol | ContactsProtocol | FilesProtocol;

/** A list of changes since a sync state. The app calls again with `syncState`, while `hasMore` is true. */
export interface ChangeList {
  /** IDs of the items that are gone, at most 10,000 */
  removed?: string[];
  /** Opaque for the app, at most 10 KB. The app stores it. */
  syncState: string;
  /** There are more changes. The app calls again with `syncState`. */
  hasMore?: boolean;
}

/** A chat protocol, implemented by the addon. IDs are those of the server.
 * Every operation gets the account as first argument. Errors reach the user with their message. */
export interface ChatProtocol {
  /** Before any other operation of this account. Also after the addon restarted. */
  login(account: AccountData, password: string | null): Promise<void>;
  /** All chat rooms of the user, at most 10,000. Rooms that are no longer listed are removed. */
  listRooms(account: AccountData): Promise<RoomData[]>;
  /** The new, changed and removed messages of the room since `syncState`, at most 1,000 per call.
   * @param syncState null = list all messages; else the `syncState` of the last call */
  listMessages(account: AccountData, roomID: string, syncState: string | null): Promise<ChatMessageList>;
  /** @returns The ID of the message on the server */
  sendMessage(account: AccountData, roomID: string, message: OutgoingChatMessage): Promise<string>;
}

export interface RoomData {
  id: string;
  /** Of a group chat. A 1:1 chat has the name of the other person. */
  name?: string;
  /** true = group chat; false or missing = 1:1 chat with `members[0]` */
  isGroup?: boolean;
  /** Without the user, at most 10,000 */
  members?: ChatPersonData[];
}

export interface ChatPersonData {
  /** On the server */
  id: string;
  name?: string;
}

export interface ChatMessageList extends ChangeList {
  /** New and changed messages */
  messages: ChatMessageData[];
}

export interface ChatMessageData {
  id: string;
  /** Sent by the user */
  outgoing?: boolean;
  /** `ChatPersonData.id` of the sender */
  from?: string;
  /** Plain text, at most 1 MB */
  text?: string;
  /** Formatted text, at most 1 MB. Instead of `text`. The app sanitizes it. */
  html?: string;
  /** The ID of the message that this one answers */
  inReplyTo?: string;
  /** A Date, an ISO 8601 string, or ms since 1970 */
  sent?: Date | string | number;
  received?: Date | string | number;
  isRead?: boolean;
}

export interface OutgoingChatMessage {
  text: string;
  html: string | null;
  inReplyTo: string | null;
}

/** A calendar protocol, implemented by the addon. IDs are those of the server.
 * Every operation gets the account as first argument. Errors reach the user with their message. */
export interface CalendarProtocol {
  /** Before any other operation of this account. Also after the addon restarted. */
  login(account: AccountData, password: string | null): Promise<void>;
  /** The new, changed and removed events since `syncState`, at most 1,000 per call.
   * @param syncState null = list all events; else the `syncState` of the last call */
  listEvents(account: AccountData, syncState: string | null): Promise<EventList>;
  /** Creates or changes the event
   * @param id null = new event
   * @param ical RFC 5545, with one event, and its changed occurrences, if it repeats
   * @returns The ID of the event on the server */
  saveEvent(account: AccountData, id: string | null, ical: string): Promise<string>;
  deleteEvent(account: AccountData, id: string): Promise<void>;
}

export interface EventList extends ChangeList {
  /** New and changed events */
  events: EventData[];
}

export interface EventData {
  id: string;
  /** RFC 5545, with one event, and its changed occurrences, if it repeats. At most 1 MB. */
  ical: string;
}

/** A contacts protocol, implemented by the addon. IDs are those of the server.
 * Every operation gets the account as first argument. Errors reach the user with their message. */
export interface ContactsProtocol {
  /** Before any other operation of this account. Also after the addon restarted. */
  login(account: AccountData, password: string | null): Promise<void>;
  /** The new, changed and removed contacts since `syncState`, at most 1,000 per call.
   * @param syncState null = list all contacts; else the `syncState` of the last call */
  listContacts(account: AccountData, syncState: string | null): Promise<ContactList>;
  /** Creates or changes the contact
   * @param id null = new contact
   * @param vcard RFC 6350
   * @returns The ID of the contact on the server */
  saveContact(account: AccountData, id: string | null, vcard: string): Promise<string>;
  deleteContact(account: AccountData, id: string): Promise<void>;
}

export interface ContactList extends ChangeList {
  /** New and changed contacts */
  contacts: ContactData[];
}

export interface ContactData {
  id: string;
  /** RFC 6350, at most 1 MB */
  vcard: string;
}

/** A file sharing protocol, implemented by the addon.
 * Paths start with "/", and those of directories end with "/".
 * Every operation gets the account as first argument. Errors reach the user with their message. */
export interface FilesProtocol {
  /** Before any other operation of this account. Also after the addon restarted. */
  login(account: AccountData, password: string | null): Promise<void>;
  /** The files and directories in this directory, at most 10,000 */
  listDirectory(account: AccountData, path: string): Promise<FileEntryData[]>;
  /** @returns The contents of the file, at most 1 GB */
  download(account: AccountData, path: string): Promise<Uint8Array>;
  /** Creates or replaces the file */
  upload(account: AccountData, path: string, contents: Uint8Array): Promise<void>;
  /** A file, or a directory with all its contents */
  delete(account: AccountData, path: string): Promise<void>;
  /** Moves or renames a file */
  move(account: AccountData, fromPath: string, toPath: string): Promise<void>;
}

export interface FileEntryData {
  /** Without the path. At most 255 characters, without "/" and "\\". */
  name: string;
  isDirectory?: boolean;
  /** In bytes */
  size?: number;
  /** A Date, an ISO 8601 string, or ms since 1970 */
  lastMod?: Date | string | number;
  /** e.g. "text/plain" */
  mimetype?: string;
}

export interface FolderData {
  id: string;
  name: string;
  /** null or missing = top level */
  parentID?: string | null;
  specialFolder?: SpecialFolder;
  countTotal?: number;
  countUnread?: number;
}

export interface MessageList extends ChangeList {
  /** New and changed messages */
  messages: MessageData[];
}

export interface MessageData extends MessageFlags {
  id: string;
  /** The `Message-ID` header, without <> */
  messageID?: string;
  subject?: string;
  from?: PersonData;
  to?: PersonData[];
  cc?: PersonData[];
  bcc?: PersonData[];
  replyTo?: PersonData;
  /** The `Message-ID` of the message that this one answers */
  inReplyTo?: string;
  /** A Date, an ISO 8601 string, or ms since 1970 */
  sent?: Date | string | number;
  received?: Date | string | number;
  /** Of the complete message, in bytes */
  size?: number;
}

export interface PersonData {
  name?: string;
  emailAddress: string;
}

export interface MessageFlags {
  isRead?: boolean;
  isStarred?: boolean;
  isReplied?: boolean;
  isForwarded?: boolean;
  isDraft?: boolean;
  isSpam?: boolean;
  isImportant?: boolean;
}

export interface AddonStorage {
  get(key: string): Promise<JSONValue | undefined>;
  set(key: string, value: JSONValue): Promise<void>;
  remove(key: string): Promise<void>;
}

export type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };

export interface AddonObject {
  subscribe(run: (value: this) => void): () => void;
  /** Lets the app forget this object. Reading it afterwards fails. */
  release(): void;
}

export interface Subscribable<T> {
  subscribe(run: (value: T) => void): () => void;
}
