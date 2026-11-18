/**
 * Runs under `node --jitless`, like node.js on iOS, where there is no WebAssembly.
 * Started by `NodeHTTPDispatcher.test.ts`, which passes the URL to fetch.
 */
import { NodeHTTPDispatcher } from "../../../../mobile/backend/NodeHTTPDispatcher";

// Same as in mobile/backend/backend.ts
(globalThis as any)[Symbol.for("undici.globalDispatcher.1")] = new NodeHTTPDispatcher();

let response = await fetch(process.argv[2]);
console.log(JSON.stringify({
  webAssembly: typeof WebAssembly,
  status: response.status,
  text: await response.text(),
}));
