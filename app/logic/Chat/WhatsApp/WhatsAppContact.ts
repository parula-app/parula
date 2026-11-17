/** A WhatsApp contact: a chat-side person reference for a JID that knows how to
 * fetch its own profile — avatar, "about"/status text, verified business name —
 * from the server and apply it to the address book Person. Mirrors the other
 * protocols' ChatPerson subclasses (e.g. MatrixPerson).
 *
 * Two IQs do the work, both modelled on the WhatsApp Android client:
 *   - `w:profile:picture`: the avatar URL, downloaded like any CDN link (no
 *     decryption). We ask for the small `preview` thumbnail — enough for a
 *     contact list, and cheap.
 *   - `usync`: the contact's `<status>` ("about" text) and, for business
 *     accounts, the verified name (which becomes the display name).
 *
 * The avatar HTTP download and the live usync response shapes can only be
 * validated against the real servers; the parsers are unit-tested. */
import { ChatPersonUID } from "../ChatPersonUID";
import type { Person } from "../../Abstract/Person";
import type { WhatsAppConnection } from "./WhatsAppConnection";
import { JID, kServerUser } from "./Binary/JID";
import { WANode } from "./Binary/WANode";
import { checkMediaURL } from "./WhatsAppMedia";
import { kWaHttpUserAgent } from "./clientInfo";
import { randomBytes } from "../Signal/Crypto/primitives";
import { appGlobal } from "../../app";
import { blobToDataURL } from "../../util/blob";

export class WhatsAppContact extends ChatPersonUID {
  /** The non-device JID this contact is keyed by. */
  readonly jid: JID;
  /** The "about"/status line the contact set, if any. */
  status: string | null = null;
  /** A verified business display name, if this is a business account. */
  verifiedName: string | null = null;

  constructor(jid: JID, name?: string) {
    let bare = jid.toNonDevice();
    super("whatsapp", bare.toString(), name);
    this.jid = bare;
  }

  /** Fetches the
   * * avatar
   * * status
   * * verified name
   * into this.
   * Not throwing in case of server errors. */
  async fetch(connection: WhatsAppConnection): Promise<void> {
    try {
      await this.fetchInfo(connection);
    } catch (ex) {
      console.error("WhatsApp: fetching contact status failed:", ex);
    }
    try {
      await this.fetchPicture(connection);
    } catch (ex) {
      console.error("WhatsApp: fetching profile picture failed:", ex);
    }
  }

  /** Queries usync for this contact's status + verified name and stores them. */
  async fetchInfo(connection: WhatsAppConnection): Promise<void> {
    let response = await connection.sendIQ(this.usyncIQ());
    let user = response.child("usync")?.child("list")?.children("user")
      .find(node => node.attrs.jid && JID.parse(node.attrs.jid).user == this.jid.user);
    if (user) {
      this.readUserNode(user);
    }
  }

  /** Resolves and downloads the avatar (small thumbnail) onto this.picture.
   * @returns the data URL, or null if the contact has none / hides it. */
  async fetchPicture(connection: WhatsAppConnection): Promise<string | null> {
    let response = await connection.sendIQ(this.pictureIQ());
    let url = response.child("picture")?.attrs.url ?? null; // absent on error/hidden
    this.picture = url ? await this.download(url) : null;
    return this.picture;
  }

  /** Applies what we fetched onto an address book person, without clobbering
   * data it already has. @returns whether anything changed. */
  applyTo(person: Person): boolean {
    let changed = false;
    if (this.verifiedName && person.name != this.verifiedName) { // verified name is authoritative
      person.name = this.verifiedName;
      changed = true;
    }
    if (this.status && !person.notes) {
      person.notes = this.status;
      changed = true;
    }
    if (this.picture && !person.picture) {
      person.picture = this.picture;
      changed = true;
    }
    return changed;
  }

  /** The `w:profile:picture` IQ for this contact's avatar (the small thumbnail). */
  pictureIQ(): WANode {
    return new WANode("iq", { to: kServerUser, type: "get", xmlns: "w:profile:picture", target: this.jid.toString() }, [
      new WANode("picture", { type: "preview", query: "url" }),
    ]);
  }

  /** The usync IQ asking for this contact's status + verified/business name. */
  usyncIQ(): WANode {
    return new WANode("iq", { to: kServerUser, type: "get", xmlns: "usync" }, [
      new WANode("usync", { sid: usyncSessionID(), mode: "query", last: "true", index: "0", context: "interactive" }, [
        new WANode("query", {}, [
          new WANode("status"),
          new WANode("business", {}, [new WANode("verified_name")]),
        ]),
        new WANode("list", {}, [new WANode("user", { jid: this.jid.toString() })]),
      ]),
    ]);
  }

  /** Reads status + verified name off one usync `<user>` node onto this. The
   * verified name can appear as a `name` attribute on `<business>` or
   * `<verified_name>`, or as a nested `<verified_name><name>…`. */
  protected readUserNode(user: WANode): void {
    this.status = textOf(user.child("status")) ?? this.status;
    let business = user.child("business");
    let verified = user.child("verified_name") ?? business?.child("verified_name");
    let name = business?.attrs.name || verified?.attrs.name || textOf(verified?.child("name"));
    if (name) {
      this.verifiedName = name;
      this.name = name;
    }
  }

  /** Downloads a profile-picture URL (a plain CDN link; no media decryption).
   * The URL is server-supplied, so validate it against the media host allowlist
   * before the backend fetch, to avoid being used as an SSRF proxy. */
  protected async download(url: string): Promise<string> {
    checkMediaURL(url);
    let ky = await appGlobal.remoteApp.kyCreate({ headers: { "User-Agent": kWaHttpUserAgent } });
    let bytes = new Uint8Array(await ky.get(url, { result: "arrayBuffer" }));
    return await blobToDataURL(new Blob([bytes as BlobPart], { type: "image/jpeg" }));
  }
}

/** The text content of a node (the wire delivers element text as bytes, but a
 * locally built node may hold a string). */
function textOf(node: WANode | undefined): string | undefined {
  if (!node) {
    return undefined;
  }
  if (typeof node.content == "string") {
    return node.content || undefined;
  }
  let bytes = node.contentBytes;
  return bytes ? new TextDecoder().decode(bytes) || undefined : undefined;
}

/** A random session id for a usync query, as the client tags each batch with. */
function usyncSessionID(): string {
  return [...randomBytes(8)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
