import { expect, test } from "vitest";
import { addHTTPSToHostname } from "../../../logic/util/netUtil";

test("A host name gets https://", () => {
  expect(addHTTPSToHostname("erika.example")).toBe("https://erika.example");
  expect(addHTTPSToHostname("www.erika.example/blog?a=1")).toBe("https://www.erika.example/blog?a=1");
  expect(addHTTPSToHostname("erika.example:8080/")).toBe("https://erika.example:8080/");
});

test("An address with a scheme stays as it is", () => {
  for (let url of ["https://erika.example/", "http://erika.example", "mailto:erika@example.com", "tel:+49301234567", "ftp://files.erika.example/"]) {
    expect(addHTTPSToHostname(url)).toBe(url);
  }
});

test("Nothing stays nothing", () => {
  expect(addHTTPSToHostname("")).toBe("");
  expect(addHTTPSToHostname(null)).toBeNull();
});

test("Something that is not a host name stays as it is", () => {
  for (let value of ["erika", "erika example", "erika@example.com", "javascript:alert(1)", "javascript://erika.example/%0aalert(1)"]) {
    expect(addHTTPSToHostname(value)).toBe(value);
  }
});
