// Runs in the addon's worker. Talks to a server with the JSON API of server/JSONMailServer.ts.
import type { AccountData, FolderData, MailProtocol, MessageData, MessageFlags, MessageList, SpecialFolder } from "../../../../app/logic/Addons/API/addon-api";

class JSONMail implements MailProtocol {
  /** Account ID -> the account and its access token */
  protected sessions = new Map<string, { account: AccountData, token: string, state: string }>();

  async login(account: AccountData, password: string | null): Promise<void> {
    let { token } = await this.request(account, "POST", "login", { username: account.username, password });
    let state = this.sessions.get(account.id)?.state ?? "0";
    this.sessions.set(account.id, { account, token, state });
  }

  async listFolders(account: AccountData): Promise<FolderData[]> {
    let folders = await this.request(account, "GET", "folders");
    return folders.map((folder: any) => ({
      id: folder.id,
      name: folder.name,
      parentID: folder.parentID,
      specialFolder: folder.role as SpecialFolder,
      countTotal: folder.total,
      countUnread: folder.unread,
    }));
  }

  async listMessages(account: AccountData, folderID: string, syncState: string | null): Promise<MessageList> {
    let changes = await this.request(account, "GET", `folders/${encodeURIComponent(folderID)}/messages?since=${encodeURIComponent(syncState ?? "0")}&limit=1000`);
    return {
      messages: changes.messages.map((message: any): MessageData => ({
        id: message.id,
        messageID: message.messageID,
        subject: message.subject,
        from: message.from,
        to: message.to,
        sent: message.date,
        received: message.date,
        size: message.size,
        isRead: !!message.flags.seen,
        isStarred: !!message.flags.flagged,
      })),
      removed: changes.removed,
      syncState: changes.state,
      hasMore: changes.hasMore,
    };
  }

  async downloadMessages(account: AccountData, folderID: string, ids: string[]): Promise<{ id: string, mime: Uint8Array }[]> {
    return await Promise.all(ids.map(async id => {
      let response = await this.http(account, "GET", `folders/${encodeURIComponent(folderID)}/messages/${encodeURIComponent(id)}`);
      return { id, mime: new Uint8Array(await response.arrayBuffer()) };
    }));
  }

  async setFlags(account: AccountData, folderID: string, ids: string[], flags: MessageFlags): Promise<void> {
    let serverFlags: Record<string, boolean> = {};
    if (flags.isRead != null) {
      serverFlags.seen = flags.isRead;
    }
    if (flags.isStarred != null) {
      serverFlags.flagged = flags.isStarred;
    }
    await this.request(account, "POST", `folders/${encodeURIComponent(folderID)}/flags`, { ids, flags: serverFlags });
  }

  async moveMessages(account: AccountData, folderID: string, ids: string[], targetFolderID: string): Promise<void> {
    await this.request(account, "POST", `folders/${encodeURIComponent(folderID)}/move`, { ids, targetFolderID });
  }

  async copyMessages(account: AccountData, folderID: string, ids: string[], targetFolderID: string): Promise<void> {
    await this.request(account, "POST", `folders/${encodeURIComponent(folderID)}/copy`, { ids, targetFolderID });
  }

  async deleteMessages(account: AccountData, folderID: string, ids: string[]): Promise<void> {
    await this.request(account, "POST", `folders/${encodeURIComponent(folderID)}/delete`, { ids });
  }

  async createFolder(account: AccountData, parentID: string | null, name: string): Promise<FolderData> {
    let folder = await this.request(account, "POST", "folders", { parentID, name });
    return { id: folder.id, name: folder.name, parentID: folder.parentID };
  }

  async renameFolder(account: AccountData, folderID: string, name: string): Promise<void> {
    await this.request(account, "POST", `folders/${encodeURIComponent(folderID)}/rename`, { name });
  }

  async deleteFolder(account: AccountData, folderID: string): Promise<void> {
    await this.request(account, "DELETE", `folders/${encodeURIComponent(folderID)}`);
  }

  async send(account: AccountData, mime: Uint8Array, from: string, recipients: string[]): Promise<void> {
    let query = new URLSearchParams({ from });
    for (let recipient of recipients) {
      query.append("to", recipient);
    }
    await this.http(account, "POST", "send?" + query, mime.slice());
  }

  /** The server has no push. So we ask it every few minutes, and tell the app about new mail. */
  async checkForNewMail(): Promise<void> {
    for (let session of this.sessions.values()) {
      let { state, folderIDs } = await this.request(session.account, "GET", `changes?since=${encodeURIComponent(session.state)}`);
      session.state = state;
      for (let folderID of folderIDs) {
        mustang.protocols.newMessages(session.account.id, folderID);
      }
    }
  }

  protected async request(account: AccountData, method: string, path: string, body?: any): Promise<any> {
    let response = await this.http(account, method, path, body === undefined ? undefined : JSON.stringify(body));
    return await response.json();
  }

  protected async http(account: AccountData, method: string, path: string, body?: BodyInit): Promise<Response> {
    let headers: Record<string, string> = {};
    let token = this.sessions.get(account.id)?.token;
    if (token) {
      headers.Authorization = "Bearer " + token;
    }
    let response = await fetch(new URL(path, account.serverURL + "/"), { method, headers, body });
    if (!response.ok) {
      let message = `The server answered with error ${response.status}`;
      try {
        message = (await response.json()).error ?? message;
      } catch (ex) {
        // Not JSON
      }
      throw new Error(message);
    }
    return response;
  }
}

let jsonMail = new JSONMail();
mustang.protocols.register("json", jsonMail);
setInterval(() => {
  jsonMail.checkForNewMail()
    .catch(console.error);
}, 5 * 60 * 1000);
