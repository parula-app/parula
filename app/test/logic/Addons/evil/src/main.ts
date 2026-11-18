// Runs in the addon's worker
import { Probes, type EvilConfig } from "./probes";
import { evilHTML } from "./html";

mustang.ui.onCommand("probe", async () => {
  let config = await mustang.storage.get("config") as unknown as EvilConfig;
  let probes = new Probes(config, "worker");
  probes.results.origin = self.origin;
  probes.results.hasParent = typeof (self as any).parent;
  probes.results.rtc = typeof (self as any).RTCPeerConnection;
  await probes.storage();
  await probes.network();
  await probes.bridge();
  await probes.attempt("importScriptsDenied", () => (self as any).importScripts(probes.url(config.denied, "importScripts.js")));
  await probes.attempt("nestedWorkerFetch", () => new Promise((resolve, reject) => {
    let code = `fetch(${JSON.stringify(probes.url(config.denied, "nestedWorker"))}).then(() => postMessage("ALLOWED"), ex => postMessage("blocked " + ex))`;
    let worker = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
    worker.onmessage = event => event.data == "ALLOWED" ? resolve("fetched") : reject(new Error(event.data));
    worker.onerror = () => reject(new Error("worker error"));
  }));
  await mustang.storage.set("results:worker-" + config.tag, probes.results);
});

mustang.ui.onCommand("perf", async ({ messages }) => {
  const kRoundTrips = 1000;
  const kBatch = 10000;
  let message = messages[0] as any;
  for (let i = 0; i < 100; i++) {
    await message.count(i);
  }
  let start = performance.now();
  for (let i = 0; i < kRoundTrips; i++) {
    await message.count(i);
  }
  let roundTripMS = (performance.now() - start) / kRoundTrips;
  start = performance.now();
  let counts = await Promise.all(Array.from({ length: kBatch }, (_, i) => message.count(i)));
  let batchMS = performance.now() - start;
  // Without batching: each call in its own task, so each goes in its own message
  start = performance.now();
  let pending = [];
  for (let i = 0; i < kBatch; i++) {
    pending.push(message.count(i));
    await new Promise(resolve => {
      let channel = new MessageChannel();
      channel.port1.onmessage = resolve;
      channel.port2.postMessage(null);
    });
  }
  await Promise.all(pending);
  let unbatchedMS = performance.now() - start;
  await mustang.storage.set("perf", {
    roundTripMS,
    batch10000MS: batchMS,
    unbatched10000MS: unbatchedMS,
    batchCorrect: counts[kBatch - 1] == kBatch - 1,
  });
});

mustang.ui.onCommand("count", async ({ messages }) => {
  let at = Date.now();
  await mustang.storage.set("count", messages.length);
  await mustang.storage.set("countAt", at);
});

mustang.ui.onCommand("compose", async ({ draft }) => {
  let config = await mustang.storage.get("config") as unknown as EvilConfig;
  draft.html = evilHTML(`${config.denied}/compose_${config.tag}`);
});
