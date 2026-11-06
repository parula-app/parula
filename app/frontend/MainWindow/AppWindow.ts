import { appGlobal } from "../../logic/app";
import { webMail } from "../../logic/build";
import { assert } from "../../logic/util/util";
import { catchErrors } from "../Util/error";
import { ArrayColl } from "svelte-collections";
import { getContext, mount, unmount, type Component } from "svelte";

/**
 * One of the windows of our app: the main window, or a window that we opened from it.
 *
 * All windows run in the JS context of the main window. So, they share `appGlobal`
 * with all accounts, folders and messages, and see each other's changes via the observers.
 * The UI state, e.g. which folder is selected, exists separately in every window.
 * @see `perWindow()`
 */
export class AppWindow {
  readonly window: Window;
  /** As in `window.open()` */
  readonly name: string;
  /**
   * The window where the apps show, e.g. when the user clicks on a person.
   * This window itself, if it shows the whole app with all apps.
   * Otherwise, the main window from which this window was opened.
   */
  readonly mainWindow: AppWindow;
  /** What this window shows. Only for the windows that we opened. */
  component: Component<any>;
  props: Record<string, any>;
  /** `SecondaryBrowserWindow` in the backend. Only for the windows that we opened, and not in the webmail. */
  protected browserWindow: any;
  protected readonly uiStates = new Map<object, object>();

  /** The window that started with the app */
  static readonly main = new AppWindow(window, "main");
  /** All windows that we opened, without the first main window */
  static readonly opened = new ArrayColl<AppWindow>();
  protected static lastUsed = AppWindow.main;
  protected static acting: AppWindow | null = null;
  protected static readonly uiStateCreators = new WeakMap<object, { create: (appWindow: AppWindow) => object, isPerMainWindow: boolean }>();
  protected static lastID = 0;

  protected constructor(win: Window, name: string, mainWindow?: AppWindow) {
    this.window = win;
    this.name = name;
    this.mainWindow = mainWindow ?? this;
  }

  /**
   * The window that acts right now:
   * - The window of the calling component, during its initialization and its reactive updates
   * - The window of the event that is being handled
   * - Otherwise, e.g. after an `await`, the window that the user used last
   */
  static current(): AppWindow {
    return AppWindow.acting ?? AppWindow.ofComponent() ?? AppWindow.ofEvent() ?? AppWindow.lastUsed;
  }

  protected static ofComponent(): AppWindow | undefined {
    try {
      return getContext<AppWindow>("appWindow");
    } catch (ex) {
      return undefined; // not called by a component
    }
  }

  protected static ofEvent(): AppWindow | undefined {
    // The event handlers of all windows run in the JS context of the main window, so it has their current event
    let event = window.event as UIEvent;
    let target = event?.target as any;
    let win = event?.view ?? target?.ownerDocument?.defaultView ?? target?.defaultView ?? target?.window;
    return win ? AppWindow.all.find(appWindow => appWindow.window == win) : undefined;
  }

  /** Whether this window shows the whole app with all apps */
  get isMainWindow(): boolean {
    return this.mainWindow == this;
  }

  /** The first main window and all windows that we opened */
  static get all(): AppWindow[] {
    return [AppWindow.main, ...AppWindow.opened.contents];
  }

  /**
   * UI state that every window has separately, e.g. the selected folder.
   * The result acts on the state of the current window, @see `current()`
   * @param create Makes the state for one window. Called on first use in that window.
   * @returns e.g. a store or a collection
   */
  static perWindow<T extends object>(create: (appWindow: AppWindow) => T): T {
    return AppWindow.createUIState(create, false);
  }

  /** Like `perWindow()`, but a window that we opened for one thing uses the state of its main window */
  static perMainWindow<T extends object>(create: (appWindow: AppWindow) => T): T {
    return AppWindow.createUIState(create, true);
  }

  protected static createUIState<T extends object>(create: (appWindow: AppWindow) => T, isPerMainWindow: boolean): T {
    let state = new Proxy({}, {
      get(_, property) {
        let target = AppWindow.current().uiState(state);
        let value = Reflect.get(target, property);
        return typeof value == "function" ? value.bind(target) : value;
      },
      set(_, property, value) {
        return Reflect.set(AppWindow.current().uiState(state), property, value);
      },
      has(_, property) {
        return Reflect.has(AppWindow.current().uiState(state), property);
      },
      getPrototypeOf() {
        return Reflect.getPrototypeOf(AppWindow.current().uiState(state));
      },
    }) as T;
    AppWindow.uiStateCreators.set(state, { create, isPerMainWindow });
    return state;
  }

  /**
   * @param state from `perWindow()`
   * @returns the state of this window, e.g. the store `selectedFolder` of this window
   */
  uiState<T extends object>(state: T): T {
    let { create, isPerMainWindow } = AppWindow.uiStateCreators.get(state);
    let owner = isPerMainWindow ? this.mainWindow : this;
    if (!owner.uiStates.has(state)) {
      owner.uiStates.set(state, create(owner));
    }
    return owner.uiStates.get(state) as T;
  }

  /**
   * Opens a new window that shows only `component`.
   * The apps keep showing in our main window.
   * If such a window is already open with the same `props`, brings it to the front instead.
   * The new window closes when the first main window closes.
   */
  async open<Props extends Record<string, any>>(component: Component<Props>, props: Props, width: number, height: number): Promise<AppWindow> {
    let existing = AppWindow.opened.find(appWindow => appWindow.component == component &&
      Object.keys(props).every(key => appWindow.props[key] == props[key]));
    if (existing) {
      existing.focus();
      return existing;
    }
    return await AppWindow.openWindow(component, props, width, height, this.mainWindow);
  }

  /**
   * Opens a new window that shows `component` and in which the apps show.
   * The new window closes when the first main window closes.
   */
  static async openMainWindow<Props extends Record<string, any>>(component: Component<Props>, props: Props, width: number, height: number): Promise<AppWindow> {
    return await AppWindow.openWindow(component, props, width, height, null);
  }

  protected static async openWindow<Props extends Record<string, any>>(component: Component<Props>, props: Props, width: number, height: number, mainWindow: AppWindow | null): Promise<AppWindow> {
    let name = "mustang-window-" + ++AppWindow.lastID;
    let features = `width=${width},height=${height}`;
    let browserWindow = null;
    if (!webMail) {
      // The desktop app allows only windows with this token, see `setWindowOpenHandler()` in desktop/src/main/index.ts
      browserWindow = await appGlobal.remoteApp.allowSecondaryWindow();
      features += ",mustang-window=" + browserWindow.token;
    }
    let win = AppWindow.main.window.open("about:blank", name, features);
    assert(win, "Failed to open a new window");
    let appWindow = new AppWindow(win, name, mainWindow);
    appWindow.browserWindow = browserWindow;
    appWindow.show(component, props);
    AppWindow.opened.add(appWindow);
    return appWindow;
  }

  protected show<Props extends Record<string, any>>(component: Component<Props>, props: Props) {
    this.component = component;
    this.props = props;
    let doc = this.window.document;
    // `about:blank` would be in quirks mode
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title></title></head><body><vbox id="app"></vbox></body></html>`);
    doc.close();
    let styleMirror = this.mirrorStyles();
    // `document.open()` above removed all event listeners of the window
    this.listenToLinks();
    this.listenToUse();

    let instance = mount(component, {
      target: doc.getElementById("app"),
      props,
      context: new Map([["appWindow", this]]),
    });

    let closeWithMain = () => this.close();
    AppWindow.main.window.addEventListener("pagehide", closeWithMain);
    this.window.addEventListener("pagehide", () => {
      AppWindow.main.window.removeEventListener("pagehide", closeWithMain);
      AppWindow.opened.remove(this);
      if (AppWindow.lastUsed == this) {
        AppWindow.lastUsed = this.mainWindow;
      }
      styleMirror.disconnect();
      // A reload would load the whole app in this window
      this.close();
      unmount(instance);
    }, { once: true });
  }

  /** Copies the stylesheets of the main window, now and when they change */
  protected mirrorStyles(): MutationObserver {
    let mainHead = AppWindow.main.window.document.head;
    let doc = this.window.document;
    let copies = new Map<Node, HTMLElement>();
    let copyStyle = (node: Node) => {
      let isStylesheet = node.nodeName == "STYLE" ||
        node.nodeName == "LINK" && (node as HTMLLinkElement).rel == "stylesheet";
      if (!isStylesheet) {
        return;
      }
      let copy = doc.importNode(node, true) as HTMLElement;
      if (node.nodeName == "LINK") {
        (copy as HTMLLinkElement).href = (node as HTMLLinkElement).href;
      }
      let next = node.nextSibling;
      while (next && !copies.has(next)) {
        next = next.nextSibling;
      }
      doc.head.insertBefore(copy, copies.get(next) ?? null);
      copies.set(node, copy);
    };
    for (let node of mainHead.childNodes) {
      copyStyle(node);
    }

    let observer = new MutationObserver(mutations => {
      for (let mutation of mutations) {
        if (mutation.target == mainHead) {
          for (let node of mutation.removedNodes) {
            copies.get(node)?.remove();
            copies.delete(node);
          }
          for (let node of mutation.addedNodes) {
            copyStyle(node);
          }
        } else {
          // Vite changes the CSS text of a `<style>` during development
          let styleE = mutation.target.parentNode == mainHead ? mutation.target : mutation.target.parentNode;
          let copy = copies.get(styleE);
          if (copy) {
            copy.textContent = styleE.textContent;
          }
        }
      }
    });
    observer.observe(mainHead, { childList: true, subtree: true, characterData: true });
    return observer;
  }

  protected listenToUse() {
    let onUse = () => AppWindow.lastUsed = this;
    for (let eventName of ["focus", "pointerdown", "keydown"]) {
      this.window.addEventListener(eventName, onUse, { capture: true });
    }
  }

  protected listenToLinks() {
    this.window.addEventListener("click", event => catchErrors(() => this.onClickLink(event)), { capture: true });
  }

  /**
   * Opens links within our app, e.g. `mailto:` in the composer.
   * The handlers listen for `url-mailto` etc. events on the first main window,
   * e.g. `MailInBackground`. For them, `current()` is the window where the user clicked.
   */
  protected onClickLink(event: MouseEvent) {
    let targetE = event.target as HTMLElement;
    let linkE = targetE.closest && targetE.closest("a[href]");
    let url = linkE?.getAttribute("href");
    if (!url) {
      return;
    }
    // _blank should open in external browser
    if (linkE.getAttribute("target") == "_blank") {
      // Let default handler open in external browser
      return;
      /* // ... unless it's a link in an email that we can handle internally
      if (linkE.getAttribute("source") == "convert-html" &&
          appGlobal.meetAccounts.some(acc => acc.isMeetingURL(new URL(url)))) {
        // open internally, continue below
      } else {
        // Let default handler open in external browser
        return;
      }*/
    }
    // open internally
    let urlObj = new URL(url); // throws, if invalid
    let protocol = urlObj.protocol.replace(":", "");
    let urlEvent = new Event("url-" + protocol); // e.g. "url-mailto"
    (urlEvent as any).url = url;
    AppWindow.acting = this;
    try {
      AppWindow.main.window.dispatchEvent(urlEvent);
    } finally {
      AppWindow.acting = null;
    }
    event.stopPropagation();
    event.preventDefault();
  }

  close() {
    this.window.close();
  }

  focus() {
    this.window.focus();
  }

  set title(title: string) {
    this.window.document.title = title;
  }

  async minimize() {
    if (this == AppWindow.main) {
      await appGlobal.remoteApp.minimizeMainWindow();
    } else {
      await this.browserWindow.minimize();
    }
  }

  async maximize() {
    if (this == AppWindow.main) {
      await appGlobal.remoteApp.maximizeMainWindow();
    } else {
      await this.browserWindow.maximize();
    }
  }

  /** From minimized or maximized */
  async restore() {
    if (this == AppWindow.main) {
      await appGlobal.remoteApp.unminimizeMainWindow();
    } else {
      await this.browserWindow.restore();
    }
  }

  /** Must be called once at app start, before the UI shows */
  static init() {
    AppWindow.main.listenToLinks();
    AppWindow.main.listenToUse();
    AppWindow.allowResizeObserverInAllWindows();
    AppWindow.allowDialogsInAllWindows();
  }

  /**
   * `confirm()`, `alert()` and `navigator.clipboard` belong to the main window.
   * This makes them use the current window, so that the dialog shows where the user is,
   * and the clipboard works while another window has the focus.
   */
  protected static allowDialogsInAllWindows() {
    const mainConfirm = window.confirm.bind(window);
    const mainAlert = window.alert.bind(window);
    const mainClipboard = navigator.clipboard;
    window.confirm = (message?: string) => {
      let appWindow = AppWindow.current();
      return appWindow == AppWindow.main ? mainConfirm(message) : appWindow.window.confirm(message);
    };
    window.alert = (message?: string) => {
      let appWindow = AppWindow.current();
      return appWindow == AppWindow.main ? mainAlert(message) : appWindow.window.alert(message);
    };
    Object.defineProperty(navigator, "clipboard", {
      get() {
        let appWindow = AppWindow.current();
        return appWindow == AppWindow.main ? mainClipboard : appWindow.window.navigator.clipboard;
      },
    });
  }

  /**
   * A `ResizeObserver` sees size changes only in its own window. But Svelte's `bind:clientWidth` etc.
   * and our components create it in the main window. This makes `ResizeObserver`
   * create one native observer in the window of each observed element.
   */
  protected static allowResizeObserverInAllWindows() {
    const NativeResizeObserver = window.ResizeObserver;
    class ResizeObserverForAllWindows implements ResizeObserver {
      protected readonly callback: ResizeObserverCallback;
      protected readonly observers = new Map<Window, ResizeObserver>();
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe(target: Element, options?: ResizeObserverOptions) {
        let win = target.ownerDocument.defaultView ?? window;
        let observer = this.observers.get(win);
        if (!observer) {
          for (let [closedWindow, closedObserver] of this.observers) {
            if (closedWindow.closed) {
              closedObserver.disconnect();
              this.observers.delete(closedWindow);
            }
          }
          let WindowResizeObserver = win == window ? NativeResizeObserver : (win as any).ResizeObserver as typeof ResizeObserver;
          observer = new WindowResizeObserver(entries => this.callback(entries, this));
          this.observers.set(win, observer);
        }
        observer.observe(target, options);
      }
      unobserve(target: Element) {
        for (let observer of this.observers.values()) {
          observer.unobserve(target);
        }
      }
      disconnect() {
        for (let observer of this.observers.values()) {
          observer.disconnect();
        }
        this.observers.clear();
      }
    }
    window.ResizeObserver = ResizeObserverForAllWindows;
  }
}
