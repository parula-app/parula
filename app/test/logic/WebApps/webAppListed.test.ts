// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { Account } from "../../../logic/Abstract/Account";
import { WebAppListed } from "../../../logic/WebApps/WebAppListed";
import appStore from "../../../logic/WebApps/webAppStore.json";
import { expect, test } from "vitest";

const word = WebAppListed.fromJSON(appStore.apps.find(app => app.id == "microsoft-word"));

test("A Microsoft web app logs in as its account", () => {
  let account = new Account();
  account.username = "fred@example.com";
  let url = new URL(word.instantiate(account).startWithLogin);
  expect(url.searchParams.get("login_hint")).toBe("fred@example.com");
  expect(url.origin + url.pathname).toBe(new URL(word.start).href);
});

test("Without an account, a Microsoft web app starts at its start URL", () => {
  expect(word.instantiate().startWithLogin).toBe(word.start);
});
