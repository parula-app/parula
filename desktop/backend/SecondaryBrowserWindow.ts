import type { BrowserWindow } from "electron";
import crypto from "node:crypto";

/**
 * A secondary window, which the frontend opens with `window.open()` from the main window.
 * Its content runs in the JS context of the main window. @see `AppWindow` in the frontend
 *
 * Delegator object: The frontend gets only these functions, not the whole `BrowserWindow`.
 * @see `WebContents`
 */
export class SecondaryBrowserWindow {
  /**
   * The frontend must pass this to `window.open()` as feature `mustang-window=<token>`.
   * Only our frontend can get it, via JPC, so web content cannot open such a window.
   * Valid for one window.
   */
  readonly token = crypto.randomBytes(32).toString("hex");
  readonly #browserWindow: Promise<BrowserWindow>;

  /** Windows that the frontend may open, by token */
  static readonly #allowed = new Map<string, (browserWindow: BrowserWindow) => void>();

  protected constructor(browserWindow: Promise<BrowserWindow>) {
    this.#browserWindow = browserWindow;
  }

  /** For the frontend, before it opens a secondary window */
  static allow(): SecondaryBrowserWindow {
    let { promise, resolve } = Promise.withResolvers<BrowserWindow>();
    let secondaryWindow = new SecondaryBrowserWindow(promise);
    SecondaryBrowserWindow.#allowed.set(secondaryWindow.token, resolve);
    return secondaryWindow;
  }

  /**
   * For the window open handler. Each token works only once.
   * @returns Call this with the new window. null, if the token is not from `allow()`.
   */
  static use(token: string): ((browserWindow: BrowserWindow) => void) | null {
    let created = SecondaryBrowserWindow.#allowed.get(token) ?? null;
    SecondaryBrowserWindow.#allowed.delete(token);
    return created;
  }

  async minimize() {
    (await this.#browserWindow).minimize();
  }

  async maximize() {
    (await this.#browserWindow).maximize();
  }

  /** From minimized or maximized */
  async restore() {
    (await this.#browserWindow).restore();
  }
}
