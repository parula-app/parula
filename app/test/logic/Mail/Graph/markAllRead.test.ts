// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { GraphAccount } from "../../../../logic/Mail/Graph/GraphAccount";
import { GraphFolder } from "../../../../logic/Mail/Graph/GraphFolder";
import { GraphEMail } from "../../../../logic/Mail/Graph/GraphEMail";
import { waitTime } from "../../../../logic/util/util";
import { expect, test, vi } from "vitest";

/** A fake Graph server with a folder whose messages are unread or not.
 * @param ignorePatch The server accepts the change, but the message stays unread */
function setUpFolder(unreadIDs: string[], ignorePatch = false) {
  let unread = new Set(unreadIDs);
  let patches: string[] = [];
  let ky = {
    get: (url: string) => {
      expect(decodeURIComponent(url)).toContain("$filter=isRead eq false");
      let top = Number(new URL(url).searchParams.get("$top"));
      return { value: [...unread].slice(0, top).map(id => ({ id })) };
    },
    patch: (url: string, options: any) => {
      let id = url.split("/messages/")[1];
      patches.push(id);
      if (options.json.isRead && !ignorePatch) {
        unread.delete(id);
      }
      return { id, isRead: options.json.isRead };
    },
  };
  appGlobal.remoteApp = { kyCreate: () => ky } as any;
  let account = new GraphAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.url = "https://graph.microsoft.com";
  account.userID = "me-1";
  account.oAuth2 = { isLoggedIn: true, authorizationHeader: "Bearer TEST" } as any;
  let errors: Error[] = [];
  account.errorCallback = ex => errors.push(ex);
  let folder = new GraphFolder(account);
  folder.name = "Inbox";
  folder.id = "inbox-1";
  folder.countUnread = unreadIDs.length;
  for (let id of unreadIDs) {
    let email = new GraphEMail(folder);
    email.pID = id;
    email.isRead = false;
    folder.messages.add(email);
  }
  return { folder, unread, patches, errors };
}

test("Mark all as read marks every unread email as read on the server", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); // more than 1000 requests wait for the next minute
  let oldWaitFactor = waitTime.factor;
  waitTime.factor = 1;
  try {
    let ids = Array.from({ length: 1500 }, (_dummy, i) => "msg-" + i);
    let { folder, unread, errors } = setUpFolder(ids);

    let marking = folder.markAllRead();
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
    await marking;

    expect(unread.size).toBe(0);
    expect(errors).toEqual([]);
    expect(folder.countUnread).toBe(0);
    expect(folder.messages.contents.every(email => email.isRead)).toBe(true);
  } finally {
    waitTime.factor = oldWaitFactor;
    vi.useRealTimers();
  }
});

test("Mark all as read in a folder without unread emails changes nothing on the server", async () => {
  let { folder, patches, errors } = setUpFolder([]);

  await folder.markAllRead();

  expect(patches).toEqual([]);
  expect(errors).toEqual([]);
});

test("Mark all as read stops when the server keeps returning the same unread emails", async () => {
  let { folder, patches, errors } = setUpFolder(["msg-1", "msg-2"], true);

  await folder.markAllRead();

  expect(patches.length).toBeLessThanOrEqual(4);
  expect(errors.length).toBe(1);
});
