import { splitAtBaseDomain } from "../../../Mail/Message/EMailAddressParts";
import { expect, test } from "vitest";

test("Splits before the base domain", () => {
  expect(splitAtBaseDomain("fred@example.com")).toEqual({ start: "fred@", baseDomain: "example.com" });
  expect(splitAtBaseDomain("fred@mail.example.com")).toEqual({ start: "fred@mail.", baseDomain: "example.com" });
  expect(splitAtBaseDomain("fred@mail.example.co.uk")).toEqual({ start: "fred@mail.", baseDomain: "example.co.uk" });
  // Phishing: The base domain is the last part
  expect(splitAtBaseDomain("service@paypal.com.secure-login.example.net")).toEqual({ start: "service@paypal.com.secure-login.", baseDomain: "example.net" });
});

test("Keeps the case of the email address", () => {
  expect(splitAtBaseDomain("Fred@Mail.Example.COM")).toEqual({ start: "Fred@Mail.", baseDomain: "Example.COM" });
});

test("Without a known base domain, the whole hostname is the base domain", () => {
  expect(splitAtBaseDomain("fred@localhost")).toEqual({ start: "fred@", baseDomain: "localhost" });
  expect(splitAtBaseDomain("fred@")).toEqual({ start: "fred@", baseDomain: "" });
});

test("Invalid email addresses", () => {
  expect(splitAtBaseDomain("fred")).toEqual({ start: "fred", baseDomain: "" });
  expect(splitAtBaseDomain("")).toEqual({ start: "", baseDomain: "" });
  expect(splitAtBaseDomain(null)).toEqual({ start: "", baseDomain: "" });
  // The last @ separates the hostname
  expect(splitAtBaseDomain(`"a@b"@mail.example.com`)).toEqual({ start: `"a@b"@mail.`, baseDomain: "example.com" });
});
