import http from "node:http";
import https from "node:https";
import { Readable, pipeline } from "node:stream";

/**
 * Sends the requests of node.js `fetch()` over `node:http` and `node:https`.
 *
 * `fetch()` parses HTTP with WebAssembly. On iOS, node.js runs with `--jitless`,
 * because Apple doesn't allow JIT, and without JIT, there is no WebAssembly.
 *
 * Redirects, decompression and the `Response` stay with `fetch()`.
 */
export class NodeHTTPDispatcher {
  /** `options` and `handler` as passed by `fetch()`, see undici `Dispatcher.dispatch()` */
  dispatch(options: any, handler: any): boolean {
    let url = new URL(options.path, options.origin);
    let protocolModule = url.protocol == "https:" ? https : http;
    const kTimeoutMS = 300000;
    let request = protocolModule.request(url, {
      method: options.method,
      headers: options.headers,
      // Not `request.setTimeout()`, which fires after the 5 s of `http.globalAgent` while connecting
      timeout: kTimeoutMS,
    });
    let finished = false;
    function fail(ex: Error) {
      if (finished) {
        return;
      }
      finished = true;
      handler.onError(ex);
    }
    request.on("error", fail);
    request.on("timeout", () => {
      let ex = new Error(`HTTP request to ${url.host} timed out`) as Error & { code: string };
      ex.code = "ETIMEDOUT";
      request.destroy(ex);
    });
    const kConnectTimeoutMS = 10000;
    request.on("socket", socket => {
      if (!socket.connecting) {
        return;
      }
      let connectTimeout = setTimeout(() => {
        let ex = new Error(`Connecting to ${url.host} timed out`) as Error & { code: string };
        ex.code = "UND_ERR_CONNECT_TIMEOUT";
        request.destroy(ex);
      }, kConnectTimeoutMS);
      socket.once(url.protocol == "https:" ? "secureConnect" : "connect", () => clearTimeout(connectTimeout));
      request.once("close", () => clearTimeout(connectTimeout));
    });
    handler.onConnect((reason: Error) => request.destroy(reason));
    request.on("response", response => {
      response.on("error", fail);
      handler.onResponseStarted?.();
      let rawHeaders = response.rawHeaders.map(value => Buffer.from(value, "latin1"));
      handler.onHeaders(response.statusCode, rawHeaders, () => response.resume(), response.statusMessage);
      response.on("data", chunk => {
        if (handler.onData(chunk) === false) {
          response.pause();
        }
      });
      response.on("end", () => {
        if (finished) {
          return;
        }
        finished = true;
        handler.onComplete(null);
      });
    });
    if (options.body) {
      pipeline(Readable.from(options.body), request, ex => {
        if (ex) {
          fail(ex);
        }
      });
    } else {
      request.end();
    }
    return true;
  }
}
