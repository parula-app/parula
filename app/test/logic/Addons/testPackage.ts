import { gzipSync } from "node:zlib";

export interface TarEntry {
  path: string;
  contents?: Uint8Array | string;
  /** tar typeflag: "0" file, "5" directory, "1" hard link, "2" symlink, "3"/"4" device, "x" PAX header, "L" GNU long name */
  type?: string;
  linkName?: string;
  prefix?: string;
}

/** Writes a ustar archive, as `npm pack` does */
export function makeTar(entries: TarEntry[]): Uint8Array {
  let blocks: Uint8Array[] = [];
  for (let entry of entries) {
    let data = typeof entry.contents == "string"
      ? new TextEncoder().encode(entry.contents)
      : entry.contents ?? new Uint8Array(0);
    let header = new Uint8Array(512);
    writeString(header, 0, 100, entry.path);
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, data.length);
    writeOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header[156] = (entry.type ?? "0").charCodeAt(0);
    writeString(header, 157, 100, entry.linkName ?? "");
    writeString(header, 257, 6, "ustar\0");
    writeString(header, 263, 2, "00");
    writeString(header, 345, 155, entry.prefix ?? "");
    let sum = header.reduce((total, byte) => total + byte, 0);
    writeString(header, 148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
    blocks.push(header);
    let padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
    padded.set(data);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(1024));
  return concat(blocks);
}

/** A PAX extended header record for a long path */
export function paxPath(path: string): TarEntry {
  let record = ` path=${path}\n`;
  let length = record.length + String(record.length).length;
  length = record.length + String(length).length;
  return { path: "PaxHeader", type: "x", contents: length + record };
}

/** An `npm pack` .tgz with these files in `package/` */
export function makeTGZ(files: Record<string, Uint8Array | string>): Uint8Array {
  return gzip(makeTar(Object.entries(files).map(([path, contents]) => ({ path: "package/" + path, contents }))));
}

export function gzip(data: Uint8Array): Uint8Array {
  return new Uint8Array(gzipSync(data));
}

export const kSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>`;

/** A valid `package.json` with a manifest that uses all features */
export function fullPackageJSON(): any {
  return {
    name: "@example/translate",
    version: "1.2.0",
    description: "Translates the message you read",
    author: "Example GmbH <dev@example.com>",
    license: "MIT",
    homepage: "https://example.com/translate",
    mustang: {
      name: "Translate",
      icon: "icons/translate.svg",
      minAppVersion: "0.1.0",
      permissions: ["mail", "mail.compose"],
      hosts: ["https://api.example.com", "https://*.example.org"],
      main: "dist/main.js",
      ui: {
        "message-toolbar": [
          { id: "translate", label: "Translate", icon: "icons/translate.svg", command: "translate" },
        ],
        "message-menu": [
          { id: "translate-menu", label: "Translate", command: "translate" },
        ],
        "message-panel": [
          { id: "translation", entry: "dist/panel.js", maxHeight: 300 },
        ],
        "composer-toolbar": [
          { id: "check", label: "Check text", icon: "icons/translate.svg", popup: "dist/check-popup.js" },
        ],
      },
      protocols: [
        { id: "acme", type: "mail", label: "ACME Mail", setup: "dist/acme-setup.js" },
      ],
      hooks: ["mail.send"],
      apps: [
        { id: "notes", name: "Notes", icon: "icons/translate.svg", entry: "dist/notes-app.js" },
      ],
    },
  };
}

/** The files that `fullPackageJSON()` refers to */
export function fullPackageFiles(): Record<string, string> {
  return {
    "icons/translate.svg": kSVG,
    "dist/main.js": "mustang.ui.onCommand('translate', () => {});",
    "dist/panel.js": "export default function () { return () => {}; }",
    "dist/check-popup.js": "export default function () { return () => {}; }",
    "dist/acme-setup.js": "export default function () { return () => {}; }",
    "dist/notes-app.js": "export default function () { return () => {}; }",
  };
}

function writeString(header: Uint8Array, offset: number, length: number, value: string) {
  header.set(new TextEncoder().encode(value).subarray(0, length), offset);
}

function writeOctal(header: Uint8Array, offset: number, length: number, value: number) {
  writeString(header, offset, length, value.toString(8).padStart(length - 1, "0") + "\0");
}

function concat(blocks: Uint8Array[]): Uint8Array {
  let result = new Uint8Array(blocks.reduce((total, block) => total + block.length, 0));
  let pos = 0;
  for (let block of blocks) {
    result.set(block, pos);
    pos += block.length;
  }
  return result;
}
