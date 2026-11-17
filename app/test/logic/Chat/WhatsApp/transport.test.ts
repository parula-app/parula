// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { RemoteSocketTransport } from "../../../../logic/Chat/WhatsApp/WhatsAppConnection";
import net from "node:net";
import { waitFor } from "../../util/waitFor";
import { expect, test } from "vitest";

/** RemoteSocketTransport adapts a backend `net.Socket` (a JPC proxy in
 * production) to our WhatsAppTransport interface. A real `net.Socket` has the
 * same on/connect/write/destroy shape, so we drive the adapter with one directly
 * against a throwaway localhost server — no JPC, no external network. */

function listen(handler: (socket: net.Socket) => void): Promise<net.Server> {
  let server = net.createServer(handler);
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function portOf(server: net.Server): number {
  return (server.address() as net.AddressInfo).port;
}

test("connects, sends bytes, receives bytes, and reports a server close", async () => {
  let received: number[] = [];
  let peer: net.Socket | null = null;
  let server = await listen(socket => {
    peer = socket;
    socket.on("data", (data: Buffer) => {
      received.push(...data);
      socket.write(Uint8Array.from([0xAA, 0xBB, 0xCC]));
    });
  });

  let transport = new RemoteSocketTransport(new net.Socket(), "127.0.0.1", portOf(server));
  let chunks: Uint8Array[] = [];
  let closed = false;
  transport.onData(data => chunks.push(data));
  transport.onClose(() => closed = true);

  await transport.connect();
  await transport.send(Uint8Array.from([1, 2, 3]));

  await waitFor(() => chunks.length > 0);
  expect([...chunks[0]]).toEqual([0xAA, 0xBB, 0xCC]);
  expect(received).toEqual([1, 2, 3]);

  peer!.end(); // server-initiated close surfaces to the app
  await waitFor(() => closed);
  expect(closed).toBe(true);

  server.close();
});

test("connect() rejects when the connection is refused", async () => {
  let server = await listen(() => undefined);
  let port = portOf(server);
  await new Promise<void>(resolve => server.close(() => resolve())); // free the port so connecting is refused

  let transport = new RemoteSocketTransport(new net.Socket(), "127.0.0.1", port);
  await expect(transport.connect()).rejects.toThrow();
});

test("close() we initiate is not reported as an unexpected disconnect", async () => {
  let server = await listen(() => undefined);
  let transport = new RemoteSocketTransport(new net.Socket(), "127.0.0.1", portOf(server));
  let closed = false;
  transport.onClose(() => closed = true);

  await transport.connect();
  await transport.close();
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(closed).toBe(false);

  server.close();
});
