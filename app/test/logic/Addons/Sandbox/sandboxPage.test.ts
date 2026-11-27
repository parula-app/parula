import { SandboxPage } from "../../../../logic/Addons/Sandbox/SandboxPage";
import { createHash } from "node:crypto";
import { beforeAll, expect, test } from "vitest";

let html: string;

beforeAll(async () => {
  html = await new SandboxPage().build();
}, 60000);

function policy(): Map<string, string[]> {
  let content = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/)[1];
  return new Map(content.split(";").map(directive => {
    let [name, ...values] = directive.trim().split(/\s+/);
    return [name, values];
  }));
}

test("The only script is the inline boot script, allowed by its hash", () => {
  let scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  expect(scripts).toHaveLength(1);
  expect(scripts[0][1]).toBe("");
  let hash = createHash("sha256").update(scripts[0][2]).digest("base64");
  expect(policy().get("script-src")).toEqual([`'sha256-${hash}'`, "blob:"]);
  expect(html).not.toContain("kWorkerClientSource");
});

test("The policy allows no network except https, no frames, forms, eval or inline scripts", () => {
  let directives = policy();
  expect(directives.get("default-src")).toEqual(["'none'"]);
  expect(directives.get("connect-src")).toEqual(["https:"]);
  expect(directives.get("frame-src")).toEqual(["'none'"]);
  expect(directives.get("worker-src")).toEqual(["blob:"]);
  expect(directives.get("base-uri")).toEqual(["'none'"]);
  expect(directives.get("form-action")).toEqual(["'none'"]);
  for (let directive of ["img-src", "font-src"]) {
    expect(directives.get(directive).every(source => ["blob:", "data:"].includes(source)), directive).toBe(true);
  }
  for (let values of directives.values()) {
    expect(values).not.toContain("'unsafe-eval'");
    expect(values).not.toContain("*");
    expect(values).not.toContain("http:");
    expect(values).not.toContain("'self'");
  }
  expect(directives.get("script-src")).not.toContain("'unsafe-inline'");
});

test("The page is self-contained", () => {
  expect(html).not.toMatch(/\b(src|href)=/);
  expect(html).toContain("x-dns-prefetch-control");
});
