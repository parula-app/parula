/* Security test of the addon sandbox in a real Electron.
 * The `evil` addon (app/test/logic/Addons/evil/) tries everything that an addon must not be able to do,
 * in its worker and in its UI frames, once with a declared host and once with `network.any`.
 * Local https, WebSocket and "JPC" servers count every request that reaches them.
 *
 * Usage, in app/: npx tsx ../desktop/test/addons/runSandboxSecurity.ts
 * Environment: ELECTRON = path of the Electron binary (default: the one in desktop/node_modules)
 * ELECTRON_FLAGS = more command line flags, e.g. `--no-sandbox` in a container without the Chromium sandbox helper.
 * It uses --ozone-platform=headless with a frameless window, so it needs no display. */
import { SandboxPage } from "../../../app/logic/Addons/Sandbox/SandboxPage";
import { AddonBuilder } from "../../../addons/examples/build";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

class SandboxSecurityTest {
  readonly testDir = fileURLToPath(new URL(".", import.meta.url));
  readonly appDir = fileURLToPath(new URL("../../../app/", import.meta.url));
  readonly rows: { name: string, ok: boolean, detail: string }[] = [];
  results: any;

  async run(): Promise<boolean> {
    let dir = await mkdtemp(path.join(tmpdir(), "addon-sandbox-test-"));
    try {
      await this.build(dir);
      this.results = await this.startElectron(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    this.check();
    this.print();
    return this.rows.every(row => row.ok);
  }

  protected async build(dir: string): Promise<void> {
    let esbuild = createRequire(this.appDir + "package.json")("esbuild");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=addon-test",
      "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem"),
      "-addext", "subjectAltName=DNS:*.addon-test.example,DNS:localhost,DNS:intranet,IP:127.0.0.1,IP:::1"], { stdio: "ignore" });
    await writeFile(path.join(dir, "addon-sandbox.html"), await new SandboxPage().build());
    let evilFiles = await new AddonBuilder(this.appDir + "test/logic/Addons/evil").build(false);
    let evilCode = Object.fromEntries([...evilFiles].map(([file, contents]) => [file, new TextDecoder().decode(contents)]));
    await esbuild.build({
      entryPoints: [this.testDir + "host.ts"],
      outfile: path.join(dir, "host.js"),
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2022",
      define: { kEvilCode: JSON.stringify(evilCode) },
      nodePaths: [this.appDir + "node_modules"],
      logLevel: "warning",
      logOverride: { "tsconfig.json": "silent" },
    });
    await esbuild.build({
      entryPoints: [this.testDir + "sandboxSecurity.ts"],
      outfile: path.join(dir, "main.mjs"),
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      external: ["electron"],
      logLevel: "warning",
      logOverride: { "tsconfig.json": "silent" },
    });
    let appHTML = await readFile(this.appDir + "index.html", "utf-8");
    let appPolicy = appHTML.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/s)[0];
    await writeFile(path.join(dir, "index.html"), `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  ${appPolicy}
  <style>:root { --test-fg: rgb(1, 2, 3); color-scheme: light dark; }</style>
</head>
<body>
  <script src="host.js"></script>
</body>
</html>
`);
  }

  protected async startElectron(dir: string): Promise<any> {
    let electron = process.env.ELECTRON ?? createRequire(fileURLToPath(new URL("../../package.json", import.meta.url)))("electron");
    let flags = process.env.ELECTRON_FLAGS?.split(" ").filter(flag => flag) ?? [];
    let child = spawn(electron, ["--ozone-platform=headless", ...flags, path.join(dir, "main.mjs"), dir], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", data => output += data);
    child.stderr.on("data", data => output += data);
    let timeout = setTimeout(() => child.kill(), 300000);
    await new Promise(resolve => child.on("exit", resolve));
    clearTimeout(timeout);
    let line = output.split("\n").find(text => text.startsWith("SANDBOX-TEST-RESULT "));
    if (!line) {
      throw new Error("No result from Electron:\n" + output.slice(-3000));
    }
    return JSON.parse(line.substring("SANDBOX-TEST-RESULT ".length));
  }

  protected expect(name: string, ok: boolean, detail: unknown = ""): void {
    this.rows.push({ name, ok, detail: typeof detail == "string" ? detail : JSON.stringify(detail) });
  }

  protected blocked(probes: Record<string, string>, where: string, names: string[]): void {
    for (let name of names) {
      this.expect(`${where}: ${name} is blocked`, !!probes?.[name]?.startsWith("blocked"), probes?.[name]);
    }
  }

  protected hitsFor(filter: (key: string) => boolean): Record<string, number> {
    return Object.fromEntries(Object.entries(this.results.hits as Record<string, number>).filter(([key]) => filter(key)));
  }

  protected noHits(name: string, filter: (key: string) => boolean): void {
    let hits = this.hitsFor(filter);
    this.expect(name, Object.keys(hits).length == 0, hits);
  }

  protected check(): void {
    let results = this.results;
    this.expect("The test ran without errors", !results.error, results.error);
    let localHosts = ["localhost/", "127.0.0.1/", "[::1]/", "intranet/"];
    for (let tag of ["hosts", "any"]) {
      let frame = results["frame-" + tag];
      let worker = results["worker-" + tag];
      let where = `${tag}, frame`;
      let inWorker = `${tag}, worker`;
      this.expect(`${where}: origin is opaque`, frame?.origin == "null", frame?.origin);
      this.expect(`${inWorker}: origin is opaque`, worker?.origin == "null", worker?.origin);
      this.blocked(frame, where, ["parentDocument", "parentSecret", "parentAppGlobal", "topLocation"]);
      this.blocked(frame, where, ["localStorage", "sessionStorage", "indexedDB", "caches", "cookie"]);
      this.blocked(worker, inWorker, ["localStorage", "sessionStorage", "indexedDB", "caches"]);
      this.blocked(frame, where, ["windowOpen", "nestedFrame", "sharedWorker", "serviceWorker", "pushStatePath"]);
      this.blocked(frame, where, ["notification", "geolocation", "camera", "clipboard"]);
      this.blocked(frame, where, ["mailAccounts", "chatAccounts"]);
      this.blocked(worker, inWorker, ["mailAccounts", "chatAccounts"]);
      this.expect(`${where}: no WebRTC`, frame?.rtc == "undefined undefined", frame?.rtc);
      this.expect(`${inWorker}: no WebRTC`, worker?.rtc == "undefined", worker?.rtc);
      for (let probes of [frame, worker]) {
        let name = probes == frame ? where : inWorker;
        this.expect(`${name}: fetch to the declared host works`, !!probes?.fetchAllowed?.startsWith("ALLOWED"), probes?.fetchAllowed);
        let cookiePath = `/${probes == frame ? "frame" : "worker"}-${tag}/cookie`;
        this.expect(`${name}: requests to the declared host carry no cookie`, results.cookieHeaders?.[cookiePath] == "none", results.cookieHeaders);
        this.blocked(probes, name, ["local0", "local1", "local2", "local3", "jpcWebSocket", "jpcHTTP", "rebind"]);
      }
      this.blocked(frame, where, ["pushedLocal0", "pushedLocal1", "pushedLocal2", "pushedLocal3", "pushedRebind"]);
      this.noHits(`${tag}: HTML that the addon wrote into a draft loads nothing in the app`, key => key.includes(`/compose_${tag}/`));
      let draft = results["compose-" + tag] ?? "";
      this.expect(`${tag}: the draft keeps the addon's text and data: images`, draft.includes("Draft text") && draft.includes("data:image/gif"), draft);
      let control = this.hitsFor(key => key.includes(`/control_${tag}/`));
      this.expect(`${tag}: control: the same HTML without the bridge loads in the app, also via srcset`,
        Object.keys(control).some(key => key.endsWith("/img.png")) && Object.keys(control).some(key => key.endsWith("/srcset.png")), control);
      this.blocked(worker, inWorker, ["importScriptsDenied"]);
      this.expect(`${tag}: self-navigation of the frame is blocked`, results["navigate-" + tag] == "still here", results["navigate-" + tag]);
      this.noHits(`${tag}: nothing reached the navigation targets`, key => key.includes(`/frame-${tag}/navigated`) || key.includes(`/frame-${tag}/metaRefresh`));
      this.noHits(`${tag}: nothing reached nested frames, popups or forms`, key =>
        [`/frame-${tag}/nestedFrame`, `/frame-${tag}/popup`, `/frame-${tag}/form`].some(path => key.includes(path)));
      if (tag == "hosts") {
        let denied = ["fetchDenied", "redirectToDenied", "xhrDenied", "webSocketDenied", "eventSourceDenied", "importDenied"];
        this.blocked(frame, where, [...denied, "image", "removeCSPMeta"]);
        this.blocked(worker, inWorker, [...denied, "nestedWorkerFetch"]);
        this.noHits(`${tag}: nothing reached the undeclared host`, key => key.startsWith("denied.") && key.includes("-hosts/"));
      } else {
        this.expect(`${where}: network.any reaches any https host`, !!frame?.fetchDenied?.startsWith("ALLOWED"), frame?.fetchDenied);
      }
    }
    this.noHits("Nothing reached localhost, 127.0.0.1, ::1 or single-label hosts", key => localHosts.some(host => key.startsWith(host)));
    this.noHits("Nothing reached the JPC stand-in", key => key.startsWith("jpc/"));
    this.noHits("Nothing reached a host name that resolves to 127.0.0.1", key => key.startsWith("rebind."));
    let guard = results.guard;
    this.expect("Control: the rebinding host name resolves to 127.0.0.1", guard?.rebindResolvesTo?.includes("127.0.0.1"), guard);
    this.expect("Guard: a host name that resolves to 127.0.0.1 is blocked", guard?.rebind === false, guard);
    this.expect("Guard: a host name that resolves to a public address is allowed", guard?.public === true && guard?.publicResolvesTo?.includes("203.0.113.5"), guard);
    let urls = guard?.urls ?? {};
    let publicURLs = ["https://203.0.113.5/", "https://[2001:db8::1]/", "https://[64:ff9b::cb00:7105]/", "https://[::ffff:cb00:7105]/"];
    this.expect("Guard: public IPv4 and IPv6 addresses are allowed, also IPv4 in IPv6", publicURLs.every(url => urls[url] === true), urls);
    this.expect("Guard: local addresses are blocked, also IPv4 in IPv6 and NAT64",
      Object.keys(urls).length > publicURLs.length && Object.entries(urls).every(([url, isAllowed]) => publicURLs.includes(url) || isAllowed === false), urls);
    this.expect("The app got no BroadcastChannel message", results.broadcastsReceived?.length == 0, results.broadcastsReceived);
    this.expect("Control: requests of the app carry its cookie", results.cookieHeaders?.["/app/cookie"]?.includes("appsession=secret-session"), results.cookieHeaders);
    this.expect("Control: responses to the app set cookies", results.cookiesAfter?.some(cookie => cookie.startsWith("set-by-app@")), results.cookiesAfter);
    this.expect("Responses to addons set no cookies", !results.cookiesAfter?.some(cookie => /^set-by-(frame|worker)/.test(cookie)), results.cookiesAfter);
    let frame = results["frame-hosts"];
    this.expect("Theme: the app's CSS variables reach the frame", frame?.themeFG == "rgb(1, 2, 3)", frame?.themeFG);
    this.expect("Theme: the frame is transparent", frame?.background == "rgba(0, 0, 0, 0)", frame?.background);
    this.expect("Theme: color-scheme like the app", frame?.colorScheme == "light dark", frame?.colorScheme);
    this.expect("The frame reports the size of its content", results["size-hosts"]?.[0] >= 285 && results["size-hosts"]?.[1] == 45, results["size-hosts"]);
    this.expect("The UI gets its context", frame?.contextSubject == "Context subject", frame?.contextSubject);
    this.expect("Escape reaches the app", results.escapes > 0, results.escapes);
    this.expect("10,000 calls in one tick work", results.perf?.batchCorrect, results.perf);
    this.expect("10,000 messages in one command", results.perf?.headersCount == 10000, results.perf?.headersCount);
  }

  protected print(): void {
    for (let row of this.rows) {
      console.log(`${row.ok ? "ok  " : "FAIL"} ${row.name}${row.ok ? "" : "  " + row.detail.slice(0, 300)}`);
    }
    let failed = this.rows.filter(row => !row.ok).length;
    console.log(`\n${this.rows.length - failed} ok, ${failed} failed. Electron ${this.results.electron}`);
    let perf = this.results.perf ?? {};
    console.log("Performance (ms):", JSON.stringify({
      roundTrip: perf.roundTripMS,
      calls10000Batched: perf.batch10000MS,
      calls10000Unbatched: perf.unbatched10000MS,
      headers10000: perf.headers10000MS,
      headers10000Encode: perf.headersEncodeMS,
      headers10000UntilWorkerHandler: perf.headersUntilWorkerHandlerMS,
      frameReady: this.results.readyMS,
      helloFrameReady: perf.helloFrameReadyMS,
      tenFramesInParallel: perf.tenFramesMS,
    }));
    console.log("Residual risk, sibling frames:", this.results["frame-hosts"]?.siblingFrames,
      "received:", this.results["frame-any"]?.receivedFromSiblings, this.results["frame-hosts"]?.receivedFromSiblings);
  }
}

if (!await new SandboxSecurityTest().run()) {
  process.exitCode = 1;
}
