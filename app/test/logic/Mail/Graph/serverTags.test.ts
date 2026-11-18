// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { GraphAccount } from "../../../../logic/Mail/Graph/GraphAccount";
import { GraphFolder } from "../../../../logic/Mail/Graph/GraphFolder";
import { GraphEMail } from "../../../../logic/Mail/Graph/GraphEMail";
import type { ExchangeMailAccount } from "../../../../logic/Mail/EWS/ExchangeMailAccount";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { availableTags, Tag } from "../../../../logic/Abstract/Tag";
import { beforeEach, expect, test, vi } from "vitest";

const kMasterCategoriesURL = "https://graph.microsoft.com/v1.0/me/outlook/masterCategories";

/** The master categories on the server */
let masterCategories: { id: string, displayName: string, color: string }[];
/** The HTTP calls that the account made */
let calls: { method: string, url: string, options: any }[];

function setupAccount(scope = "Mail.ReadWrite MailboxSettings.ReadWrite offline_access"): GraphAccount {
  calls = [];
  masterCategories = [
    { id: "1", displayName: "Red category", color: "preset0" },
    { id: "2", displayName: "Customer", color: "preset7" },
    { id: "3", displayName: "Uncolored", color: "none" },
  ];
  let ky = {
    get: async (url: string, options: any) => {
      calls.push({ method: "get", url, options });
      if (url == kMasterCategoriesURL) {
        return {
          "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users('user-1')/outlook/masterCategories",
          value: masterCategories,
        };
      }
      throw new Error("Unexpected GET " + url);
    },
    post: async (url: string, options: any) => {
      calls.push({ method: "post", url, options });
      if (url == kMasterCategoriesURL) {
        masterCategories.push({ id: "new", ...options.json });
      }
      return {};
    },
    patch: async (url: string, options: any) => {
      calls.push({ method: "patch", url, options });
      return {};
    },
  };
  appGlobal.remoteApp = { kyCreate: () => ky } as any;
  let account = new GraphAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.url = "https://graph.microsoft.com";
  account.storage = new DummyMailStorage();
  account.oAuth2 = {
    isLoggedIn: true,
    authorizationHeader: "Bearer TEST",
    scope,
  } as any;
  vi.spyOn(account.tags, "add");
  return account;
}

function newEMail(account: GraphAccount): GraphEMail {
  let folder = new GraphFolder(account);
  folder.id = "inbox-1";
  let email = new GraphEMail(folder);
  email.pID = "msg-1";
  return email;
}

function newTag(name: string, color: string): Tag {
  let tag = new Tag();
  tag.name = name;
  tag.color = color;
  availableTags.add(tag);
  return tag;
}

// <copied from="../EWS/serverTags.test.ts">
/** Tagging adds the tag to the server in the background */
async function tagsSavedOnServer(account: ExchangeMailAccount) {
  await Promise.allSettled(vi.mocked(account.tags.add).mock.results.map(result => result.value));
}
// </copied>

beforeEach(() => {
  availableTags.clear();
  localStorage.clear();
});

test("The master categories appear as tags, with their colors", async () => {
  let account = setupAccount();

  await account.tags.load();

  expect(calls.map(call => call.method + " " + call.url)).toEqual(["get " + kMasterCategoriesURL]);
  expect(availableTags.contents.map(tag => [tag.name, tag.color])).toEqual([
    ["Red category", "#D6252E"],
    ["Customer", "#3267B8"],
    ["Uncolored", "#000000"],
  ]);
});

test("Tagging a message with a new tag adds it as master category", async () => {
  let account = setupAccount();
  await account.tags.load();
  let email = newEMail(account);
  calls = [];

  await email.addTag(newTag("Project", "#4AB63F"));
  await tagsSavedOnServer(account);

  expect(calls.map(call => call.method + " " + call.url)).toEqual([
    "patch https://graph.microsoft.com/v1.0/me/messages/msg-1",
    "get " + kMasterCategoriesURL,
    "post " + kMasterCategoriesURL,
  ]);
  expect(calls[2].options.json).toEqual({ displayName: "Project", color: "preset4" });
});

test("Tagging a message with an existing category does not add it again", async () => {
  let account = setupAccount();
  await account.tags.load();
  let email = newEMail(account);
  calls = [];

  await email.addTag(newTag("customer", "#4AB63F"));
  await tagsSavedOnServer(account);

  expect(calls.map(call => call.method)).toEqual(["patch"]);
});

test("A tag without color becomes a category without color", async () => {
  let account = setupAccount();
  await account.tags.load();
  let email = newEMail(account);

  await email.addTag(newTag("Project", "invalid"));
  await tagsSavedOnServer(account);

  expect(masterCategories.at(-1)).toEqual({ id: "new", displayName: "Project", color: "none" });
});

test("An account that was set up without permission for the categories leaves them alone", async () => {
  // Set up before Mustang asked for `MailboxSettings.ReadWrite`
  let account = setupAccount("Mail.ReadWrite offline_access");
  let email = newEMail(account);

  await account.tags.load();
  await email.addTag(newTag("Project", "#4AB63F"));
  await tagsSavedOnServer(account);

  expect(calls.map(call => call.method)).toEqual(["patch"]);
  expect(availableTags.contents.map(tag => tag.name)).toEqual(["Project"]);
});
