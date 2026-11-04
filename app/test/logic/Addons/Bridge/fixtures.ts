import type { APIClass, APIEnum } from "../../../../logic/Addons/API/addon";
import { AddonAPI } from "../../../../logic/Addons/Bridge/AddonAPI";
import { AddonBridge } from "../../../../logic/Addons/Bridge/AddonBridge";
import { AddonBudget } from "../../../../logic/Addons/Bridge/AddonBudget";
import type { AddonGroup } from "../../../../logic/Addons/API/addon";
import { SandboxClient } from "../../../../logic/Addons/Sandbox/client";
import { Observable, notifyChangedProperty } from "../../../../logic/util/Observable";
import { ArrayColl } from "svelte-collections";

// Test classes, with the same group layout as the real API: messages with "message"/"mail",
// folders and accounts only with "mail.all", writing only with "mail.compose".

export class TPerson extends Observable {
  @notifyChangedProperty
  name = "Fred";
  @notifyChangedProperty
  emailAddress = "fred@example.com";
}

export class TFolder extends Observable {
  @notifyChangedProperty
  name = "Inbox";
  readonly messages = new ArrayColl<TMessage>();
}

export class TAccount extends Observable {
  @notifyChangedProperty
  name = "Account";
  readonly folders = new ArrayColl<TFolder>();
}

export class TMessage extends Observable {
  @notifyChangedProperty
  subject = "Hello";
  @notifyChangedProperty
  html = "<p>Hello</p>";
  @notifyChangedProperty
  from = new TPerson();
  @notifyChangedProperty
  isRead = false;
  @notifyChangedProperty
  sent = new Date(2026, 0, 1);
  readonly to = new ArrayColl<TPerson>();
  readonly tags = new ArrayColl<string>();
  folder: TFolder | null = null;
  /** Not for addons */
  secret = "s3cret";
  get text(): string {
    return "The body";
  }
  async loadBody(): Promise<void> {
  }
  async setFrom(person: TPerson): Promise<void> {
    this.from = person;
  }
  async mark(flag: string): Promise<string> {
    return flag;
  }
  async count(n: number): Promise<number> {
    return n;
  }
  async echo(text: string): Promise<string> {
    return text;
  }
  async save(bytes: Uint8Array): Promise<number> {
    return bytes.length;
  }
  async wait(): Promise<void> {
    await new Promise(() => {});
  }
  async getFolder(): Promise<TFolder | null> {
    return this.folder;
  }
  async getSecret(): Promise<object> {
    return { secret: this.secret };
  }
  async fail(): Promise<void> {
    let ex = new Error("Server said no");
    (ex as any).serverDetails = "internal";
    throw ex;
  }
}

/** Has members, but no groups: never crosses alone */
export class TBase extends Observable {
  @notifyChangedProperty
  baseName = "base";
}
export class TChild extends TBase {
}

export const testClasses: APIClass[] = [
  {
    name: "TPerson", class: TPerson, groups: ["message"], members: [
      { name: "name", kind: "field", read: ["message"], type: ["string"] },
      { name: "emailAddress", kind: "field", read: ["message"], type: ["string"] },
    ],
  },
  {
    name: "TFolder", class: TFolder, groups: ["mail.all"], members: [
      { name: "name", kind: "field", read: ["mail.all"], type: ["string"] },
      { name: "messages", kind: "field", read: ["mail.all"], type: [{ collection: [TMessage] }] },
    ],
  },
  {
    name: "TAccount", class: TAccount, groups: ["mail.all"], members: [
      { name: "name", kind: "field", read: ["mail.all"], type: ["string"] },
      { name: "folders", kind: "field", read: ["mail.all"], type: [{ collection: [TFolder] }] },
    ],
  },
  {
    name: "TMessage", class: TMessage, groups: ["mail"], members: [
      { name: "subject", kind: "field", read: ["message"], write: ["mail.compose"], type: ["string"] },
      { name: "html", kind: "field", read: ["message"], write: ["mail.compose"], type: ["HTML"] },
      { name: "from", kind: "field", read: ["message"], type: [TPerson] },
      { name: "isRead", kind: "field", read: ["message"], type: ["boolean"] },
      { name: "sent", kind: "field", read: ["message"], type: ["Date"] },
      { name: "to", kind: "field", read: ["mail"], type: [{ collection: [TPerson] }] },
      { name: "tags", kind: "field", read: ["mail"], type: [{ collection: ["string"] }] },
      { name: "folder", kind: "field", read: ["mail.all"], type: [TFolder, "null"] },
      { name: "text", kind: "getter", read: ["message"], type: ["string"] },
      { name: "loadBody", kind: "method", read: ["mail"], params: [], returns: ["void"] },
      { name: "setFrom", kind: "method", read: ["mail.compose"], params: [{ name: "person", type: [TPerson] }], returns: ["void"] },
      { name: "mark", kind: "method", read: ["mail"], params: [{ name: "flag", type: [{ enum: "Flag" }] }], returns: ["string"] },
      { name: "count", kind: "method", read: ["mail"], params: [{ name: "n", type: ["number"] }], returns: ["number"] },
      { name: "echo", kind: "method", read: ["mail"], params: [{ name: "text", type: ["string"], optional: true }], returns: ["string"] },
      { name: "save", kind: "method", read: ["mail"], params: [{ name: "bytes", type: ["Uint8Array"] }], returns: ["number"] },
      { name: "wait", kind: "method", read: ["mail"], params: [], returns: ["void"] },
      { name: "getFolder", kind: "method", read: ["mail"], params: [], returns: [TFolder, "null"] },
      { name: "getSecret", kind: "method", read: ["mail"], params: [], returns: ["string"] },
      { name: "fail", kind: "method", read: ["mail"], params: [], returns: ["void"] },
    ],
  },
  {
    name: "TBase", class: TBase, members: [
      { name: "baseName", kind: "field", read: ["message"], type: ["string"] },
    ],
  },
];

export const testEnums: APIEnum[] = [
  { name: "Flag", groups: ["mail"], values: ["flagged", "unflagged"] },
];

export const testAPI = new AddonAPI(testClasses, testEnums);

export function newBridge(groups: AddonGroup[], budget = new AddonBudget()): { bridge: AddonBridge, port: MessagePort } {
  let channel = new MessageChannel();
  let bridge = new AddonBridge(channel.port1, testAPI, groups, budget);
  return { bridge, port: channel.port2 };
}

/** Speaks the raw protocol, like a malicious addon would */
export class RawAddon {
  readonly port: MessagePort;
  readonly received: any[][] = [];
  protected waiters: (() => void)[] = [];
  protected nextID = 1;

  constructor(port: MessagePort) {
    this.port = port;
    port.onmessage = event => {
      this.received.push(event.data);
      for (let waiter of this.waiters.splice(0)) {
        waiter();
      }
    };
  }

  get ops(): any[] {
    return this.received.flat();
  }

  send(...ops: any[]): void {
    this.port.postMessage(ops);
  }

  /** Sends a request and waits for its reply */
  async request(op: any): Promise<any> {
    let id = this.nextID++;
    this.send({ ...op, id });
    return await this.waitFor(reply => reply.op == "reply" && reply.id == id);
  }

  async waitFor(filter: (op: any) => boolean): Promise<any> {
    for (let i = 0; i < 1000; i++) {
      let found = this.ops.find(filter);
      if (found) {
        return found;
      }
      await new Promise<void>(resolve => {
        this.waiters.push(resolve);
        setTimeout(resolve, 20);
      });
    }
    throw new Error("Timeout");
  }

  close(): void {
    this.port.close();
  }
}

/** The real sandbox runtime, connected to a port */
export class TestClient extends SandboxClient {
  start(port: MessagePort): void {
    this.connect(port);
  }

  async whenInitialized(): Promise<void> {
    await this.initialized;
  }

  get remoteCount(): number {
    return this.remotes.size;
  }
}

/** What the sandbox runtime reported. In the sandbox, `reportError()` logs to the console of the addon. */
export const reportedErrors: Error[] = [];
globalThis.reportError ??= (ex: Error) => reportedErrors.push(ex);

export async function tick(ms = 0): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}
