import ky from "ky";
import net from "node:net";
import { afterAll, beforeAll, expect, test } from "vitest";

/** A minimal HTTP/1.1 server with keep-alive, whose connections can die like during
 * computer sleep: the server forgot them, and answers our next request on them with a RST */
class SleepyServer {
  server: net.Server;
  url: string;
  protected connections: { socket: net.Socket, dead: boolean }[] = [];

  async start() {
    this.server = net.createServer(socket => {
      let connection = { socket, dead: false };
      this.connections.push(connection);
      let buffer = "";
      socket.on("data", data => {
        if (connection.dead) {
          socket.resetAndDestroy();
          return;
        }
        buffer += data.toString();
        let headerEnd = buffer.indexOf("\r\n\r\n");
        let length = parseInt(/content-length: *(\d+)/i.exec(buffer)?.[1] ?? "0");
        if (headerEnd < 0 || buffer.length < headerEnd + 4 + length) {
          return; // the rest of the request is still coming
        }
        buffer = "";
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nok");
      });
      socket.on("error", () => {});
    });
    await new Promise<void>(resolve => this.server.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as net.AddressInfo).port}/jmap/`;
  }

  /** The computer sleeps, and meanwhile the server closes its idle connections */
  async sleep() {
    await new Promise(resolve => setTimeout(resolve, 50)); // `fetch()` puts the connection back into its pool
    for (let connection of this.connections) {
      connection.dead = true;
    }
  }

  async stop() {
    for (let connection of this.connections) {
      connection.socket.destroy();
    }
    await new Promise(resolve => this.server.close(resolve));
  }
}

// desktop/backend/backend.ts can't be loaded here (Electron), so this is the same function
// <copied from="../../../../desktop/backend/backend.ts">
/** The server closed our idle keep-alive connections while the computer slept, but we
 * don't know that yet, and the next request on one of them would fail with "fetch failed".
 * Chromium closes them when the computer wakes up, Node's `fetch()` doesn't.
 * Requests that are still running finish on the old connections. */
function closeIdleHTTPConnections(): void {
  const kGlobalDispatcher = Symbol.for("undici.globalDispatcher.1"); // Shared by `fetch()` and the `undici` package
  let dispatcher = (globalThis as any)[kGlobalDispatcher];
  if (!dispatcher) {
    return;
  }
  (globalThis as any)[kGlobalDispatcher] = new dispatcher.constructor();
  dispatcher.close().catch(console.error);
}
// </copied>

let server = new SleepyServer();

beforeAll(async () => {
  await server.start();
});

afterAll(async () => {
  await server.stop();
});

/** Like the backend's `kyCreate()` (Node's `fetch()` retries only plain string bodies by itself) */
async function post(): Promise<string> {
  return await ky.post(server.url, { json: {} }).text();
}

test("Without closing them, the first request after sleep goes into a dead connection", async () => {
  closeIdleHTTPConnections();
  expect(await post()).toBe("ok");
  await server.sleep();

  await expect(post()).rejects.toThrow();
});

test("After the computer woke up, the first request works", async () => {
  closeIdleHTTPConnections();
  expect(await post()).toBe("ok");
  await server.sleep();

  closeIdleHTTPConnections(); // on resume
  expect(await post()).toBe("ok");
});
