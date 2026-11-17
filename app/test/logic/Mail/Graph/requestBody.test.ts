// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { GraphAccount } from "../../../../logic/Mail/Graph/GraphAccount";
import { GraphFolder } from "../../../../logic/Mail/Graph/GraphFolder";
import { GraphEMail } from "../../../../logic/Mail/Graph/GraphEMail";
import { expect, test } from "vitest";

/** The HTTP calls that the account made */
let calls: { method: string, url: string, options: any }[] = [];

test("Marking a message as read sends the flag to the server", async () => {
  let account = setupAccount();
  let folder = new GraphFolder(account);
  folder.id = "inbox-1";
  let email = new GraphEMail(folder);
  email.pID = "msg-1";

  await email.markRead(true);

  expect(email.isRead).toBe(true);
  expect(calls.length).toBe(1);
  expect(calls[0].method).toBe("patch");
  expect(calls[0].url).toBe("https://graph.microsoft.com/v1.0/me/messages/msg-1");
  expect(calls[0].options.json).toEqual({ isRead: true });
});

test("Sending a message passes the MIME to the server", async () => {
  let account = setupAccount();

  await account.graphCall("sendMail", {
    method: "post",
    body: "TUlNRQ==",
    headers: {
      "Content-Type": "text/plain",
    },
  });

  expect(calls[0].options.body).toBe("TUlNRQ==");
});

function setupAccount(): GraphAccount {
  calls = [];
  let ky = {};
  for (let method of ["get", "post", "patch", "delete"]) {
    ky[method] = (url: string, options: any) => {
      calls.push({ method, url, options });
      return {};
    };
  }
  appGlobal.remoteApp = { kyCreate: () => ky };
  let account = new GraphAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.url = "https://graph.microsoft.com";
  account.oAuth2 = {
    isLoggedIn: true,
    authorizationHeader: "Bearer TEST",
  } as any;
  return account;
}
