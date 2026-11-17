import { BrowserWindow, type BrowserWindowConstructorOptions, type HandlerDetails, type WindowOpenHandlerResponse } from "electron";
import crypto from "node:crypto";

/**
 * A secondary window of our app, e.g. an email or the composer in its own window,
 * or a second main window. @see `AppWindow` in the frontend
 *
 * Its content runs in the JS context of the main window: The main window writes it into the
 * `Window` that `window.open()` returns. That's why the frontend opens it with `window.open()`,
 * and not the backend: A window of `new BrowserWindow()` would have a JS context of its own.
 *
 * Only our frontend may open such a window, not web content. Flow:
 * 1. Frontend `AppWindow.openWindow()` -> JPC -> `newSecondaryBrowserWindow()` in `backend.ts`
 *    -> `new SecondaryBrowserWindow()` with a new `token` -> `_allowed`
 *    -> JPC returns this object to the frontend, with the `token`
 * 2. Frontend `window.open("about:blank", name, "mustang-window=<token>")`
 *    -> Electron -> `setWindowOpenHandler()` of the main window in `desktop/src/main/index.ts`
 *    -> `SecondaryBrowserWindow.allowWindowOpen()` -> finds this object in `_allowed` by the token
 *    -> Electron calls `createWindow()` -> `new BrowserWindow()` -> `_browserWindow`
 *    -> `window.open()` returns the `Window` -> `AppWindow.show()` writes the content into it
 * 3. Frontend `AppWindow.minimize()` -> JPC -> `minimize()` -> `BrowserWindow.minimize()`
 *
 * Delegator object: The frontend gets only the token and the functions of the object,
 * not the whole `BrowserWindow`. @see `WebContents`
 */
export class SecondaryBrowserWindow {
  /**
   * The frontend passes this to `window.open()`. Only our frontend can get it, via JPC.
   * Valid for one window.
   */
  readonly token = crypto.randomBytes(32).toString("hex");
  /** Created during `window.open()`. Not for the frontend. */
  protected _browserWindow = Promise.withResolvers<BrowserWindow>();

  /**
   * The windows that the frontend may open now
   * Key: `token`
   * Value: The object that the frontend got with this token
   */
  protected static readonly _allowed = new Map<string, SecondaryBrowserWindow>();

  /** The frontend gets this via `newSecondaryBrowserWindow()`, before it calls `window.open()` */
  constructor() {
    SecondaryBrowserWindow._allowed.set(this.token, this);
  }

  async minimize() {
    (await this._browserWindow.promise).minimize();
  }

  async maximize() {
    (await this._browserWindow.promise).maximize();
  }

  /** From minimized or maximized */
  async restore() {
    (await this._browserWindow.promise).restore();
  }

  /**
   * For `setWindowOpenHandler()` of the main window.
   * Static, so that the frontend can't call it: JPC gives it only the functions of the object.
   *
   * The window must never load anything else than `about:blank`, and it may not open other windows.
   *
   * @param details of `window.open()`
   * @param windowFrame of the main window. The new window gets the same.
   * @param openInBrowser For the links in the new window
   * @returns Allows the window and creates its `BrowserWindow`,
   *   if `window.open()` passes the token of a `SecondaryBrowserWindow`.
   *   Each token works only once.
   *   null for all other `window.open()`.
   */
  static allowWindowOpen(details: HandlerDetails, windowFrame: BrowserWindowConstructorOptions, openInBrowser: (details: HandlerDetails) => WindowOpenHandlerResponse): WindowOpenHandlerResponse | null {
    let token = details.features?.split(",").find(feature => feature.startsWith("mustang-window="))?.substring("mustang-window=".length);
    let secondaryWindow = details.url == "about:blank" && token ? SecondaryBrowserWindow._allowed.get(token) : null;
    if (!secondaryWindow) {
      return null;
    }
    SecondaryBrowserWindow._allowed.delete(token);
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        ...windowFrame,
        // Set all of them here, because they are not inherited from the main window,
        // and `window.open()` could set some of them
        webPreferences: {
          nodeIntegration: false,
          nodeIntegrationInSubFrames: false,
          contextIsolation: true,
          sandbox: true,
          webviewTag: true, // for emails, see `WebView.svelte`. Restricted by `restrictWebViews()` in `desktop/src/main/index.ts`.
          backgroundThrottling: false,
        },
      },
      createWindow: (options: BrowserWindowConstructorOptions) => {
        let browserWindow = new BrowserWindow(options);
        let webContents = browserWindow.webContents;
        webContents.setWindowOpenHandler(openInBrowser);
        webContents.on('will-navigate', event => event.preventDefault());
        secondaryWindow._browserWindow.resolve(browserWindow);
        return webContents;
      },
    };
  }
}
