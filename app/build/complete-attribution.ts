import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Merges the output of oss-attribution-generator for several projects,
 * and adds what the generator leaves out:
 * - The license text of packages which have no file called LICENSE,
 *   but e.g. LICENCE or COPYING, or only the license name in package.json.
 *   For these, the generator writes only "license: MIT".
 * - NOTICE files, which the Apache license requires us to pass on.
 *
 * Called by generate-attribution.sh with:
 * spdx-full.json output.txt projectDir attribution.txt [projectDir attribution.txt ...]
 */
let [spdxFile, outputFile, ...inputs] = process.argv.slice(2);
let spdx: Record<string, { licenseText: string }> = JSON.parse(readFileSync(spdxFile, "utf8"));
let packageDirs = new Map<string, string>();
for (let i = 0; i < inputs.length; i += 2) {
  findPackages(path.join(inputs[i], "node_modules"));
}

const separator = "\n\n******************************\n\n";
let completed = new Map<string, string>();
for (let i = 1; i < inputs.length; i += 2) {
  for (let entry of readFileSync(inputs[i], "utf8").split(separator)) {
    let lines = entry.split("\n");
    let [name, versionURL] = lines;
    let id = name + "@" + versionURL.split(" ")[0];
    if (completed.has(id)) {
      continue;
    }
    let dir = packageDirs.get(id);
    let files = dir ? readdirSync(dir).filter(file => statSync(path.join(dir, file)).isFile()) : [];
    if (lines.length == 4 && lines[2].startsWith("license: ") && lines[3].startsWith("authors: ")) {
      let license = lines[2].replace("license: ", "");
      let authors = lines[3].replace("authors: ", "");
      let licenseFile = files.find(file => /^(licen[cs]e|copying)/i.test(file));
      let text = licenseFile
        ? readFileSync(path.join(dir, licenseFile), "utf8").trim()
        : standardLicense(license, "Copyright (c) " + (authors == "undefined" ? "the authors of " + name : authors));
      if (text) {
        lines.splice(2, 2, text);
      } else {
        console.warn(`${id}: No license text for ${license}`);
      }
    }
    let noticeFile = files.find(file => /^notice(\.|$)/i.test(file));
    if (noticeFile) {
      lines.push("", readFileSync(path.join(dir, noticeFile), "utf8").trim());
    }
    completed.set(id, lines.join("\n"));
  }
}
let sorted = [...completed.values()].sort((a, b) =>
  a.split("\n")[0].localeCompare(b.split("\n")[0], undefined, { sensitivity: "accent", ignorePunctuation: true }));
writeFileSync(outputFile, sorted.join(separator));

function findPackages(nodeModules: string) {
  if (!existsSync(nodeModules)) {
    return;
  }
  for (let name of readdirSync(nodeModules)) {
    let dir = path.join(nodeModules, name);
    if (name.startsWith("@")) {
      findPackages(dir);
    } else if (existsSync(path.join(dir, "package.json"))) {
      let json = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
      packageDirs.set(json.name + "@" + json.version, dir);
      findPackages(path.join(dir, "node_modules"));
    }
  }
}

/**
 * @param license e.g. "MIT", "MIT*" if guessed from the README,
 *   "(Apache-2.0 AND BSD-3-Clause)", "(MIT OR GPL-3.0)",
 *   or "MIT,Apache-2.0" if package.json lists several
 * @returns The standard text of the license, with `copyright`
 *   instead of the sample copyright line, or undefined if unknown
 */
function standardLicense(license: string, copyright: string): string | undefined {
  let ids = license.replace(/[()*]/g, "").split(/ OR |,/)
    .map(choice => choice.split(" AND "))
    .find(ids => ids.every(id => spdx[id]));
  return ids?.map(id => {
    let lines = spdx[id].licenseText.trim().split("\n");
    let start = lines.findIndex(line => line.startsWith("Copyright"));
    if (start < 0 || start > 3) {
      return copyright + "\n\n" + lines.join("\n");
    }
    let end = start;
    while (lines[end]?.startsWith("Copyright")) {
      end++;
    }
    lines.splice(start, end - start, copyright);
    return lines.join("\n");
  }).join("\n\n");
}
