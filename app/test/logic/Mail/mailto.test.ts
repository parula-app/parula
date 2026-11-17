// @vitest-environment happy-dom
import { setUpAccount } from "./TestMailAccount";
import { expect, test } from "vitest";

test("mailto: URL with recipients", () => {
  let mail = setUpAccount().newEMailFrom();
  mail.compose.populateFromMailtoURL("mailto:you@example.com,other@example.com?cc=cc@example.com&subject=Hi");
  expect(mail.to.contents.map(to => to.emailAddress)).toEqual(["you@example.com", "other@example.com"]);
  expect(mail.cc.contents.map(cc => cc.emailAddress)).toEqual(["cc@example.com"]);
  expect(mail.subject).toBe("Hi");
});

test("mailto: URL without recipient, RFC 6068", () => {
  let mail = setUpAccount().newEMailFrom();
  mail.compose.populateFromMailtoURL("mailto:?subject=Hi");
  expect(mail.to.isEmpty).toBe(true);
  expect(mail.cc.isEmpty).toBe(true);
  expect(mail.subject).toBe("Hi");
});

test("mailto: URL with an empty cc", () => {
  let mail = setUpAccount().newEMailFrom();
  mail.compose.populateFromMailtoURL("mailto:you@example.com?cc=");
  expect(mail.cc.isEmpty).toBe(true);
});

test("mailto: URL with a broken address", () => {
  let mail = setUpAccount().newEMailFrom();
  expect(() => mail.compose.populateFromMailtoURL("mailto:not-an-address")).toThrow();
});
