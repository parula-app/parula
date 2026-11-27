// @vitest-environment happy-dom
// app first, to resolve the import cycle around Addons
import { appGlobal } from "../../../../logic/app";
import { Addon, AddonState } from "../../../../logic/Addons/Addon";
import { AddonManifest, AddonPackage } from "../../../../logic/Addons/AddonManifest";
import { UserError } from "../../../../logic/util/util";
import { AddonProtocol } from "../../../../logic/Addons/AddonProtocols";
import { newAccountForProtocol } from "../../../../logic/Mail/AccountsList/MailAccounts";
import { newChatAccountForProtocol } from "../../../../logic/Chat/AccountsList/ChatAccounts";
import { newCalendarForProtocol } from "../../../../logic/Calendar/AccountsList/Calendars";
import { newAddressbookForProtocol } from "../../../../logic/Contacts/AccountsList/Addressbooks";
import { newFileSharingAccountForProtocol } from "../../../../logic/Files/AccountsList/FileSharingAccounts";
import AddonsList from "../../../../frontend/Settings/Addons/AddonsList.svelte";
import { fullPackageJSON } from "../../../logic/Addons/testPackage";
import { waitFor } from "../../../logic/util/waitFor";
import { MapColl } from "svelte-collections";
import { flushSync, mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let target: HTMLElement;
let app: any;

beforeEach(() => {
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:test");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(() => {
  unmount(app);
  target.remove();
  appGlobal.addons.installed.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function showPage() {
  app = mount(AddonsList, { target, props: {} });
  flushSync();
}

function manifestJSON(change: (json: any) => void = () => {}): any {
  let json = fullPackageJSON();
  json.mustang.ui = {};
  json.mustang.protocols = [];
  json.mustang.hooks = [];
  json.mustang.apps = [];
  change(json);
  return json;
}

/** An installed addon, without files and without running code */
function addAddon(change?: (json: any) => void, granted?: string[]): Addon {
  let manifest = AddonManifest.fromJSON(manifestJSON(change), null);
  let files = {
    async readFile(): Promise<Uint8Array> {
      throw new Error("No files in this test");
    },
  };
  let addon = new Addon(appGlobal.addons, manifest, files as any);
  addon.grantedPermissions.addAll(granted ?? manifest.requestedPermissions.contents);
  appGlobal.addons.installed.add(addon);
  return addon;
}

function newPackage(change?: (json: any) => void, source = "https://addons.example.com/translate.tgz"): AddonPackage {
  return new AddonPackage(AddonManifest.fromJSON(manifestJSON(change), null), new MapColl<string, Uint8Array>(), source);
}

function rows(): HTMLElement[] {
  return [...target.querySelectorAll<HTMLElement>(".addon")];
}

function permissionLines(): { text: string, risky: boolean }[] {
  return [...target.querySelectorAll<HTMLElement>(".permission")].map(line => ({
    text: line.textContent.trim(),
    risky: line.classList.contains("risky"),
  }));
}

function buttonWithText(text: string): HTMLButtonElement {
  let button = [...target.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent.trim() == text);
  expect(button, `Button ${text}`).toBeTruthy();
  return button;
}

async function click(element: HTMLElement) {
  element.click();
  await tick();
  flushSync();
}

async function openInstallFromURL(url: string) {
  await click(buttonWithText("Install addon"));
  let input = target.querySelector<HTMLInputElement>("input.url");
  input.value = url;
  input.dispatchEvent(new Event("input"));
  flushSync();
  await click(buttonWithText("Download"));
}

describe("List", () => {
  test("Shows the installed addons, and follows adds and removes at runtime", async () => {
    showPage();
    expect(rows().length).toBe(0);
    expect(target.textContent).toContain("No addons installed");

    let translate = addAddon();
    addAddon(json => {
      json.name = "@example/word-count";
      json.version = "2.0.1";
      json.mustang.name = "Word count";
    });
    await tick();
    flushSync();
    expect(rows().length).toBe(2);
    expect(rows()[0].textContent).toContain("Translate");
    expect(rows()[0].textContent).toContain("1.2.0");
    expect(rows()[1].textContent).toContain("Word count");
    expect(rows()[1].textContent).toContain("2.0.1");

    appGlobal.addons.installed.remove(translate);
    await tick();
    flushSync();
    expect(rows().length).toBe(1);
    expect(rows()[0].textContent).toContain("Word count");
    expect(rows()[0].textContent).not.toContain("Translate");
  });

  test("Shows the state, and why the addon could not start", async () => {
    let addon = addAddon();
    addon.state = AddonState.Enabled;
    showPage();
    let stateText = () => rows()[0].querySelector(".state").textContent;
    let runningText = stateText();

    addon.error = new Error("The addon crashed: out of bananas");
    addon.state = AddonState.Error;
    await tick();
    flushSync();
    expect(rows()[0].textContent).toContain("out of bananas");
    expect(stateText()).not.toBe(runningText);

    addon.isEnabled = false;
    addon.error = null;
    addon.state = AddonState.Disabled;
    await tick();
    flushSync();
    expect(rows()[0].textContent).not.toContain("out of bananas");
    expect(stateText()).not.toBe(runningText);
  });

  test("The toggle disables and enables the addon", async () => {
    let addon = addAddon();
    let disable = vi.spyOn(addon, "disable").mockImplementation(async () => {
      addon.isEnabled = false;
      addon.state = AddonState.Disabled;
    });
    let enable = vi.spyOn(addon, "enable").mockImplementation(async () => {
      addon.isEnabled = true;
      addon.state = AddonState.Enabled;
    });
    addon.state = AddonState.Enabled;
    showPage();

    await click(rows()[0].querySelector(".checkbox"));
    await waitFor(() => disable.mock.calls.length == 1);
    expect(enable).not.toHaveBeenCalled();

    await tick();
    flushSync();
    await click(rows()[0].querySelector(".checkbox"));
    await waitFor(() => enable.mock.calls.length == 1);
    expect(disable).toHaveBeenCalledTimes(1);
  });

  test("Details show the granted permissions, risky ones marked", async () => {
    addAddon(json => {
      json.mustang.permissions = ["mail", "mail.all"];
      json.mustang.hosts = ["https://api.example.com"];
    });
    showPage();
    expect(permissionLines().length).toBe(0);

    await click(rows()[0].querySelector(".row"));
    let lines = permissionLines();
    expect(lines.length).toBe(3);
    expect(lines.filter(line => line.risky).length).toBe(1);
    expect(lines.find(line => line.text.includes("https://api.example.com")).risky).toBe(false);
    expect(target.textContent).toContain("Example GmbH");
    expect(target.querySelector<HTMLAnchorElement>("a.homepage").href).toBe("https://example.com/translate");
  });

  test("Remove asks first, then uninstalls", async () => {
    let addon = addAddon();
    let uninstall = vi.spyOn(addon, "uninstall").mockImplementation(async () => {
      appGlobal.addons.installed.remove(addon);
    });
    showPage();
    await click(rows()[0].querySelector(".row"));

    let confirm = vi.fn((_question: string) => false);
    vi.stubGlobal("confirm", confirm);
    await click(buttonWithText("Remove"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain("Translate");
    expect(uninstall).not.toHaveBeenCalled();

    confirm.mockImplementation(() => true);
    await click(buttonWithText("Remove"));
    await waitFor(() => uninstall.mock.calls.length == 1);
    await tick();
    flushSync();
    expect(rows().length).toBe(0);
  });

  test("The remove question counts the accounts of the addon's protocols in all apps", async () => {
    let addon = addAddon(json => {
      json.mustang.protocols = ["mail", "chat", "calendar", "contacts", "files"]
        .map(type => ({ id: type, type, label: type, setup: "dist/setup.js" }));
    });
    let protocol = (type: string) => AddonProtocol.accountProtocol(addon.id, type);
    appGlobal.emailAccounts.add(newAccountForProtocol(protocol("mail")));
    appGlobal.chatAccounts.add(newChatAccountForProtocol(protocol("chat")));
    appGlobal.calendars.add(newCalendarForProtocol(protocol("calendar")));
    appGlobal.addressbooks.add(newAddressbookForProtocol(protocol("contacts")));
    appGlobal.fileSharingAccounts.add(newFileSharingAccountForProtocol(protocol("files")));
    appGlobal.fileSharingAccounts.add(newFileSharingAccountForProtocol(protocol("files")));
    showPage();
    await click(rows()[0].querySelector(".row"));
    let confirm = vi.fn((_question: string) => false);
    vi.stubGlobal("confirm", confirm);

    await click(buttonWithText("Remove"));

    expect(confirm.mock.calls[0][0]).toContain("6 accounts");
    for (let accounts of [appGlobal.emailAccounts, appGlobal.chatAccounts, appGlobal.calendars, appGlobal.addressbooks, appGlobal.fileSharingAccounts]) {
      (accounts as any).clear();
    }
  });
});

describe("Install", () => {
  test("The prompt shows the addon and one line per permission and host, risky ones marked", async () => {
    let pkg = newPackage(json => {
      json.mustang.permissions = ["mail", "mail.compose", "mail.all"];
      json.mustang.hosts = ["https://api.example.com", "https://*.example.org"];
    });
    vi.spyOn(appGlobal.addons, "downloadPackage").mockImplementation(async () => pkg);
    showPage();

    await openInstallFromURL("https://addons.example.com/translate.tgz");
    await waitFor(() => !!target.querySelector(".prompt"));
    expect(appGlobal.addons.downloadPackage).toHaveBeenCalledWith("https://addons.example.com/translate.tgz");
    let prompt = target.querySelector(".prompt").textContent;
    expect(prompt).toContain("Translate");
    expect(prompt).toContain("Example GmbH");
    expect(prompt).toContain("1.2.0");
    expect(prompt).toContain("https://addons.example.com/translate.tgz");

    let lines = permissionLines();
    expect(lines.length).toBe(5);
    expect(lines.filter(line => line.risky).length).toBe(1);
    expect(lines.filter(line => line.text.includes("https://api.example.com")).length).toBe(1);
    expect(lines.filter(line => line.text.includes("https://*.example.org")).length).toBe(1);
  });

  test("With network.any, the prompt has no lines for single hosts", async () => {
    let pkg = newPackage(json => {
      json.mustang.permissions = ["mail", "network.any"];
      json.mustang.hosts = ["https://api.example.com"];
    });
    vi.spyOn(appGlobal.addons, "downloadPackage").mockImplementation(async () => pkg);
    showPage();

    await openInstallFromURL("https://addons.example.com/translate.tgz");
    await waitFor(() => !!target.querySelector(".prompt"));
    let lines = permissionLines();
    expect(lines.length).toBe(2);
    expect(lines.filter(line => line.risky).length).toBe(1);
    expect(lines.some(line => line.text.includes("api.example.com"))).toBe(false);
  });

  test("Install grants exactly what the prompt showed, and selects the new addon", async () => {
    let pkg = newPackage();
    vi.spyOn(appGlobal.addons, "downloadPackage").mockImplementation(async () => pkg);
    let install = vi.spyOn(appGlobal.addons, "install").mockImplementation(async (pkg, granted) => {
      let addon = new Addon(appGlobal.addons, pkg.manifest, {} as any);
      addon.grantedPermissions.addAll(granted);
      appGlobal.addons.installed.add(addon);
      return addon;
    });
    showPage();

    await openInstallFromURL("https://addons.example.com/translate.tgz");
    await waitFor(() => !!target.querySelector(".prompt"));
    let shownLines = permissionLines().length;
    await click(buttonWithText("Install"));
    await waitFor(() => install.mock.calls.length == 1);

    let [installedPackage, granted] = install.mock.calls[0];
    expect(installedPackage).toBe(pkg);
    expect(granted.length).toBe(shownLines);
    expect(pkg.manifest.permissionsAddedTo(granted).isEmpty).toBe(true);
    await waitFor(() => !target.querySelector(".prompt"));
    expect(rows().length).toBe(1);
    expect(rows()[0].classList.contains("selected")).toBe(true);
  });

  test("Cancel installs nothing", async () => {
    vi.spyOn(appGlobal.addons, "downloadPackage").mockImplementation(async () => newPackage());
    let install = vi.spyOn(appGlobal.addons, "install");
    showPage();

    await openInstallFromURL("https://addons.example.com/translate.tgz");
    await waitFor(() => !!target.querySelector(".prompt"));
    await click(buttonWithText("Cancel"));
    expect(target.querySelector(".prompt")).toBeNull();
    expect(install).not.toHaveBeenCalled();
    expect(appGlobal.addons.installed.isEmpty).toBe(true);
  });

  test("A package that fails validation shows the reason, and no prompt", async () => {
    vi.spyOn(appGlobal.addons, "downloadPackage").mockImplementation(async () => {
      throw new UserError("mustang.hosts[0]: Local network names are not allowed");
    });
    showPage();

    await openInstallFromURL("https://addons.example.com/evil.tgz");
    await waitFor(() => target.textContent.includes("Local network names are not allowed"));
    expect(target.querySelector(".prompt")).toBeNull();
    expect(target.querySelectorAll("button").length).toBeGreaterThan(0);
  });

  test("A file is read from the disk", async () => {
    let bytes = new Uint8Array([1, 2, 3]);
    let readPackage = vi.spyOn(appGlobal.addons, "readPackage").mockImplementation(async () => newPackage(undefined, "translate-1.2.0.tgz"));
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
      Object.defineProperty(this, "files", { configurable: true, writable: true, value: [new File([bytes], "translate-1.2.0.tgz")] });
      setTimeout(() => this.dispatchEvent(new Event("change")), 0);
    });
    showPage();

    await click(buttonWithText("Install addon"));
    await click(buttonWithText("Choose file"));
    await waitFor(() => !!target.querySelector(".prompt"));
    expect(readPackage).toHaveBeenCalledTimes(1);
    expect([...readPackage.mock.calls[0][0]]).toEqual([1, 2, 3]);
    expect(readPackage.mock.calls[0][1]).toBe("translate-1.2.0.tgz");
    expect(target.querySelector(".prompt").textContent).toContain("translate-1.2.0.tgz");
  });
});

describe("Update", () => {
  test("The prompt shows only the new permissions and hosts", async () => {
    let installed = addAddon(json => {
      json.version = "1.0.0";
      json.mustang.permissions = ["mail"];
      json.mustang.hosts = ["https://api.example.com"];
    });
    let pkg = newPackage(json => {
      json.version = "1.3.0";
      json.mustang.permissions = ["mail", "mail.all"];
      json.mustang.hosts = ["https://api.example.com", "https://new.example.com"];
    });
    vi.spyOn(appGlobal.addons, "downloadPackage").mockImplementation(async () => pkg);
    let update = vi.spyOn(installed, "update").mockImplementation(async () => {});
    showPage();

    await openInstallFromURL("https://addons.example.com/translate-1.3.0.tgz");
    await waitFor(() => !!target.querySelector(".prompt"));
    let lines = permissionLines();
    expect(lines.length).toBe(2);
    expect(lines.find(line => line.risky)).toBeTruthy();
    expect(lines.find(line => !line.risky).text).toContain("https://new.example.com");
    expect(target.querySelector(".prompt").textContent).toContain("1.0.0");

    await click(buttonWithText("Update"));
    await waitFor(() => update.mock.calls.length == 1);
    let [updatePackage, newlyGranted] = update.mock.calls[0];
    expect(updatePackage).toBe(pkg);
    expect([...newlyGranted.contents].sort()).toEqual(["https://new.example.com", "mail.all"]);
  });

  test("The same or an older version is not offered", async () => {
    addAddon();
    vi.spyOn(appGlobal.addons, "downloadPackage").mockImplementation(async () => newPackage());
    showPage();

    await openInstallFromURL("https://addons.example.com/translate.tgz");
    await waitFor(() => !!target.querySelector(".install-error .error"));
    expect(target.querySelector(".prompt")).toBeNull();
  });
});
