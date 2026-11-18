import { appGlobal } from "../../../../logic/app";
import { IMAPAccount, ConnectionPurpose } from "../../../../logic/Mail/IMAP/IMAPAccount";
import { waitFor } from "../../util/waitFor";
import { expect, test } from "vitest";

/** An IMAP account whose Inbox counts the checks for new mail */
class TestIMAPAccount extends IMAPAccount {
  inboxChecks = 0;

  get inbox(): any {
    return {
      path: "INBOX",
      getNewMessages: async () => {
        this.inboxChecks++;
      },
    };
  }
}

/** Fake ImapFlow connections, which let the test fire their events */
class FakeServer {
  readonly connections: { id: string, handlers: Record<string, (...args: any[]) => Promise<void>>, openedFolders: string[] }[] = [];

  createIMAPFlowConnection() {
    let connection = {
      id: "connection-" + (this.connections.length + 1),
      handlers: {} as Record<string, (...args: any[]) => Promise<void>>,
      openedFolders: [] as string[],
      on(event: string, handler: (...args: any[]) => Promise<void>) {
        this.handlers[event] = handler;
      },
      connect: async () => undefined,
      mailboxOpen: async (path: string) => {
        connection.openedFolders.push(path);
      },
      close: () => undefined,
      logout: async () => undefined,
    };
    this.connections.push(connection);
    return connection;
  }
}

test("After the connection broke, e.g. while the computer slept, we check the Inbox for mail that arrived meanwhile", async () => {
  let server = new FakeServer();
  appGlobal.remoteApp = {
    createIMAPFlowConnection: () => server.createIMAPFlowConnection(),
  } as any;
  let account = new TestIMAPAccount();
  account.hostname = "imap.example.com";
  account.username = "me@example.com";
  account.password = "secret";
  account.errorCallback = () => undefined;
  await account.connection(false, ConnectionPurpose.Main);
  expect(account.inboxChecks).toBe(0);

  // The connection breaks. IDLE on the new connection reports only what happens from then on.
  await server.connections[0].handlers.close();

  await waitFor(() => account.inboxChecks > 0);
  expect(server.connections.length).toBe(2);
  expect(server.connections[1].openedFolders).toContain("INBOX");
});
