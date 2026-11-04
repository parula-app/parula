/** Defense in depth for the sandboxed frames that run addon code (`addon-sandbox.html`).
 * Their opaque origin and the page's own Content-Security-Policy are the first line of defense.
 * Even if those fail, addon frames here can't navigate, can't reach localhost or the local network
 * (also not via host names that resolve to local addresses), get no cookies, and get no permissions.
 *
 * An addon frame is a sub frame with an opaque origin whose URL is `addon-sandbox.html` next to the app,
 * and every frame inside it. An addon controls neither its origin nor its URL path. */
import type { CallbackResponse, Session, WebContents, WebFrameMain } from "electron";
import { BlockList, isIP } from "node:net";

export class AddonFrameGuard {
  protected localAddresses = new BlockList();

  constructor() {
    for (let [network, prefix] of [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
      ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
    ] as [string, number][]) {
      this.localAddresses.addSubnet(network, prefix, "ipv4");
    }
    for (let [network, prefix] of [
      ["::", 96], ["64:ff9b:1::", 48], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
    ] as [string, number][]) {
      this.localAddresses.addSubnet(network, prefix, "ipv6");
    }
  }

  install(session: Session): void {
    session.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
      if (!this.isInAddonFrame(details.frame)) {
        callback({ cancel: false });
        return;
      }
      this.checkRequest(session, details.url, callback);
    });
    session.setPermissionRequestHandler((webContents, _permission, callback, details) => {
      callback(details.isMainFrame || !this.isAddonFrameURL(details.requestingUrl, webContents));
    });
    session.setPermissionCheckHandler((webContents, _permission, requestingOrigin, details) =>
      details.isMainFrame || !(requestingOrigin == "null" || this.isAddonFrameURL(details.requestingUrl, webContents)));
  }

  /** For every new `WebContents` */
  protect(webContents: WebContents): void {
    webContents.on("will-frame-navigate", event => {
      if (this.isInAddonFrame(event.frame) || this.isInAddonFrame(event.initiator)) {
        event.preventDefault();
      }
    });
  }

  /** For the session's only `onBeforeSendHeaders` listener */
  removeRequestCookies(frame: WebFrameMain | null | undefined, headers: Record<string, string>): void {
    if (!this.isInAddonFrame(frame)) {
      return;
    }
    for (let name of Object.keys(headers)) {
      if (name.toLowerCase() == "cookie") {
        delete headers[name];
      }
    }
  }

  /** For the session's only `onHeadersReceived` listener */
  removeResponseCookies(frame: WebFrameMain | null | undefined, headers: Record<string, string[]>): void {
    if (!this.isInAddonFrame(frame)) {
      return;
    }
    for (let name of Object.keys(headers)) {
      if (name.toLowerCase() == "set-cookie") {
        delete headers[name];
      }
    }
  }

  /** The frame is an addon frame or inside one */
  isInAddonFrame(frame: WebFrameMain | null | undefined): boolean {
    const kMaxDepth = 100;
    try {
      for (let level = 0; frame && level < kMaxDepth; level++) {
        if (frame.parent && frame.origin == "null" && this.isSandboxPage(frame.url, frame.top.url)) {
          return true;
        }
        frame = frame.parent;
      }
      return false;
    } catch (ex) {
      // The frame is gone
      return true;
    }
  }

  /** For permission requests, which give only the URL of the frame. Includes frames that an addon frame created. */
  protected isAddonFrameURL(url: string, webContents: WebContents | null): boolean {
    return url.startsWith("about:") || url.startsWith("blob:null/") ||
      this.isSandboxPage(url, webContents?.mainFrame?.url ?? "");
  }

  protected isSandboxPage(url: string, appURL: string): boolean {
    if (!URL.canParse(url) || !URL.canParse(appURL)) {
      return false;
    }
    let page = new URL(url);
    let sandboxPage = new URL("addon-sandbox.html", appURL);
    return page.protocol == sandboxPage.protocol && page.host == sandboxPage.host && page.pathname == sandboxPage.pathname;
  }

  protected async checkRequest(session: Session, url: string, callback: (response: CallbackResponse) => void): Promise<void> {
    let isAllowed = false;
    try {
      isAllowed = await this.isAllowedRequest(session, url);
    } catch (ex) {
      // Blocked
    }
    callback({ cancel: !isAllowed });
  }

  /** `isAllowedURL()`, and the host name doesn't resolve to a local address, e.g. by DNS rebinding.
   * The check fills the network stack's DNS cache, which the request then uses. */
  async isAllowedRequest(session: Session, urlString: string): Promise<boolean> {
    if (!this.isAllowedURL(urlString)) {
      return false;
    }
    let url = new URL(urlString);
    let host = this.hostOf(url);
    if (url.protocol != "https:" || isIP(host)) {
      return true;
    }
    let endpoints: { address: string }[];
    try {
      ({ endpoints } = await session.resolveHost(host));
    } catch (ex) {
      // Without a name server for this host, only a proxy can reach it
      return !/\bDIRECT\b/.test(await session.resolveProxy(urlString));
    }
    return endpoints.length > 0 && !endpoints.some(endpoint => this.isLocalAddress(endpoint.address));
  }

  /** Addon frames may load only from https servers on the internet, and their own `blob:` and `data:` URLs */
  isAllowedURL(urlString: string): boolean {
    if (!URL.canParse(urlString)) {
      return false;
    }
    let url = new URL(urlString);
    if (url.protocol == "blob:" || url.protocol == "data:") {
      return true;
    }
    if (url.protocol != "https:") {
      return false;
    }
    let host = this.hostOf(url);
    if (isIP(host)) {
      return !this.isLocalAddress(host);
    }
    return host.includes(".") && !/(^|\.)(localhost|local|internal|home\.arpa)$/.test(host);
  }

  protected hostOf(url: URL): string {
    return url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[(.*)\]$/, "$1");
  }

  /** Loopback, private, link-local, CGNAT, ULA, multicast etc., also as IPv4 in IPv6. Anything that isn't an IP address, too.
   * `BlockList` checks IPv4-mapped IPv6 addresses against the IPv4 subnets. */
  protected isLocalAddress(address: string): boolean {
    let ipVersion = isIP(address);
    if (!ipVersion) {
      return true;
    }
    if (ipVersion == 4) {
      return this.localAddresses.check(address, "ipv4");
    }
    let nat64 = new URL(`https://[${address}]/`).hostname.match(/^\[64:ff9b::(?:([0-9a-f]{1,4}):)?([0-9a-f]{0,4})\]$/);
    if (nat64) {
      let high = parseInt(nat64[1] ?? "0", 16);
      let low = parseInt(nat64[2] || "0", 16);
      return this.localAddresses.check(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`, "ipv4");
    }
    return this.localAddresses.check(address, "ipv6");
  }
}
