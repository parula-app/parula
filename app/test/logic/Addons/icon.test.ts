// @vitest-environment happy-dom
// app first, to resolve the import cycle around Addons
import "../../../logic/app";
import { Addons } from "../../../logic/Addons/Addons";
import { Addon } from "../../../logic/Addons/Addon";
import { AddonManifest } from "../../../logic/Addons/AddonManifest";
import * as convertHTML from "../../../logic/util/convertHTML";
import { fullPackageJSON, kSVG } from "./testPackage";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../logic/util/convertHTML", async importOriginal => {
  let original = await importOriginal<typeof convertHTML>();
  return { ...original, sanitizeSVG: vi.fn(original.sanitizeSVG) };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const kEvilSVG = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" onload="alert('svg')">
  <script>alert("script")</script>
  <script xlink:href="https://evil.example.com/x.js"/>
  <circle cx="12" cy="12" r="10" onclick="alert('click')" onmouseover="alert('over')"/>
  <animate attributeName="r" values="1;10" onbegin="alert('begin')"/>
  <set attributeName="onmouseover" to="alert('set')"/>
  <foreignObject width="24" height="24"><iframe xmlns="http://www.w3.org/1999/xhtml" src="https://evil.example.com/frame"></iframe></foreignObject>
  <a href="javascript:alert('link')"><rect width="5" height="5"/></a>
  <image href="https://evil.example.com/track.png" width="1" height="1"/>
  <use xlink:href="https://evil.example.com/sprite.svg#icon"/>
</svg>`;

describe("sanitizeSVG", () => {
  test("Removes scripts, event handlers, embedded HTML and external references", () => {
    let svg = convertHTML.sanitizeSVG(kEvilSVG).toLowerCase();
    expect(svg).not.toContain("<script");
    expect(svg).not.toMatch(/\son[a-z]+\s*=/);
    expect(svg).not.toContain("alert");
    expect(svg).not.toContain("foreignobject");
    expect(svg).not.toContain("<iframe");
    expect(svg).not.toContain("javascript:");
    expect(svg).not.toContain("evil.example.com");
  });

  test("Returns nothing for content that is not an SVG image", () => {
    expect(convertHTML.sanitizeSVG("")).toBe("");
    expect(convertHTML.sanitizeSVG("Just text")).toBe("");
    expect(convertHTML.sanitizeSVG(`<script>alert("script")</script>`)).toBe("");
  });
});

describe("Addon.iconURL", () => {
  function newAddon(files: Record<string, string>): Addon {
    let addonFiles = {
      async readFile(version: string, path: string): Promise<Uint8Array> {
        if (!(path in files)) {
          throw new Error(`No file ${path}`);
        }
        return new TextEncoder().encode(files[path]);
      },
    };
    return new Addon(new Addons(), AddonManifest.fromJSON(fullPackageJSON(), null), addonFiles as any);
  }

  function captureBlobs(): Blob[] {
    let blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob: Blob) => {
      blobs.push(blob);
      return "blob:test/" + blobs.length;
    });
    return blobs;
  }

  test("The image is the sanitized SVG, never the file of the addon", async () => {
    let sanitized = `<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>`;
    vi.mocked(convertHTML.sanitizeSVG).mockImplementationOnce(() => sanitized);
    let blobs = captureBlobs();
    let addon = newAddon({ "icons/translate.svg": kEvilSVG });

    let url = await addon.iconURL("icons/translate.svg");

    expect(url).toBe("blob:test/1");
    expect(convertHTML.sanitizeSVG).toHaveBeenCalledWith(kEvilSVG);
    expect(blobs.length).toBe(1);
    expect(blobs[0].type).toBe("image/svg+xml");
    expect(await blobs[0].text()).toBe(sanitized);
  });

  test("A file that is not an SVG image gives no URL", async () => {
    let blobs = captureBlobs();
    let addon = newAddon({ "icons/translate.svg": `<html><body onload="alert(1)">Not an image</body></html>` });

    await expect(addon.iconURL("icons/translate.svg")).rejects.toThrow();
    expect(blobs.length).toBe(0);
  });

  test("A missing file gives no URL", async () => {
    let blobs = captureBlobs();
    let addon = newAddon({ "icons/translate.svg": kSVG });

    await expect(addon.iconURL("icons/missing.svg")).rejects.toThrow();
    expect(blobs.length).toBe(0);
  });
});
