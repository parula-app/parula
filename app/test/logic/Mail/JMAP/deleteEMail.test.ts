import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { JMAPFolder } from "../../../../logic/Mail/JMAP/JMAPFolder";
import type { JMAPEMail } from "../../../../logic/Mail/JMAP/JMAPEMail";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { DeleteStrategy } from "../../../../logic/Mail/MailAccount";
import type { TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => { throw new Error("The test should not talk to a real server") } } as any;

/** A server with one email, answering like Stalwart. Goes through the real `makeCalls()`.
 * @param mailboxIDsOnServer what the server has for the email, or null if the email is gone */
function newAccount(mailboxIDsOnServer: Record<string, boolean> | null) {
  let account = new JMAPAccount();
  account.accountID = "e";
  account.session = { apiUrl: "http://jmap.example.com/jmap/", state: "s1", capabilities: {}, accounts: {}, primaryAccounts: {} } as any as TJMAPSession;
  let server = { mailboxIds: mailboxIDsOnServer ? { ...mailboxIDsOnServer } : null, state: "spi" };
  let requests: Record<string, any>[] = [];
  account.httpPost = async (url: string, request: any) => {
    requests.push(request);
    let methodResponses = request.methodCalls.map(([method, args, callID]: [string, Record<string, any>, string]) =>
      [...serverResponse(server, method, args), callID]);
    return { methodResponses, sessionState: "s1" };
  };
  let inbox = newFolder(account, "a", SpecialFolder.Inbox);
  let trash = newFolder(account, "d", SpecialFolder.Trash);
  return { account, server, requests, inbox, trash };
}

function serverResponse(server: { mailboxIds: Record<string, boolean> | null, state: string }, method: string, args: Record<string, any>): [string, Record<string, any>] {
  if (method == "Email/get") {
    return [method, {
      accountId: "e", state: server.state,
      list: server.mailboxIds ? [{ mailboxIds: server.mailboxIds, id: "eaaaaab" }] : [],
      notFound: server.mailboxIds ? [] : ["eaaaaab"],
    }];
  }
  if (args.ifInState && args.ifInState != server.state) {
    return ["error", { type: "stateMismatch" }];
  }
  let oldState = server.state;
  if (!server.mailboxIds) {
    let notFound = { eaaaaab: { type: "notFound" } };
    return [method, { accountId: "e", oldState, newState: oldState, ...(args.destroy ? { notDestroyed: notFound } : { notUpdated: notFound }) }];
  }
  if (args.destroy) {
    server.mailboxIds = null;
    server.state = "spm";
    return [method, { accountId: "e", oldState, newState: server.state, destroyed: ["eaaaaab"] }];
  }
  let mailboxIds = { ...server.mailboxIds };
  for (let [path, value] of Object.entries(args.update.eaaaaab as Record<string, any>)) {
    if (path == "mailboxIds") {
      mailboxIds = { ...value };
    } else if (path.startsWith("mailboxIds/") && value) {
      mailboxIds[path.substring(11)] = true;
    } else if (path.startsWith("mailboxIds/")) {
      delete mailboxIds[path.substring(11)];
    }
  }
  if (!Object.keys(mailboxIds).length) {
    return [method, { accountId: "e", oldState, newState: oldState, notUpdated: { eaaaaab: { type: "invalidProperties", description: "Message has to belong to at least one mailbox.", properties: ["mailboxIds"] } } }];
  }
  server.mailboxIds = mailboxIds;
  server.state = "spm";
  return [method, { accountId: "e", oldState, newState: server.state, updated: { eaaaaab: null } }];
}

function newFolder(account: JMAPAccount, id: string, specialFolder: SpecialFolder): JMAPFolder {
  let folder = account.newFolder();
  folder.id = id;
  folder.specialFolder = specialFolder;
  account.rootFolders.add(folder);
  return folder;
}

/** @param mailboxIDs as we got them with our last sync, or null if we don't know them */
function newEMail(folder: JMAPFolder, mailboxIDs: string[] | null = null): JMAPEMail {
  let email = folder.newEMail();
  email.jmapID = "eaaaaab";
  email.mailboxIDs = mailboxIDs;
  return email;
}

test("Deleting an email from Trash keeps it in its other folder", async () => {
  let { server, trash } = newAccount({ a: true, d: true });

  await newEMail(trash).deleteMessageOnServer();

  expect(server.mailboxIds).toEqual({ a: true });
});

test("Deleting an email from Trash destroys it when it is in no other folder", async () => {
  let { server, trash } = newAccount({ d: true });

  await newEMail(trash).deleteMessageOnServer();

  expect(server.mailboxIds).toBeNull();
});

test("Deleting immediately keeps the email in its other folder", async () => {
  let { server, inbox } = newAccount({ a: true, x: true });

  await newEMail(inbox).deleteMessageOnServer(DeleteStrategy.DeleteImmediately);

  expect(server.mailboxIds).toEqual({ x: true });
});

test("Deleting an email that is already gone on the server succeeds", async () => {
  let { server, trash } = newAccount(null);

  await newEMail(trash).deleteMessageOnServer();

  expect(server.mailboxIds).toBeNull();
});

test("With the folders from our last sync, deleting from Trash destroys the email with a single request", async () => {
  let { account, server, requests, trash } = newAccount({ d: true });
  account.syncState.set("Email", server.state);

  await newEMail(trash, ["d"]).deleteMessageOnServer();

  expect(server.mailboxIds).toBeNull();
  expect(requests.length).toBe(1);
});

test("With the folders from our last sync, deleting from Trash keeps the email in its other folder, with a single request", async () => {
  let { account, server, requests, trash } = newAccount({ a: true, d: true });
  account.syncState.set("Email", server.state);

  await newEMail(trash, ["a", "d"]).deleteMessageOnServer();

  expect(server.mailboxIds).toEqual({ a: true });
  expect(requests.length).toBe(1);
});

test("An email that was put into another folder after our last sync stays there", async () => {
  // Our last sync said: only in Trash. Since then, another device copied it to the Inbox.
  let { account, server, trash } = newAccount({ a: true, d: true });
  account.syncState.set("Email", "sold");

  await newEMail(trash, ["d"]).deleteMessageOnServer();

  expect(server.mailboxIds).toEqual({ a: true });
});

test("An email that was removed from its other folder after our last sync is destroyed", async () => {
  // Our last sync said: in Inbox and Trash. Since then, another device removed it from the Inbox.
  let { account, server, trash } = newAccount({ d: true });
  account.syncState.set("Email", "sold");

  await newEMail(trash, ["a", "d"]).deleteMessageOnServer();

  expect(server.mailboxIds).toBeNull();
});
