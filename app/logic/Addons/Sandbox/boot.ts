/* Inline in `addon-sandbox.html`, allowed by its hash. Runs before any addon code, in the sandboxed frame.
 * Gets the addon code and a `MessagePort` from the app, restricts the network, then starts the addon code. */
import { SandboxClient } from "./client";

/** The sandbox runtime for the worker, as source. Set by `SandboxPage`. */
declare const kWorkerClientSource: string;

class SandboxBoot {
  protected port: MessagePort | null = null;
  protected listener = (event: MessageEvent) => this.receive(event);

  start(): void {
    window.addEventListener("message", this.listener);
    window.parent.postMessage("addon-sandbox-ready", "*");
  }

  protected receive(event: MessageEvent): void {
    if (event.source !== window.parent || this.port || !event.ports[0]) {
      return;
    }
    window.removeEventListener("message", this.listener);
    this.port = event.ports[0];
    this.startAddon(event.data)
      .catch(ex => this.port.postMessage([{ op: "failed", e: { name: String(ex?.name), message: String(ex?.message ?? ex) } }]));
  }

  protected async startAddon(init: { kind: "logic" | "ui", code: string, connectSrc: string }): Promise<void> {
    await this.restrictNetwork(init.connectSrc);
    this.removeWebRTC();
    let codeURL = URL.createObjectURL(new Blob([init.code], { type: "text/javascript" }));
    if (init.kind == "logic") {
      let clientURL = URL.createObjectURL(new Blob([kWorkerClientSource], { type: "text/javascript" }));
      let worker = new Worker(clientURL);
      worker.postMessage({ scriptURL: codeURL }, [this.port]);
      return;
    }
    if (document.readyState == "loading") {
      await new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
    }
    await new SandboxClient().startFrame(this.port, codeURL);
  }

  /** Allows connections only to the hosts that the addon declared, and verifies that this works.
   * The static policy of the page already allows only https. */
  protected async restrictNetwork(connectSrc: string): Promise<void> {
    if (typeof connectSrc != "string" || !/^[a-zA-Z0-9.:/*' -]*$/.test(connectSrc)) {
      throw new Error("Invalid network policy");
    }
    let meta = document.createElement("meta");
    meta.httpEquiv = "Content-Security-Policy";
    meta.content = "connect-src " + (connectSrc || "'none'");
    document.head.appendChild(meta);
    await this.checkBlocked("http://csp-check.invalid/");
    if (connectSrc != "https:") {
      await this.checkBlocked("https://csp-check.invalid/");
    }
  }

  /** @throws if the page's policy doesn't block `url` */
  protected async checkBlocked(url: string): Promise<void> {
    const kTimeout = 3000;
    let listener: (event: SecurityPolicyViolationEvent) => void;
    let isBlocked = new Promise<boolean>(resolve => {
      listener = event => {
        if (event.effectiveDirective == "connect-src" && event.blockedURI.startsWith(url.slice(0, -1))) {
          resolve(true);
        }
      };
      document.addEventListener("securitypolicyviolation", listener);
      setTimeout(() => resolve(false), kTimeout);
    });
    try {
      await fetch(url);
    } catch (ex) {
      // Expected
    }
    let blocked = await isBlocked;
    document.removeEventListener("securitypolicyviolation", listener);
    if (!blocked) {
      throw new Error("The network restriction of the addon is not effective");
    }
  }

  /** WebRTC connects to any server, and the network policy doesn't cover it */
  protected removeWebRTC(): void {
    for (let name of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel"]) {
      delete window[name];
    }
  }
}

new SandboxBoot().start();
