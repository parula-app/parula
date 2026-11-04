import { expect, test } from "vitest";
import { urlWithScheme } from "../../../logic/util/netUtil";

test("A host name gets https://", () => {
  expect(urlWithScheme("erika.example")).toBe("https://erika.example");
  expect(urlWithScheme("www.erika.example/blog?a=1")).toBe("https://www.erika.example/blog?a=1");
  expect(urlWithScheme("erika.example:8080/")).toBe("https://erika.example:8080/");
});

test("An address with a scheme stays as it is", () => {
  for (let url of ["https://erika.example/", "http://erika.example", "mailto:erika@example.com", "tel:+49301234567", "ftp://files.erika.example/"]) {
    expect(urlWithScheme(url)).toBe(url);
  }
});

test("Nothing stays nothing", () => {
  expect(urlWithScheme("")).toBe("");
  expect(urlWithScheme(null)).toBeNull();
});

test("Something that only looks like a script after trimming is not made a link to one", () => {
  // Browsers ignore leading spaces in `href`, so this must not stay as it is
  expect(urlWithScheme(" javascript:alert(1)")).toMatch(/^https:\/\//);
});
