// UI module: runs in a sandboxed frame, in the same realm as the page
import { Probes, type EvilConfig } from "./probes";

const received: unknown[] = [];

export default function (target: HTMLElement, context: any): () => void {
  window.addEventListener("message", event => received.push(event.data));
  let box = document.createElement("div");
  box.style.width = "285px";
  box.style.height = "45px";
  box.textContent = "Evil";
  target.appendChild(box);
  run(context)
    .catch(ex => mustang.storage.set("results:frame-error", String(ex)));
  return () => box.remove();
}

async function run(context: any): Promise<void> {
  let config = await mustang.storage.get("config") as unknown as EvilConfig;
  let probes = new Probes(config, "frame");
  let results = probes.results;
  results.origin = self.origin;
  results.rtc = typeof (window as any).RTCPeerConnection + " " + typeof (window as any).webkitRTCPeerConnection;
  let root = getComputedStyle(document.documentElement);
  results.themeFG = root.getPropertyValue("--test-fg").trim();
  results.colorScheme = root.colorScheme;
  results.background = getComputedStyle(document.body).backgroundColor;
  let theContext: any;
  context.subscribe(value => theContext = value)();
  results.contextSubject = theContext?.message?.subject;
  await probes.attempt("parentDocument", () => window.parent.document.title);
  await probes.attempt("parentSecret", () => (window.parent as any).appSecret);
  await probes.attempt("parentAppGlobal", () => (window.parent as any).appGlobal.secret);
  await probes.attempt("topLocation", () => window.top.location.href);
  await probes.attempt("cookie", () => {
    document.cookie = "evil=1";
    return document.cookie;
  });
  await probes.storage();
  await probes.attempt("windowOpen", () => window.open(probes.url(config.denied, "popup")) ?? Promise.reject(new Error("null")));
  await probes.attempt("nestedFrame", () => new Promise((resolve, reject) => {
    let frame = document.createElement("iframe");
    frame.src = probes.url(config.allowed, "nestedFrame");
    frame.onload = () => {
      try {
        resolve(frame.contentWindow.location.href);
      } catch (ex) {
        reject(ex);
      }
    };
    document.body.appendChild(frame);
  }));
  await probes.attempt("image", () => new Promise((resolve, reject) => {
    let image = new Image();
    image.onload = () => resolve("loaded");
    image.onerror = () => reject(new Error("image error"));
    image.src = probes.url(config.denied, "image");
  }));
  await probes.attempt("beacon", () => navigator.sendBeacon(probes.url(config.denied, "beacon"), "data") || Promise.reject(new Error("false")));
  await probes.attempt("form", () => {
    let form = document.createElement("form");
    form.action = probes.url(config.denied, "form");
    form.method = "POST";
    document.body.appendChild(form);
    form.submit();
    return "submitted";
  });
  await probes.attempt("sharedWorker", () => new SharedWorker(URL.createObjectURL(new Blob([""], { type: "text/javascript" }))));
  await probes.attempt("serviceWorker", () => navigator.serviceWorker.register("sw.js"));
  await probes.attempt("notification", async () => {
    let permission = await Notification.requestPermission();
    return permission == "granted" ? permission : Promise.reject(new Error(permission));
  });
  await probes.attempt("geolocation", () => new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(position => resolve(position.coords.latitude), error => reject(new Error(error.message)))));
  await probes.attempt("camera", () => navigator.mediaDevices.getUserMedia({ video: true }));
  await probes.attempt("clipboard", () => navigator.clipboard.readText());
  await probes.network();
  await probes.bridge();
  await probes.attempt("removeCSPMeta", async () => {
    for (let meta of document.querySelectorAll("meta[http-equiv]")) {
      meta.remove();
    }
    return (await fetch(probes.url(config.denied, "afterMetaRemoved"))).status;
  });
  await probes.attempt("pushStatePath", () => {
    history.pushState(null, "", "other.html");
    return location.href;
  });
  await probes.attempt("pushStateQuery", () => {
    history.pushState(null, "", "?pushed#pushed");
    return location.href;
  });
  for (let [i, base] of config.local.entries()) {
    await probes.attempt("pushedLocal" + i, async () => (await fetch(probes.url(base, "pushedLocal" + i))).status);
  }
  await probes.attempt("pushedRebind", async () => (await fetch(probes.url(config.rebind, "pushedRebind"))).status);
  await probes.attempt("siblingFrames", () => {
    for (let i = 0; i < window.parent.frames.length; i++) {
      window.parent.frames[i].postMessage({ evil: config.tag }, "*");
    }
    return window.parent.frames.length + " frames";
  });
  await new Promise(resolve => setTimeout(resolve, 300));
  results.receivedFromSiblings = JSON.stringify(received);
  for (let element of document.body.querySelectorAll("iframe, form")) {
    element.remove();
  }
  await mustang.storage.set("results:frame-" + config.tag, results);
}
