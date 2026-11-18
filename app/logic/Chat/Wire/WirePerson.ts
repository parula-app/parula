import { ChatPersonUID } from "../ChatPersonUID";
import type { TWireConnectionStatus, TWireProtocol, TWireQualifiedID, TWireUser, TWireUserAsset } from "./TWire";
import { notifyChangedProperty } from "../../util/Observable";

/** A Wire user, as a chat contact.
 *
 * Wire is federated, so a user ID means nothing without the backend that issued
 * it: our `chatID` is `<userID>@<domain>`, and every call needs both halves as a
 * `TWireQualifiedID`. */
export class WirePerson extends ChatPersonUID {
  readonly userID: string;
  readonly domain: string;
  /** Their unique username, e.g. `fred`. Not every user has one. */
  @notifyChangedProperty
  handle: string | null = null;
  /** Which message encryption their devices speak. Together with ours, this
   * decides whether our 1:1 with them runs over MLS or over Proteus. */
  supportedProtocols: TWireProtocol[] = ["proteus"];
  /** Our contact request to them, or theirs to us.
   * null = a team member, who needs no contact request. */
  @notifyChangedProperty
  connectionStatus: TWireConnectionStatus | null = null;
  /** The Proteus 1:1 conversation that the contact request created.
   * The MLS 1:1 is a different conversation, and not named here. */
  proteusConversationID: TWireQualifiedID | null = null;
  /** Their messages are recorded by a legal-hold device. Must be shown. */
  @notifyChangedProperty
  legalHold = false;
  /** Their account was deleted on the server */
  @notifyChangedProperty
  deleted = false;
  /** A bot, not a person */
  isService = false;
  /** Where their avatar is. Public, but cargohold still wants our access
   * token, so an `<img src>` cannot load it and the account fetches it. */
  pictureAsset: TWireUserAsset | null = null;
  teamID: string | null = null;

  constructor(userID: string, domain: string, name?: string) {
    super("wire", `${userID}@${domain}`, name);
    this.userID = userID;
    this.domain = domain;
  }

  get qualifiedID(): TWireQualifiedID {
    return { id: this.userID, domain: this.domain };
  }

  /** In our roster, i.e. somebody our user can write to */
  get isContact(): boolean {
    return !this.deleted && (this.connectionStatus == "accepted" || !!this.teamID);
  }

  /** They asked us to connect, and we have not answered yet */
  get isPendingInvite(): boolean {
    return this.connectionStatus == "pending";
  }

  /** Takes a user profile from the server.
   * The profile picture needs the API, so `WireAccount` sets that. */
  fromServer(json: TWireUser): void {
    if (json.name) {
      this.name = json.name;
    }
    this.handle = json.handle;
    this.supportedProtocols = json.supported_protocols?.length ? json.supported_protocols : ["proteus"];
    this.legalHold = json.legalhold_status == "enabled";
    this.deleted = json.deleted;
    this.isService = json.type != "regular" || !!json.service;
    this.teamID = json.team;
    this.pictureAsset = json.assets
      ?.find(asset => asset.type == "image" && asset.size == "preview") ?? null;
  }

  /** `<userID>@<domain>`, our `chatID` for a Wire user */
  static chatID(id: TWireQualifiedID): string {
    return `${id.id}@${id.domain}`;
  }

  /** The inverse of {@link chatID}. The user ID is a UUID and holds no `@`,
   * so the last one separates it from the domain. */
  static parseChatID(chatID: string): TWireQualifiedID {
    let at = chatID.lastIndexOf("@");
    return at < 0
      ? { id: chatID, domain: "" }
      : { id: chatID.slice(0, at), domain: chatID.slice(at + 1) };
  }
}
