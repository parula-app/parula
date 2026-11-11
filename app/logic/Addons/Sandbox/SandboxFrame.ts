import type { AddonBridge, AddonService } from "../Bridge/AddonBridge";
import type { Grant } from "../Bridge/Grant";
import type { AddonGroup } from "../API/addon";
import { Observable, notifyChangedProperty } from "../../util/Observable";

/** The app's fonts, for frames, which can't load them from the app */
export interface AppFonts {
  css: string;
  /** The `url()` in `css` -> the font file as data: URL */
  files: Record<string, string>;
}

/** A sandboxed iframe with addon code: hidden with the addon's logic worker, or visible with a UI module.
 * Its document has an opaque origin, its own policy, and talks to the app only via `port`. */
export class SandboxFrame extends Observable implements AddonService {
  readonly iframe: HTMLIFrameElement;
  protected channel = new MessageChannel();
  bridge: AddonBridge | null = null;
  /** The height of the addon's content, in px */
  @notifyChangedProperty
  contentHeight = 0;
  @notifyChangedProperty
  contentWidth = 0;
  /** The user pressed Escape in the frame */
  onEscape: (() => void) | null = null;
  protected contextGrant: Grant | null = null;

  /** @param title Name of the addon, for screen readers */
  constructor(title: string) {
    super();
    let iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("allow", "");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.title = title;
    this.iframe = iframe;
  }

  /** The app's end. The frame gets the other one. */
  get port(): MessagePort {
    return this.channel.port1;
  }

  /** Loads the sandbox page into `container`, and starts the addon code in it
   * @param code Logic: the addon's script for the worker. UI: the addon's ES module.
   * @param connectSrc The hosts that the addon may connect to, in CSP syntax */
  async start(container: HTMLElement, kind: "logic" | "ui", code: string, connectSrc: string): Promise<void> {
    const kTimeout = 10000;
    let listener: (event: MessageEvent) => void;
    let timeout: ReturnType<typeof setTimeout>;
    let loaded = new Promise<void>((resolve, reject) => {
      listener = event => {
        if (event.source === this.iframe.contentWindow && event.data === "addon-sandbox-ready") {
          resolve();
        }
      };
      window.addEventListener("message", listener);
      timeout = setTimeout(() => reject(new Error("The addon sandbox did not load")), kTimeout);
    });
    this.iframe.src = new URL("addon-sandbox.html", document.baseURI).href;
    container.appendChild(this.iframe);
    try {
      await loaded;
    } finally {
      window.removeEventListener("message", listener);
      clearTimeout(timeout);
    }
    this.iframe.contentWindow.postMessage({ kind, code, connectSrc }, "*", [this.channel.port2]);
  }

  /** Gives the UI new app objects as `mustang.ui.context`. The addon can't use the previous ones anymore.
   * @param groups What the addon may do with them */
  setContext(context: Record<string, object>, groups: AddonGroup[]): void {
    this.contextGrant?.revoke();
    this.contextGrant = this.bridge.newGrant(groups);
    this.bridge.notify("ui", "context", context, this.contextGrant);
  }

  /** @param properties CSS custom properties, e.g. `["--fg", "#160C27"]`
   * @param fonts The app's fonts, once per frame */
  setTheme(properties: [string, string][], colorScheme: string, isDark: boolean, fonts?: AppFonts): void {
    this.bridge.notify("ui", "theme", {}, null, { properties, colorScheme, dark: isDark, fonts });
  }

  /** The "frame" service: what the UI frame tells the app */
  call(_bridge: AddonBridge, method: string, args: unknown[]): void {
    const kMaxSize = 100000;
    if (method == "size") {
      let [width, height] = args;
      if (typeof width == "number" && typeof height == "number" &&
          width >= 0 && height >= 0 && width <= kMaxSize && height <= kMaxSize) {
        this.contentWidth = Math.ceil(width);
        this.contentHeight = Math.ceil(height);
      }
    } else if (method == "escape") {
      this.onEscape?.();
    } else {
      throw new Error("Unknown method");
    }
  }

  remove(): void {
    this.contextGrant?.revoke();
    this.bridge?.close();
    this.iframe.remove();
    this.channel.port1.close();
  }
}
