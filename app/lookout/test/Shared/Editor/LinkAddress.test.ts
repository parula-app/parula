import { LinkAddress, LinkTarget } from "../../../Shared/Editor/LinkAddress";
import { expect, test } from "vitest";

test("Web addresses stay as they are", () => {
  let link = LinkAddress.parse("https://example.com/page?x=1");
  expect(link.target).toBe(LinkTarget.Web);
  expect(link.address).toBe("https://example.com/page?x=1");
});

test("mailto links give the address and the subject", () => {
  let link = LinkAddress.parse("mailto:fred@example.com?subject=Hello%20there");
  expect(link.target).toBe(LinkTarget.Email);
  expect(link.address).toBe("fred@example.com");
  expect(link.subject).toBe("Hello there");
});

test("E-mail Address builds a mailto link like Outlook", () => {
  expect(LinkAddress.mailto(" fred@example.com ", "Hello there")).toBe("mailto:fred@example.com?subject=Hello%20there");
  expect(LinkAddress.mailto("fred@example.com", "")).toBe("mailto:fred@example.com");
  expect(LinkAddress.mailto("  ", "Hi")).toBe("");
});
