// app first, to resolve the import cycle around Addons
import "../../../logic/app";
import { AddonManifest } from "../../../logic/Addons/AddonManifest";
import { AddonBuilder } from "../../../../addons/examples/build";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MapColl } from "svelte-collections";
import { expect, test } from "vitest";

const kDir = fileURLToPath(new URL("../../../../addons/examples/notes-app/", import.meta.url));

test("notes-app builds, and its manifest is valid, with an app and no permissions", async () => {
  let files = new MapColl<string, Uint8Array>();
  files.set("package.json", await readFile(kDir + "package.json"));
  files.set("icons/notes.svg", await readFile(kDir + "icons/notes.svg"));
  for (let [file, contents] of await new AddonBuilder(kDir).build(false)) {
    files.set(file, contents);
  }
  let json = JSON.parse(new TextDecoder().decode(files.get("package.json")));
  let manifest = AddonManifest.fromJSON(json, files);
  expect(manifest.permissions.isEmpty).toBe(true);
  expect(manifest.hosts.isEmpty).toBe(true);
  expect(manifest.apps.length).toBe(1);
  let module = new TextDecoder().decode(files.get(manifest.apps.first.entry));
  expect(module).toMatch(/export\s*\{[^}]*\bas default\b/);
}, 30000);
