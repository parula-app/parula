import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Merges the output of oss-attribution-generator for several projects,
 * and adds what the generator leaves out:
 * - The license text of packages which have no file called LICENSE,
 *   but e.g. LICENCE or COPYING, or only the license name in package.json.
 *   For these, the generator writes only "license: MIT".
 * - NOTICE files, which the Apache license requires us to pass on.
 * Then groups the packages by license text.
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
let completed = new Map<string, { text: string, license: string }>();
for (let i = 1; i < inputs.length; i += 2) {
  let licenseInfos = JSON.parse(readFileSync(path.join(path.dirname(inputs[i]), "licenseInfos.json"), "utf8"));
  for (let entry of readFileSync(inputs[i], "utf8").split(separator)) {
    let lines = entry.split("\n");
    let [name, versionURL] = lines;
    let id = name + "@" + versionURL.split(" ")[0];
    if (completed.has(id)) {
      continue;
    }
    let dir = packageDirs.get(id);
    let files = dir ? readdirSync(dir).filter(file => statSync(path.join(dir, file)).isFile()) : [];
    let json = dir ? JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) : {};
    // e.g. "MIT", or in old packages { type: "MIT" } or [{ type: "MIT" }, { type: "Apache-2.0" }],
    // else as guessed by the generator from the license file or README, e.g. "MIT*"
    let license: string = [json.license ?? json.licenses ?? licenseInfos[name]?.license ?? []].flat()
      .map(license => license.type ?? license.replace("*", "")).join(" OR ");
    if (lines.length == 4 && lines[2].startsWith("license: ") && lines[3].startsWith("authors: ")) {
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
    completed.set(id, { text: lines.join("\n"), license });
  }
}
let sorted = [...completed.values()].sort((a, b) =>
  a.text.split("\n")[0].localeCompare(b.text.split("\n")[0], undefined, { sensitivity: "accent", ignorePunctuation: true }));

// List the license text only once for all packages with the same license text, apart from the copyright lines
const creditLine = /^[^\p{L}\p{N}]*(Copyright\s*(\([cC]\)|©|\d|[A-Z])|\([cC]\)\s*\d|©\s*\w|All rights reserved)/u;
// Order in the credits: MIT, BSD, ISC, Apache 2, public domain, others
const categories = [
  /permission is hereby granted free of charge/,
  /redistribution and use in source and binary forms/,
  /permission to use copy modify and (or )?distribute this software for any purpose with or without fee is hereby granted provided/,
  /apache license version 2 0|version 2 0 january 2004/,
  /released into the public domain|cc0 1 0 universal/,
  /^/,
];
let groups = new Map<string, { category: number, text: string, packages: string[] }>();
for (let { text, license } of sorted) {
  let [name, versionURL, ...lines] = text.replaceAll("\r", "").split("\n");
  let licenseText = lines.filter(line => !creditLine.test(line.trim())).join("\n").replace(/\n(\s*\n){2,}/g, "\n\n").trim();
  // Titles which only name the license, e.g. "The MIT License (MIT)", are formatting,
  // because each package shows its license ID
  let textLines = licenseText.split("\n");
  while (textLines.length > 1 && words(textLines[0]).every(word => ["the", "license", "licence", "version"].includes(word) || words(license).includes(word))) {
    textLines.shift();
  }
  licenseText = textLines.join("\n").trim();
  // Compare only letters and digits, so that no text gets lost
  let key = words(licenseText).join(" ");
  let group = groups.get(key) ?? { category: categories.findIndex(category => category.test(key)), text: licenseText, packages: [] };
  group.packages.push([name, versionURL, ...new Set(lines.map(line => line.trim()).filter(line => creditLine.test(line))), license].join("\n"));
  groups.set(key, group);
}
let credits = [...groups.values()]
  .sort((a, b) => a.category - b.category || b.packages.length - a.packages.length)
  .map(group => group.packages.join("\n\n") + "\n\n" + group.text);
writeFileSync(outputFile, credits.join("\n\n--------------------------------------------------\n\n"));

function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word);
}

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
