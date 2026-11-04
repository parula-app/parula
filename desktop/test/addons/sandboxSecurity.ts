// Electron main process of the sandbox security test. Started by `runSandboxSecurity.ts`.
// Sets up the session like `src/main/index.ts` does, with test servers, and loads `host.ts` in a window.
import { app, BrowserWindow, session, type Session } from "electron";
import { AddonFrameGuard } from "../../src/main/addonSandbox";
import https from "node:https";
import http from "node:http";
import type { Socket } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[process.argv.length - 1];
/** host + path -> number of requests */
const hits: Record<string, number> = {};
/** path -> Cookie header that arrived */
const cookieHeaders: Record<string, string> = {};

function count(host: string, url: string): void {
  let key = host.replace(/:\d+$/, "") + new URL(url, "https://x").pathname;
  hits[key] = (hits[key] ?? 0) + 1;
}

async function listen(server: http.Server | https.Server, host: string): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, host, resolve));
  return (server.address() as { port: number }).port;
}

const tls = { key: readFileSync(path.join(dir, "key.pem")), cert: readFileSync(path.join(dir, "cert.pem")) };
let httpsPort = 0;
const httpsServer = https.createServer(tls, (request, response) => {
  count(request.headers.host, request.url);
  let headers = { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" };
  if (request.url.endsWith("/redirect")) {
    response.writeHead(302, { ...headers, Location: `https://denied.addon-test.example:${httpsPort}${request.url}ed` });
    response.end();
    return;
  }
  if (request.url.endsWith("cookie")) {
    cookieHeaders[request.url] = request.headers.cookie ?? "none";
    let name = "set-by-" + request.url.split("/")[1];
    response.writeHead(200, { ...headers, "Set-Cookie": `${name}=1; Secure; SameSite=None` });
    response.end(request.headers.cookie ?? "none");
    return;
  }
  response.writeHead(200, headers);
  response.end("ok");
});
httpsServer.on("upgrade", (request, socket: Socket) => {
  count(request.headers.host, request.url);
  socket.destroy();
});
const ipv6Server = https.createServer(tls, (request, response) => {
  count("[::1]", request.url);
  response.end("ok");
});
const jpcServer = http.createServer((request, response) => {
  count("jpc", request.url);
  response.end("ok");
});
jpcServer.on("upgrade", (request, socket: Socket) => {
  count("jpc", request.url);
  socket.destroy();
});

app.commandLine.appendSwitch("host-resolver-rules", "MAP *.addon-test.example 127.0.0.1, MAP intranet 127.0.0.1, " +
  "MAP rebind.attacker.example 127.0.0.1, MAP public.attacker.example 203.0.113.5");

/** The test servers of the declared and undeclared hosts are on 127.0.0.1, too */
class TestFrameGuard extends AddonFrameGuard {
  async isAllowedRequest(session: Session, url: string): Promise<boolean> {
    if (new URL(url).hostname.endsWith(".addon-test.example")) {
      return this.isAllowedURL(url);
    }
    return await super.isAllowedRequest(session, url);
  }
}

app.whenReady().then(async () => {
  httpsPort = await listen(httpsServer, "127.0.0.1");
  let ipv6Port = await listen(ipv6Server, "::1");
  let jpcPort = await listen(jpcServer, "127.0.0.1");
  let allowed = `https://allowed.addon-test.example:${httpsPort}`;
  let config = {
    allowed,
    denied: `https://denied.addon-test.example:${httpsPort}`,
    local: [`https://localhost:${httpsPort}`, `https://127.0.0.1:${httpsPort}`, `https://[::1]:${ipv6Port}`, `https://intranet:${httpsPort}`],
    jpc: `ws://localhost:${jpcPort}`,
    rebind: `https://rebind.attacker.example:${httpsPort}`,
  };
  let defaultSession = session.defaultSession;
  defaultSession.setCertificateVerifyProc((_request, callback) => callback(0));
  let guard = new TestFrameGuard();
  guard.install(defaultSession);
  let guardResults = {
    rebindResolvesTo: (await defaultSession.resolveHost("rebind.attacker.example")).endpoints.map(endpoint => endpoint.address),
    rebind: await guard.isAllowedRequest(defaultSession, "https://rebind.attacker.example/x"),
    publicResolvesTo: (await defaultSession.resolveHost("public.attacker.example")).endpoints.map(endpoint => endpoint.address),
    public: await guard.isAllowedRequest(defaultSession, "https://public.attacker.example/x"),
    urls: Object.fromEntries([
      "https://203.0.113.5/", "https://[2001:db8::1]/", "https://[64:ff9b::cb00:7105]/", "https://[::ffff:cb00:7105]/",
      "https://10.1.2.3/", "https://[::ffff:10.1.2.3]/", "https://[64:ff9b::7f00:1]/", "https://[64:ff9b::a01:203]/",
      "https://[64:ff9b:1::cb00:7105]/", "https://[::127.0.0.1]/", "https://[fd00::1]/", "https://169.254.169.254/",
    ].map(url => [url, guard.isAllowedURL(url)])),
  };
  // Like allowCrossDomainRequestsFromFrontend() in src/main/index.ts
  defaultSession.webRequest.onBeforeSendHeaders({ urls: ["https://*/*", "http://*/*"] }, (details, callback) => {
    let requestHeaders = details.requestHeaders;
    delete requestHeaders["Origin"];
    delete requestHeaders["Referer"];
    guard.removeRequestCookies(details.frame, requestHeaders);
    callback({ requestHeaders });
  });
  defaultSession.webRequest.onHeadersReceived({ urls: ["https://*/*", "http://*/*"] }, (details, callback) => {
    let responseHeaders = details.responseHeaders ?? {};
    responseHeaders["Access-Control-Allow-Origin"] = ["*"];
    guard.removeResponseCookies(details.frame, responseHeaders);
    callback({ responseHeaders });
  });
  app.on("web-contents-created", (_event, webContents) => {
    webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    guard.protect(webContents);
  });
  await defaultSession.cookies.set({ url: allowed, name: "appsession", value: "secret-session", secure: true, sameSite: "no_restriction" });

  let window = new BrowserWindow({
    show: true,
    frame: false,
    width: 1200,
    height: 800,
    webPreferences: { sandbox: false, webviewTag: true, backgroundThrottling: false },
  });
  await window.loadFile(path.join(dir, "index.html"), { query: { config: JSON.stringify(config) } });
  for (let i = 0; i < 600; i++) {
    if (await window.webContents.executeJavaScript("window.__done")) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  let results = await window.webContents.executeJavaScript("window.__results");
  results.hits = hits;
  results.cookieHeaders = cookieHeaders;
  results.cookiesAfter = (await defaultSession.cookies.get({})).map(cookie => cookie.name + "@" + cookie.domain);
  results.config = config;
  results.guard = guardResults;
  results.electron = process.versions.electron;
  console.log("SANDBOX-TEST-RESULT " + JSON.stringify(results));
  window.destroy();
  for (let server of [httpsServer, ipv6Server, jpcServer]) {
    server.closeAllConnections();
    server.close();
  }
  app.quit();
}).catch(ex => {
  console.log("SANDBOX-TEST-RESULT " + JSON.stringify({ error: String(ex?.stack ?? ex) }));
  app.quit();
});
