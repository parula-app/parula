/* A tiny mail server with a JSON API, for the json-mail example and its test.
 * Keeps everything in memory. Its `fetch()` takes the requests, like a server behind https would. */

export class JSONMailServer {
  /** username -> password */
  readonly users = new Map<string, string>();
  readonly folders = new Map<string, ServerFolder>();
  /** What the addon sent */
  readonly sent: { from: string, recipients: string[], mime: Uint8Array }[] = [];
  /** Counts the requests, e.g. to check that a sync came in chunks */
  readonly requests: string[] = [];
  protected tokens = new Set<string>();
  /** Every change gets the next number */
  protected modseq = 0;
  protected nextID = 1;

  addFolder(id: string, name: string, specialFolder = "normal", parentID: string | null = null): ServerFolder {
    let folder = new ServerFolder(id, name, specialFolder, parentID);
    this.folders.set(id, folder);
    return folder;
  }

  addMessage(folderID: string, message: Partial<ServerMessage> & { subject: string, from: string }): ServerMessage {
    let id = message.id ?? "m" + this.nextID++;
    let date = message.date ?? new Date();
    let mime = message.mime ?? new TextEncoder().encode([
      `From: ${message.from}`,
      `To: ${message.to ?? "me@example.com"}`,
      `Subject: ${message.subject}`,
      `Date: ${date.toUTCString()}`,
      `Message-ID: <${id}@json-mail.example.com>`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      message.text ?? "Hello",
      "",
    ].join("\r\n"));
    let stored: ServerMessage = {
      id,
      subject: message.subject,
      from: message.from,
      to: message.to ?? "me@example.com",
      date,
      text: message.text ?? "Hello",
      mime,
      flags: message.flags ?? {},
      modseq: ++this.modseq,
    };
    let folder = this.folder(folderID);
    folder.messages.set(id, stored);
    folder.removed.delete(id);
    return stored;
  }

  removeMessage(folderID: string, id: string): void {
    let folder = this.folder(folderID);
    folder.messages.delete(id);
    folder.removed.set(id, ++this.modseq);
  }

  setFlags(folderID: string, id: string, flags: Record<string, boolean>): void {
    let message = this.folder(folderID).messages.get(id);
    Object.assign(message.flags, flags);
    message.modseq = ++this.modseq;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let request = new Request(input, init);
    try {
      return await this.handle(request);
    } catch (ex) {
      return Response.json({ error: ex.message }, { status: ex.status ?? 400 });
    }
  }

  protected async handle(request: Request): Promise<Response> {
    let url = new URL(request.url);
    let path = url.pathname.split("/").filter(part => part).map(part => decodeURIComponent(part));
    this.requests.push(request.method + " " + path.join("/"));
    if (request.method == "POST" && path[0] == "login") {
      let { username, password } = await request.json();
      if (!this.users.has(username) || this.users.get(username) != password) {
        throw new HTTPError(401, "Wrong username or password");
      }
      let token = crypto.randomUUID();
      this.tokens.add(token);
      return Response.json({ token });
    }
    if (!this.tokens.has(request.headers.get("Authorization")?.replace("Bearer ", ""))) {
      throw new HTTPError(401, "Please log in");
    }
    if (path[0] == "changes") {
      let since = Number(url.searchParams.get("since") ?? 0);
      let folderIDs = [...this.folders.values()]
        .filter(folder => [...folder.messages.values(), ...folder.removed.values()].some(change => (typeof change == "number" ? change : change.modseq) > since))
        .map(folder => folder.id);
      return Response.json({ state: String(this.modseq), folderIDs });
    }
    if (path[0] == "send") {
      let mime = new Uint8Array(await request.arrayBuffer());
      this.sent.push({ from: url.searchParams.get("from"), recipients: url.searchParams.getAll("to"), mime });
      return Response.json({});
    }
    if (path[0] != "folders") {
      throw new HTTPError(404, "Not found");
    }
    if (path.length == 1) {
      if (request.method == "POST") {
        let { parentID, name } = await request.json();
        let folder = this.addFolder("f" + this.nextID++, name, "normal", parentID);
        return Response.json(folder.toJSON());
      }
      return Response.json([...this.folders.values()].map(folder => folder.toJSON()));
    }
    let folder = this.folder(path[1]);
    if (path.length == 2 && request.method == "DELETE") {
      this.folders.delete(folder.id);
      return Response.json({});
    }
    switch (path[2]) {
    case "messages":
      if (path[3]) {
        let message = folder.messages.get(path[3]);
        if (!message) {
          throw new HTTPError(404, "No such message");
        }
        return new Response(message.mime.slice(), { headers: { "Content-Type": "message/rfc822" } });
      }
      return Response.json(folder.changes(Number(url.searchParams.get("since") ?? 0), Number(url.searchParams.get("limit") ?? 1000), this.modseq));
    case "flags": {
      let { ids, flags } = await request.json();
      for (let id of ids) {
        this.setFlags(folder.id, id, flags);
      }
      return Response.json({});
    }
    case "move":
    case "copy": {
      let { ids, targetFolderID } = await request.json();
      let target = this.folder(targetFolderID);
      for (let id of ids) {
        let message = folder.messages.get(id);
        let copyID = path[2] == "move" ? id : "m" + this.nextID++;
        target.messages.set(copyID, { ...message, id: copyID, flags: { ...message.flags }, modseq: ++this.modseq });
        target.removed.delete(copyID);
        if (path[2] == "move") {
          this.removeMessage(folder.id, id);
        }
      }
      return Response.json({});
    }
    case "delete": {
      let { ids } = await request.json();
      for (let id of ids) {
        this.removeMessage(folder.id, id);
      }
      return Response.json({});
    }
    case "rename": {
      let { name } = await request.json();
      folder.name = name;
      return Response.json({});
    }
    }
    throw new HTTPError(404, "Not found");
  }

  protected folder(id: string): ServerFolder {
    let folder = this.folders.get(id);
    if (!folder) {
      throw new HTTPError(404, "No such folder");
    }
    return folder;
  }
}

export class ServerFolder {
  id: string;
  name: string;
  specialFolder: string;
  parentID: string | null;
  readonly messages = new Map<string, ServerMessage>();
  /** ID -> modseq of the removal */
  readonly removed = new Map<string, number>();

  constructor(id: string, name: string, specialFolder: string, parentID: string | null) {
    this.id = id;
    this.name = name;
    this.specialFolder = specialFolder;
    this.parentID = parentID;
  }

  /** The messages that changed after `since`, the oldest change first */
  changes(since: number, limit: number, currentModseq: number) {
    let changed = [...this.messages.values()]
      .filter(message => message.modseq > since)
      .sort((a, b) => a.modseq - b.modseq);
    let page = changed.slice(0, limit);
    let hasMore = changed.length > limit;
    let state = hasMore ? page[page.length - 1].modseq : currentModseq;
    let removed = [...this.removed.entries()]
      .filter(([_id, modseq]) => modseq > since && modseq <= state)
      .map(([id]) => id);
    return {
      messages: page.map(message => ({
        id: message.id,
        messageID: message.id + "@json-mail.example.com",
        subject: message.subject,
        from: { emailAddress: message.from },
        to: [{ emailAddress: message.to }],
        date: message.date.toISOString(),
        size: message.mime.length,
        flags: message.flags,
      })),
      removed,
      state: String(state),
      hasMore,
    };
  }

  toJSON() {
    let unread = [...this.messages.values()].filter(message => !message.flags.seen).length;
    return { id: this.id, name: this.name, role: this.specialFolder, parentID: this.parentID, total: this.messages.size, unread };
  }
}

export interface ServerMessage {
  id: string;
  subject: string;
  from: string;
  to: string;
  date: Date;
  text: string;
  mime: Uint8Array;
  /** e.g. `seen`, `flagged` */
  flags: Record<string, boolean>;
  modseq: number;
}

class HTTPError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
