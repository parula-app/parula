/**
 * `NodeHTTPDispatcher` sends the requests of node's `fetch()` over `node:http`,
 * because `fetch()` itself needs WebAssembly, which node.js on iOS doesn't have.
 * The tests check that `fetch()` still behaves like `fetch()`.
 */
import { NodeHTTPDispatcher } from "../../../../mobile/backend/NodeHTTPDispatcher";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import zlib from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../../..");

describe("NodeHTTPDispatcher: fetch() without WebAssembly", () => {
  let server: http.Server;
  let baseURL: string;

  beforeAll(async () => {
    server = http.createServer(async (request, response) => {
      let body = "";
      for await (let chunk of request) {
        body += chunk;
      }
      if (request.url == "/text") {
        response.setHeader("X-Test", "header value");
        response.end("Hello");
      } else if (request.url == "/gzip") {
        response.setHeader("Content-Encoding", "gzip");
        response.end(zlib.gzipSync("Compressed hello"));
      } else if (request.url == "/redirect") {
        response.statusCode = 302;
        response.setHeader("Location", "/text");
        response.end();
      } else if (request.url == "/slow") {
        setTimeout(() => response.end("Late"), 2000);
      } else if (request.url == "/echo") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ method: request.method, contentType: request.headers["content-type"], body }));
      } else {
        response.statusCode = 404;
        response.end("Not found");
      }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  /** `fetch()` of node.js, but sent with `NodeHTTPDispatcher` */
  function fetchWithDispatcher(url: string, init?: RequestInit): Promise<Response> {
    return fetch(url, { ...init, dispatcher: new NodeHTTPDispatcher() } as RequestInit);
  }

  it("reads the status, headers and body", async () => {
    let response = await fetchWithDispatcher(baseURL + "/text");
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Test")).toBe("header value");
    expect(await response.text()).toBe("Hello");
  });

  it("reports an HTTP error status", async () => {
    let response = await fetchWithDispatcher(baseURL + "/missing");
    expect(response.ok).toBe(false);
    expect(response.status).toBe(404);
  });

  it("decompresses the body", async () => {
    let response = await fetchWithDispatcher(baseURL + "/gzip");
    expect(await response.text()).toBe("Compressed hello");
  });

  it("follows redirects", async () => {
    let response = await fetchWithDispatcher(baseURL + "/redirect");
    expect(response.redirected).toBe(true);
    expect(response.url).toBe(baseURL + "/text");
    expect(await response.text()).toBe("Hello");
  });

  it("sends the request body", async () => {
    let response = await fetchWithDispatcher(baseURL + "/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "value" }),
    });
    let echo = await response.json();
    expect(echo.method).toBe("POST");
    expect(echo.contentType).toBe("application/json");
    expect(JSON.parse(echo.body)).toEqual({ name: "value" });
  });

  it("reports network errors like fetch(), with the error code in `cause`", async () => {
    // A port where nothing listens
    let closedServer = http.createServer();
    await new Promise<void>(resolve => closedServer.listen(0, "127.0.0.1", resolve));
    let closedPort = (closedServer.address() as AddressInfo).port;
    await new Promise(resolve => closedServer.close(resolve));

    let request = fetchWithDispatcher(`http://127.0.0.1:${closedPort}/`);
    await expect(request).rejects.toBeInstanceOf(TypeError);
    // `HTTPFetchError` in mobile/backend/backend.ts and `isNetworkError()` read it from there
    await expect(request).rejects.toMatchObject({ cause: { code: "ECONNREFUSED" } });
  });

  it("aborts a running request", async () => {
    let controller = new AbortController();
    let request = fetchWithDispatcher(baseURL + "/slow", { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("works under `node --jitless`, like on iOS", async () => {
    // node.js can't run TypeScript without WebAssembly, so compile it first
    let script = path.join(mkdtempSync(path.join(tmpdir(), "node-http-dispatcher-")), "jitless.mjs");
    execFileSync(path.join(appDir, "node_modules/.bin/esbuild"),
      [path.join(here, "NodeHTTPDispatcher.jitless.ts"),
        "--bundle", "--platform=node", "--format=esm", "--log-level=warning",
        "--outfile=" + script]);
    // Not `execFileSync()`, because the test server runs in this thread
    let { stdout } = await promisify(execFile)(process.execPath, ["--jitless", script, baseURL + "/text"],
      { encoding: "utf8", timeout: 30 * 1000 });
    let result = JSON.parse(stdout);
    // Makes sure that the test runs without WebAssembly
    expect(result.webAssembly).toBe("undefined");
    expect(result.status).toBe(200);
    expect(result.text).toBe("Hello");
  });
});
