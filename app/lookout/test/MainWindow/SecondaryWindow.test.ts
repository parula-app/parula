// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { Notification, NotificationSeverity, notifications } from "../../../logic/util/Notification";
import { AppWindow } from "../../../frontend/MainWindow/AppWindow";
import SecondaryWindow from "../../MainWindow/SecondaryWindow.svelte";
import WindowHeader from "../../MainWindow/WindowHeader.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let app: Record<string, any> | null = null;

afterEach(() => {
  unmount(app);
  app = null;
  document.body.innerHTML = "";
  notifications.clear();
  localStorage.removeItem("lookout.quickaction.shown");
  vi.restoreAllMocks();
});

/** A window that shows one thing, opened from the main window.
 * happy-dom has only one window, so it shares the test's window and document. */
function newSecondaryWindow(): AppWindow {
  return new (AppWindow as any)(window, "test-window", AppWindow.main);
}

function mountIn(appWindow: AppWindow | null, component: any, props: Record<string, any>) {
  let target = document.createElement("div");
  document.body.append(target);
  let context = appWindow ? new Map([["appWindow", appWindow]]) : undefined;
  app = mount(component, { target, props, context });
  flushSync();
}

function titleBar(): HTMLElement {
  return document.querySelector(".title-bar");
}

test("A secondary window has the Lookout frame, with its title", () => {
  let appWindow = newSecondaryWindow();
  mountIn(appWindow, SecondaryWindow, { title: "Lunch on Friday" });
  // Menus and the Lookout styles attach to the Lookout window
  expect(document.querySelector(".lookout-window")).toBeTruthy();
  expect(titleBar().textContent).toContain("Lunch on Friday");
  expect(document.title).toBe("Lunch on Friday");
});

test("A secondary window has no search box and no Quick Access Toolbar", () => {
  localStorage.setItem("lookout.quickaction.shown", "true");
  mountIn(newSecondaryWindow(), SecondaryWindow, { title: "Lunch on Friday" });
  expect(titleBar().querySelector("input")).toBeNull();
  expect(document.querySelector("[role='toolbar']")).toBeNull();
});

test("The main window's title bar keeps the search box and the Quick Access Toolbar", () => {
  localStorage.setItem("lookout.quickaction.shown", "true");
  mountIn(null, WindowHeader, {});
  expect(titleBar().querySelector("input")).toBeTruthy();
  expect(document.querySelector("[role='toolbar']")).toBeTruthy();
  expect(titleBar().textContent).not.toContain("Lunch on Friday");
});

test("The window buttons act on their own window", async () => {
  let appWindow = newSecondaryWindow();
  let minimize = vi.spyOn(appWindow, "minimize").mockResolvedValue();
  let maximize = vi.spyOn(appWindow, "maximize").mockResolvedValue();
  let restore = vi.spyOn(appWindow, "restore").mockResolvedValue();
  let close = vi.spyOn(appWindow, "close").mockReturnValue();
  let mainClose = vi.spyOn(AppWindow.main, "close").mockReturnValue();
  mountIn(appWindow, SecondaryWindow, { title: "Lunch on Friday" });
  let button = (name: string) => titleBar().querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);

  button("Minimize").click();
  await vi.waitFor(() => expect(minimize).toHaveBeenCalledTimes(1));
  button("Maximize").click();
  await vi.waitFor(() => expect(button("Restore window")).toBeTruthy());
  expect(maximize).toHaveBeenCalledTimes(1);
  button("Restore window").click();
  await vi.waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
  button("Close").click();
  await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(mainClose).not.toHaveBeenCalled();
});

test("Notifications show in the secondary window too", () => {
  mountIn(newSecondaryWindow(), SecondaryWindow, { title: "Lunch on Friday" });
  notifications.add(new Notification("The server is not reachable", NotificationSeverity.Warning));
  flushSync();
  expect(document.querySelector(".lookout-window").textContent).toContain("The server is not reachable");
});
