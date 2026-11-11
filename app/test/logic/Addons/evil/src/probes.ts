// Tries what an addon must not be able to do. Every probe records "ALLOWED: ..." or "blocked: ...".
// The test server also counts the requests that reached it, per path, so that a probe that only
// looks blocked to the addon is caught, too.

export interface EvilConfig {
  /** A declared host, e.g. https://allowed.addon-test.example:1234 */
  allowed: string;
  /** An undeclared host */
  denied: string;
  /** Local servers: localhost, 127.0.0.1, ::1, a single-label name */
  local: string[];
  /** A local WebSocket server like the app's JPC backend */
  jpc: string;
  /** A normal host name that resolves to 127.0.0.1, like with DNS rebinding */
  rebind: string;
  /** Which addon instance this is, e.g. "hosts" or "any" */
  tag: string;
}

export class Probes {
  readonly results: Record<string, string> = {};
  readonly config: EvilConfig;
  readonly where: string;

  constructor(config: EvilConfig, where: string) {
    this.config = config;
    this.where = where;
  }

  /** The server counts requests by this path */
  url(base: string, probe: string): string {
    return `${base}/${this.where}-${this.config.tag}/${probe}`;
  }

  async attempt(name: string, probe: () => unknown): Promise<void> {
    try {
      let result = await Promise.race([
        probe(),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
      ]);
      this.results[name] = "ALLOWED: " + String(result).slice(0, 100);
    } catch (ex) {
      this.results[name] = "blocked: " + String(ex?.name ?? "") + " " + String(ex?.message ?? ex).slice(0, 100);
    }
  }

  async network(prefix = ""): Promise<void> {
    let { allowed, denied, local, jpc, rebind } = this.config;
    await this.attempt(prefix + "fetchAllowed", async () => (await fetch(this.url(allowed, prefix + "fetchAllowed"))).status);
    await this.attempt(prefix + "cookie", async () => await (await fetch(this.url(allowed, prefix + "cookie"), { credentials: "include" })).text());
    await this.attempt(prefix + "fetchDenied", async () => (await fetch(this.url(denied, prefix + "fetchDenied"))).status);
    await this.attempt(prefix + "redirectToDenied", async () => (await fetch(this.url(allowed, prefix + "redirect"))).status);
    await this.attempt(prefix + "xhrDenied", () => this.xhr(this.url(denied, prefix + "xhrDenied")));
    await this.attempt(prefix + "webSocketDenied", () => this.webSocket(this.url(denied.replace("https:", "wss:"), prefix + "webSocketDenied")));
    await this.attempt(prefix + "eventSourceDenied", () => this.eventSource(this.url(denied, prefix + "eventSourceDenied")));
    await this.attempt(prefix + "importDenied", () => import(/* @vite-ignore */ this.url(denied, prefix + "import.js")));
    for (let [i, base] of local.entries()) {
      await this.attempt(prefix + "local" + i, async () => (await fetch(this.url(base, prefix + "local" + i))).status);
    }
    await this.attempt(prefix + "jpcWebSocket", () => this.webSocket(this.url(jpc, prefix + "jpcWebSocket")));
    await this.attempt(prefix + "jpcHTTP", async () => (await fetch(this.url(jpc.replace("ws:", "http:"), prefix + "jpcHTTP"))).status);
    await this.attempt(prefix + "rebind", async () => (await fetch(this.url(rebind, prefix + "rebind"))).status);
  }

  async storage(): Promise<void> {
    await this.attempt("localStorage", () => localStorage.getItem("x"));
    await this.attempt("sessionStorage", () => sessionStorage.getItem("x"));
    await this.attempt("indexedDB", () => new Promise((resolve, reject) => {
      let request = indexedDB.open("evil");
      request.onsuccess = () => resolve("opened");
      request.onerror = () => reject(request.error);
    }));
    await this.attempt("caches", () => caches.keys());
    await this.attempt("broadcastChannel", () => {
      new BroadcastChannel("mustang-app").postMessage("from " + this.where);
      return "posted, but the app must not receive it";
    });
  }

  async bridge(): Promise<void> {
    await this.attempt("mailAccounts", () => mustang.mail.accounts.length);
    await this.attempt("chatAccounts", () => mustang.chat.accounts.length);
  }

  protected xhr(url: string): Promise<number> {
    return new Promise((resolve, reject) => {
      let request = new XMLHttpRequest();
      request.open("GET", url);
      request.onload = () => resolve(request.status);
      request.onerror = () => reject(new Error("xhr error"));
      request.send();
    });
  }

  protected webSocket(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let socket = new WebSocket(url);
      socket.onopen = () => resolve("open");
      socket.onerror = () => reject(new Error("WebSocket error"));
    });
  }

  protected eventSource(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let source = new EventSource(url);
      source.onopen = () => resolve("open");
      source.onerror = () => {
        source.close();
        reject(new Error("EventSource error"));
      };
    });
  }
}
