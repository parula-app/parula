// app first, to resolve the import cycle around Addons
import "../../../logic/app";
import { AddonManifest } from "../../../logic/Addons/AddonManifest";
import { AddonBuilder } from "../../../../addons/examples/build";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MapColl } from "svelte-collections";
import { describe, expect, test } from "vitest";

const kExamplesDir = fileURLToPath(new URL("../../../../addons/examples/", import.meta.url));

/** The files of the package, as `npm pack` would include them: package.json, icons and the built dist/ */
async function packageFiles(dir: string): Promise<MapColl<string, Uint8Array>> {
  let files = new MapColl<string, Uint8Array>();
  files.set("package.json", await readFile(path.join(dir, "package.json")));
  for (let icon of await readdir(path.join(dir, "icons"))) {
    files.set("icons/" + icon, await readFile(path.join(dir, "icons", icon)));
  }
  for (let [file, contents] of await new AddonBuilder(dir).build(false)) {
    files.set(file, contents);
  }
  return files;
}

describe("Example addons", () => {
  for (let name of ["word-count", "sender-panel"]) {
    test(`${name} builds, and its manifest is valid`, async () => {
      let dir = path.join(kExamplesDir, name);
      let files = await packageFiles(dir);
      let json = JSON.parse(new TextDecoder().decode(files.get("package.json")));
      let manifest = AddonManifest.fromJSON(json, files);
      expect(manifest.permissions.contents).toEqual(["mail"]);
      expect(manifest.ui.hasItems).toBe(true);
      for (let contribution of manifest.ui) {
        let module = new TextDecoder().decode(files.get(contribution.popup ?? contribution.entry));
        expect(module).toMatch(/export\s*\{[^}]*\bas default\b/);
      }
    }, 30000);
  }
});
