// app first, to resolve the import cycle around Addons
import "../../../logic/app";
import { AddonManifest } from "../../../logic/Addons/AddonManifest";
import { addonHookPoints, addonPermissions } from "../../../logic/Addons/Permissions";
import { apiHooks } from "../../../logic/Addons/API/apiTypes";
import { UserError } from "../../../logic/util/util";
import { fullPackageFiles, fullPackageJSON, kSVG } from "./testPackage";
import { ArrayColl, MapColl } from "svelte-collections";
import { describe, expect, test } from "vitest";

function filesMap(files: Record<string, string | Uint8Array> = fullPackageFiles()): MapColl<string, Uint8Array> {
  let map = new MapColl<string, Uint8Array>();
  for (let [path, contents] of Object.entries(files)) {
    map.set(path, typeof contents == "string" ? new TextEncoder().encode(contents) : contents);
  }
  return map;
}

/** Parses `fullPackageJSON()`, after `change()` modified it */
function parse(change: (json: any) => void = () => {}, files = filesMap()): AddonManifest {
  let json = fullPackageJSON();
  change(json);
  return AddonManifest.fromJSON(json, files);
}

function minimalJSON(mustang: any = {}): any {
  return { name: "minimal", version: "1.0.0", mustang: { name: "Minimal", ...mustang } };
}

test("Reads a manifest with all features", () => {
  let manifest = parse();
  expect(manifest.id).toBe("@example/translate");
  expect(manifest.version).toBe("1.2.0");
  expect(manifest.name).toBe("Translate");
  expect(manifest.description).toBe("Translates the message you read");
  expect(manifest.author).toBe("Example GmbH <dev@example.com>");
  expect(manifest.homepage).toBe("https://example.com/translate");
  expect(manifest.icon).toBe("icons/translate.svg");
  expect(manifest.permissions.contents).toEqual(["mail", "mail.compose"]);
  expect(manifest.hosts.contents).toEqual(["https://api.example.com", "https://*.example.org"]);
  expect(manifest.main).toBe("dist/main.js");
  expect(manifest.ui.length).toBe(4);
  let button = manifest.ui.find(contribution => contribution.place == "message-toolbar");
  expect(button.id).toBe("translate");
  expect(button.label).toBe("Translate");
  expect(button.command).toBe("translate");
  let panel = manifest.ui.find(contribution => contribution.place == "message-panel");
  expect(panel.entry).toBe("dist/panel.js");
  expect(panel.maxHeight).toBe(300);
  expect(manifest.ui.find(contribution => contribution.place == "composer-toolbar").popup).toBe("dist/check-popup.js");
  expect(manifest.protocols.first).toEqual({ id: "acme", type: "mail", label: "ACME Mail", setup: "dist/acme-setup.js" });
  expect(manifest.hooks.contents).toEqual(["mail.send"]);
  expect(manifest.apps.first).toEqual({ id: "notes", name: "Notes", icon: "icons/translate.svg", entry: "dist/notes-app.js" });
});

test("A minimal manifest needs no main, permissions or contributions", () => {
  let manifest = AddonManifest.fromJSON(minimalJSON(), filesMap({}));
  expect(manifest.name).toBe("Minimal");
  expect(manifest.main).toBeNull();
  expect(manifest.permissions.isEmpty).toBe(true);
  expect(manifest.connectSrc).toBe("'none'");
});

test("Paths may start with ./", () => {
  expect(parse(json => json.mustang.main = "./dist/main.js").main).toBe("dist/main.js");
});

test("Survives the round trip through toJSON(), as stored for the next app start", () => {
  let manifest = parse();
  let stored = AddonManifest.fromJSON(JSON.parse(JSON.stringify(manifest.toJSON())), null);
  expect(stored.toJSON()).toEqual(manifest.toJSON());
  expect(stored.ui.contents).toEqual(manifest.ui.contents);
});

test("Labels may have emoji sequences", () => {
  expect(parse(json => json.mustang.name = "Family 👨‍👩‍👧 ❤️").name).toBe("Family 👨‍👩‍👧 ❤️");
});

test("Author as npm object", () => {
  expect(parse(json => json.author = { name: "Jane", email: "jane@example.com" }).author).toBe("Jane");
});

describe("Rejects", () => {
  test.each([
    ["no package.json object", json => Object.keys(json).forEach(key => delete json[key])],
    ["no mustang key", json => delete json.mustang],
    ["no name", json => delete json.name],
    ["uppercase name", json => json.name = "Translate"],
    ["name with ..", json => json.name = "../translate"],
    ["name with 2 slashes", json => json.name = "@example/a/b"],
    ["name starting with .", json => json.name = ".hidden"],
    ["name too long", json => json.name = "a".repeat(215)],
    ["no version", json => delete json.version],
    ["bad version", json => json.version = "1.2"],
    ["version with path", json => json.version = "1.0.0-../x"],
    ["no display name", json => delete json.mustang.name],
    ["empty display name", json => json.mustang.name = "   "],
    ["display name with 41 chars", json => json.mustang.name = "a".repeat(41)],
    ["display name not a string", json => json.mustang.name = { evil: true }],
    ["control character in label", json => json.mustang.name = "Trans\u0000late"],
    ["bidi override in label", json => json.mustang.name = "‮etalsnart"],
    ["bidi isolate in label", json => json.mustang.name = "Trans\u2067late"],
    ["C1 control character in label", json => json.mustang.name = "Trans\u009Blate"],
    ["description too long", json => json.description = "a".repeat(501)],
    ["homepage javascript:", json => json.homepage = "javascript:alert(1)"],
    ["minAppVersion too high", json => json.mustang.minAppVersion = "999.0.0"],
    ["unknown permission", json => json.mustang.permissions = ["mail", "mail.everything"]],
    ["internal group as permission", json => json.mustang.permissions = ["message"]],
    ["permissions not a list", json => json.mustang.permissions = "mail.all"],
    ["21 hosts", json => json.mustang.hosts = Array.from({ length: 21 }, (_, i) => `https://h${i}.example.com`)],
    ["main missing in package", json => json.mustang.main = "dist/nothere.js"],
    ["main with ..", json => json.mustang.main = "dist/../dist/main.js"],
    ["main not JavaScript", json => json.mustang.main = "icons/translate.svg"],
    ["no main, but commands, protocols and hooks", json => delete json.mustang.main],
    ["no main, but a command", json => {
      delete json.mustang.main;
      json.mustang.protocols = [];
      json.mustang.hooks = [];
    }],
    ["icon missing", json => json.mustang.icon = "icons/nothere.svg"],
    ["icon not SVG", json => json.mustang.icon = "dist/main.js"],
    ["unknown UI place", json => json.mustang.ui["title-bar"] = [{ id: "x", label: "X", command: "x" }]],
    ["6 contributions in a place", json => json.mustang.ui["message-menu"] =
      Array.from({ length: 6 }, (_, i) => ({ id: `item${i}`, label: "Item", command: "translate" }))],
    ["same ID twice in a place", json => json.mustang.ui["message-menu"].push({ id: "translate-menu", label: "Again", command: "translate" })],
    ["ID with special characters", json => json.mustang.ui["message-menu"][0].id = "a/b"],
    ["button label with 41 chars", json => json.mustang.ui["message-toolbar"][0].label = "a".repeat(41)],
    ["button without label", json => delete json.mustang.ui["message-toolbar"][0].label],
    ["button with command and popup", json => json.mustang.ui["message-toolbar"][0].popup = "dist/check-popup.js"],
    ["button with neither command nor popup", json => delete json.mustang.ui["message-toolbar"][0].command],
    ["panel without entry", json => delete json.mustang.ui["message-panel"][0].entry],
    ["panel entry missing in package", json => json.mustang.ui["message-panel"][0].entry = "dist/nothere.js"],
    ["panel maxHeight not a number", json => json.mustang.ui["message-panel"][0].maxHeight = "300"],
    ["panel maxHeight too large", json => json.mustang.ui["message-panel"][0].maxHeight = 100000],
    ["popup missing in package", json => json.mustang.ui["composer-toolbar"][0].popup = "dist/nothere.js"],
    ["unknown protocol type", json => json.mustang.protocols[0].type = "fax"],
    ["protocol without setup", json => delete json.mustang.protocols[0].setup],
    ["protocol label with 41 chars", json => json.mustang.protocols[0].label = "a".repeat(41)],
    ["6 protocols", json => json.mustang.protocols = Array.from({ length: 6 }, (_, i) =>
      ({ id: `p${i}`, type: "mail", label: "P", setup: "dist/acme-setup.js" }))],
    ["unknown hook", json => json.mustang.hooks = ["mail.receive"]],
    ["hook without its permission", json => json.mustang.permissions = ["mail"]],
    ["app without entry", json => delete json.mustang.apps[0].entry],
    ["app name with 41 chars", json => json.mustang.apps[0].name = "a".repeat(41)],
    ["6 apps", json => json.mustang.apps = Array.from({ length: 6 }, (_, i) =>
      ({ id: `app${i}`, name: "App", entry: "dist/notes-app.js" }))],
  ])("%s", (_, change: (json: any) => void) => {
    expect(() => parse(change)).toThrow(UserError);
  });

  test("an icon over 50 KB", () => {
    let files = fullPackageFiles();
    files["icons/translate.svg"] = kSVG.replace("<circle", "<!--" + "x".repeat(51 * 1024) + "--><circle");
    expect(() => parse(() => {}, filesMap(files))).toThrow(/too large/);
  });

  test("an icon that is not an SVG image", () => {
    let files = fullPackageFiles();
    files["icons/translate.svg"] = "<html><script>alert(1)</script></html>";
    expect(() => parse(() => {}, filesMap(files))).toThrow(/SVG/);
  });

  test("with a reason that names the field", () => {
    expect(() => parse(json => json.mustang.ui["message-toolbar"][0].label = "a".repeat(41)))
      .toThrow(/mustang\.ui\.message-toolbar\[0\]\.label/);
  });
});

describe("Hosts", () => {
  function hosts(...hosts: string[]): string[] {
    return AddonManifest.fromJSON(minimalJSON({ hosts }), filesMap({})).hosts.contents;
  }

  test("https origins, wildcard subdomains and ports", () => {
    expect(hosts("https://api.example.com", "https://*.example.org", "https://mail.example.net:8443"))
      .toEqual(["https://api.example.com", "https://*.example.org", "https://mail.example.net:8443"]);
  });

  test("Lower case, and without duplicates", () => {
    expect(hosts("https://API.Example.com", "https://api.example.com")).toEqual(["https://api.example.com"]);
  });

  test("Punycode domains", () => {
    expect(hosts("https://xn--bcher-kva.example")).toEqual(["https://xn--bcher-kva.example"]);
  });

  test.each([
    ["http://api.example.com"],
    ["wss://api.example.com"],
    ["api.example.com"],
    ["https://api.example.com/"],
    ["https://api.example.com/path"],
    ["https://user@api.example.com"],
    ["https://api.example.com?x"],
    ["https://api.example.com."],
    ["https://*"],
    ["https://*.com"],
    ["https://a.*.example.com"],
    ["https://intranet"],
    ["https://localhost"],
    ["https://localhost:5455"],
    ["https://evil.localhost"],
    ["https://printer.local"],
    ["https://server.internal"],
    ["https://router.home.arpa"],
    ["https://127.0.0.1"],
    ["https://192.168.1.1"],
    ["https://10.0.0.1:8443"],
    ["https://0x7f.1"],
    ["https://0177.0.0.1"],
    ["https://2130706433"],
    ["https://[::1]"],
    ["https://[fe80::1]"],
    ["https://bücher.example"],
    ["https://-bad.example.com"],
    ["https://api.example.com:0"],
    ["https://api.example.com:99999"],
    ["https://api.example.com https://evil.com"],
    ["https://api.example.com;"],
    ["https://api.example.com 'unsafe-inline'"],
  ])("Rejects %s", (host) => {
    expect(() => hosts(host)).toThrow(UserError);
  });

  test("Rejects a host that is not a string", () => {
    expect(() => AddonManifest.fromJSON(minimalJSON({ hosts: [{ host: "a.example.com" }] }), filesMap({}))).toThrow();
  });
});

describe("CSP connect-src", () => {
  test("Declared hosts", () => {
    let manifest = AddonManifest.fromJSON(minimalJSON({ hosts: ["https://api.example.com", "https://*.example.org"] }), filesMap({}));
    expect(manifest.connectSrc.split(" ").sort()).toEqual(["https://*.example.org", "https://api.example.com"]);
  });

  test("network.any allows all of https, and only https", () => {
    let manifest = AddonManifest.fromJSON(minimalJSON({ permissions: ["network.any"], hosts: ["https://api.example.com"] }), filesMap({}));
    expect(manifest.connectSrc).toBe("https:");
  });

  test("Nothing declared: no network", () => {
    expect(AddonManifest.fromJSON(minimalJSON(), filesMap({})).connectSrc).toBe("'none'");
  });
});

describe("Permissions", () => {
  test("Every manifest permission has a label and API groups or none", () => {
    for (let permission of addonPermissions) {
      expect(permission.label).toBeTruthy();
      expect(permission.apiGroups).toBeDefined();
    }
  });

  test("message is implied by mail and chat", () => {
    expect(addonPermissions.get("mail").apiGroups.contents).toContain("message");
    expect(addonPermissions.get("chat").apiGroups.contents).toContain("message");
    expect(addonPermissions.has("message")).toBe(false);
  });

  test("The hook points for the manifest match the @addonHook() annotations", () => {
    for (let hook of apiHooks) {
      expect(addonHookPoints.get(hook.point)).toBe(hook.group);
    }
  });

  test("The broad permissions are risky", () => {
    let risky = addonPermissions.contents.filter(permission => permission.risky).map(permission => permission.id).sort();
    expect(risky).toEqual(["chat.all", "mail.all", "network.any"]);
  });

  test("Requested permissions: permission IDs and hosts, but no hosts with network.any", () => {
    let manifest = AddonManifest.fromJSON(minimalJSON({ permissions: ["mail"], hosts: ["https://api.example.com"] }), filesMap({}));
    expect(manifest.requestedPermissions.contents.sort()).toEqual(["https://api.example.com", "mail"]);
    manifest = AddonManifest.fromJSON(minimalJSON({ permissions: ["network.any"], hosts: ["https://api.example.com"] }), filesMap({}));
    expect(manifest.requestedPermissions.contents).toEqual(["network.any"]);
  });

  test("Diff for an update", () => {
    let granted = new ArrayColl(["mail", "https://api.example.com"]);
    let manifest = AddonManifest.fromJSON(minimalJSON({
      permissions: ["mail", "mail.all"],
      hosts: ["https://api.example.com", "https://new.example.com"],
    }), filesMap({}));
    expect(manifest.permissionsAddedTo(granted).contents.sort()).toEqual(["https://new.example.com", "mail.all"]);
  });

  test("Diff: fewer permissions need no confirmation", () => {
    let granted = new ArrayColl(["mail", "mail.all", "https://api.example.com"]);
    let manifest = AddonManifest.fromJSON(minimalJSON({ permissions: ["mail"] }), filesMap({}));
    expect(manifest.permissionsAddedTo(granted).isEmpty).toBe(true);
  });

  test("Diff: network.any covers new hosts, but adding network.any needs confirmation", () => {
    let manifest = AddonManifest.fromJSON(minimalJSON({ hosts: ["https://new.example.com"] }), filesMap({}));
    expect(manifest.permissionsAddedTo(new ArrayColl(["network.any"])).isEmpty).toBe(true);
    manifest = AddonManifest.fromJSON(minimalJSON({ permissions: ["network.any"] }), filesMap({}));
    expect(manifest.permissionsAddedTo(new ArrayColl(["https://api.example.com"])).contents).toEqual(["network.any"]);
  });
});

test("Versions", () => {
  function newer(a: string, b: string): boolean {
    return AddonManifest.fromJSON({ ...minimalJSON(), version: a }, filesMap({}))
      .isNewerThan(AddonManifest.fromJSON({ ...minimalJSON(), version: b }, filesMap({})));
  }
  expect(newer("1.10.0", "1.9.0")).toBe(true);
  expect(newer("2.0.0", "1.99.99")).toBe(true);
  expect(newer("1.0.1", "1.0.0")).toBe(true);
  expect(newer("1.0.0", "1.0.0-beta.2")).toBe(true);
  expect(newer("1.0.0-beta.10", "1.0.0-beta.2")).toBe(true);
  expect(newer("1.0.0-beta", "1.0.0-alpha")).toBe(true);
  expect(newer("1.0.0-alpha.1", "1.0.0-alpha")).toBe(true);
  expect(newer("1.0.0", "1.0.0")).toBe(false);
  expect(newer("1.0.0+build2", "1.0.0+build1")).toBe(false);
  expect(newer("1.9.0", "1.10.0")).toBe(false);
  expect(newer("1.0.0-beta.2", "1.0.0")).toBe(false);
});
