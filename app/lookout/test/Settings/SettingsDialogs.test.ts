// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import type { MailIdentity } from "../../../logic/Mail/MailIdentity";
import { settingsDialog, openTrustCenter, openSetup } from "../../Settings/SettingsDialogs";
import { selectedIdentity } from "../../Settings/TrustCenter/selected";
import { SetupMustangApp } from "../../../frontend/Setup/SetupMustangApp";
import { selectedApp } from "../../../frontend/AppsBar/selectedApp";
import { AppWindow } from "../../../frontend/MainWindow/AppWindow";
import { afterEach, expect, test } from "vitest";
import { get } from "svelte/store";

// Stands in for a composer window. `acting` is what `AppWindow.current()` returns first.
class ComposerWindow extends AppWindow {
  constructor() {
    super(window, "composer", AppWindow.main);
  }
}

function inWindow(appWindow: AppWindow, action: () => void) {
  AppWindow["acting"] = appWindow;
  try {
    action();
  } finally {
    AppWindow["acting"] = null;
  }
}

afterEach(() => {
  AppWindow.main.uiState(settingsDialog).set(null);
});

test("Trust Center opens over the window where it was asked for, with that window's identity", () => {
  let composerWindow = new ComposerWindow();
  let identity = { emailAddress: "anna@example.com" } as MailIdentity;
  inWindow(composerWindow, () => openTrustCenter(identity));
  expect(get(composerWindow.uiState(settingsDialog))).toEqual({ kind: "options", categoryID: "trust-center" });
  expect(get(composerWindow.uiState(selectedIdentity))).toBe(identity);
  expect(get(AppWindow.main.uiState(settingsDialog))).toBeNull();
});

test("Setup opens in the main window, and Back opens the settings dialog again in the window that started it", () => {
  let composerWindow = new ComposerWindow();
  let returnTo = { kind: "options", categoryID: "mail" } as const;
  inWindow(composerWindow, () => {
    composerWindow.uiState(settingsDialog).set(returnTo);
    openSetup("/setup/mail", returnTo);
  });
  expect(get(composerWindow.uiState(settingsDialog))).toBeNull();
  let setupApp = get(AppWindow.main.uiState(selectedApp));
  expect(setupApp).toBeInstanceOf(SetupMustangApp);
  // The user finishes the setup in the main window
  inWindow(AppWindow.main, () => (setupApp as SetupMustangApp).onBack());
  expect(get(composerWindow.uiState(settingsDialog))).toBe(returnTo);
  expect(get(AppWindow.main.uiState(settingsDialog))).toBeNull();
});
