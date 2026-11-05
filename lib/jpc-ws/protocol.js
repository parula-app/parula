import WSCall from "./WSCall.js";
import JPCProtocol from "../jpc/protocol.js";
import WebSocketNode, { WebSocketServer } from "ws";
import { assert } from "../jpc/util.js";

/** @typedef {number} Integer */
/** @typedef {object} JSON */

/**
 * Wire protocol API
 */
export default class JPCWebSocket extends JPCProtocol {
  _wsCall = null;
  _server = null;
  _wantToClose = false;
  /** `callRemote()` calls waiting for the connection to come back
   * {Array of { resolve, reject, timer }} */
  _connectionWaiters = [];
  errorCallback = (ex) => console.error(ex);
  /** Called after a dropped connection was re-established. */
  reconnectCallback = () => {};

  /**
   * @param startObject {Object} Will be returned to client in "start" function
   */
  constructor(startObject) {
    super(startObject);
  }

  /**
   * Call one of init() or listen() or connect() before calling any of the other functions.
   */
  async init(webSocket) {
    let isReconnect = !!this._wsCall;
    this._wsCall = new WSCall(webSocket);
    await super.init();

    this._connectionUp();
    if (isReconnect) {
      try {
        this.reconnectCallback();
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
  }

  /** Call this when the connection dropped, e.g. around OS sleep,
   * and the reconnect is underway.
   * Waits until `init()` runs again with a live connection,
   * instead of failing the call.
   * @throws after 30s, or when we close deliberately */
  async waitForConnection() {
    await new Promise((resolve, reject) => {
      let waiter = { resolve, reject };
      // fail after 30s
      waiter.timer = setTimeout(() => {
        this._connectionWaiters = this._connectionWaiters.filter(w => w != waiter);
        let ex = new Error("JPC WebSocket is closed, and reconnect did not succeed");
        Object.assign(ex, { code: "ConnectionClosed" });
        reject(ex);
      }, 30 * 1000);
      this._connectionWaiters.push(waiter);
    });
  }

  _connectionUp() {
    let waiters = this._connectionWaiters;
    this._connectionWaiters = [];
    for (let waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  _rejectConnectionWaiters() {
    let waiters = this._connectionWaiters;
    this._connectionWaiters = [];
    for (let waiter of waiters) {
      clearTimeout(waiter.timer);
      let ex = new Error("JPC WebSocket is closed");
      Object.assign(ex, { code: "ConnectionClosed" });
      waiter.reject(ex);
    }
  }

  /**
   * Creates a WebSocket server.
   *
   * Attention: This class currently cannot deal with
   * multiple clients connecting.
   *
   * @param secret {string} 32-char alphanumeric (and dashes allowed) passcode that the client must send to be able to connect
   * @param port {Integer} Between 1024 and 65535
   * @param openPublic {boolean} (optional, default false)
   *   If true, allow other computers from the network to connect.
   *   If false, allow only applications on the local host to connect.
   */
  async listen(secret, port, openPublic) {
    assert(secret && typeof (secret) == "string", "JPC server: Need a JPC secret");
    assert(secret.length >= 32, "JPC server: Need a JPC secret of >= 32 chars, but got " + secret);
    assert(typeof (port) == "number", "Need port");
    let host = openPublic ? '0.0.0.0' : '127.0.0.1'; // TODO IPv6
    let server = this._server = new WebSocketServer({
      host: host,
      port: port,
      maxPayload: 0,
      verifyClient: (info, cb) => verifyClient(info, cb, "jpc-" + secret),
    });
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject); // e.g. the port is still bound
    });
    console.log(`Listening JPC WebSocket on ${openPublic ? "all interfaces " : "localhost"}:${port}`);
    server.on("connection", webSocket => this.newConnection(webSocket));
    // Uncaught errors (e.g. OS resetting socket on resume) kill the whole backend process
    server.on("error", ex => this.errorCallback(ex));
    // If the server drops, e.g. after OS sleep teared down the network stack
    server.on("close", () => {
      if (this._wantToClose) {
        return;
      }
      retryToRecover(
        () => this.listen(secret, port, openPublic),
        ex => this.errorCallback(ex),
        () => this._wantToClose);
    });
  }

  async newConnection(webSocket) {
    try {
      await this.init(webSocket);
    } catch (ex) {
      this.errorCallback(ex);
    }
  }

  async stopListening() {
    if (this._server) {
      this._wantToClose = true;
      this._rejectConnectionWaiters();
      this._server.close();
    }
  }

  /**
   * Connects to a WebSocket server.
   *
   * @param secret {string} 32-char passcode that the client must send to be able to connect
   * @param hostname {string} Optional, default localhost
   * @param port {Integer} Between 1024 and 65535
   */
  async connect(secret, hostname, port) {
    assert(secret && typeof (secret) == "string", "JPC client: Need a JPC secret");
    assert(secret.length >= 32, "JPC client: Need a JPC secret of >= 32 chars, but got " + secret);
    assert(typeof (port) == "number", "Need port");
    assert(!hostname || typeof (hostname) == "string", "Invalid hostname");
    hostname = hostname || "localhost";
    let webSocket = await openWebSocket(`ws://${hostname}:${port}`, "jpc-" + secret);
    await this.init(webSocket);
    // Reconnect if the connection drops, e.g. after the OS tore down networking
    // for sleep. The first attempt races the network stack coming back, so retry.
    webSocket.on("close", () => {
      if (this._wantToClose) {
        return;
      }
      retryToRecover(
        () => this.connect(secret, hostname, port),
        ex => this.errorCallback(ex),
        () => this._wantToClose);
    });
  }

  /**
   * Closes the websocket connection.
   */
  close() {
    this._wantToClose = true;
    this._rejectConnectionWaiters();
    this._wsCall.close();
    if (this._server) {
      this._server.close();
    }
  }

  /**
   * Incoming calls.
   * Implements the wire protocol.
   *
   * @param method {string} the message name, e.g. "func", "get", etc.
   * @param listener {function(JSON): Promise<any>}
   * What the listener function returns is sent back as result to the caller.
   * If listener throws, sends the error message to the caller at the remote end.
   */
  registerIncomingCall(method, listener) {
    this._wsCall.register(method, listener);
  }

  /**
   * Outgoing calls.
   * Implements the wire protocol.
   *
   * @param method {string} the message name, e.g. "func", "get" etc.
   * @param [payload] {JSON} see value in PROTOCOL.md
   * @returns {Promise<any>} see value in PROTOCOL.md
   *   The payload of the corresponding answer.
   * @throws {Error} if:
   *   - the remote end threw an exception
   *   - the connection disappeared
   */
  async callRemote(method, payload) {
    if (this._wsCall?._closed && !this._wantToClose) {
      await this.waitForConnection();
    }
    return await this._wsCall.makeCall(method, payload);
  }
}


/** Re-establish a dropped connection.
 * After machine wakeup, all timers fire at once, and network may not
 * be up yet, so staggered attempts.
 * If they fail, calls `errorCallback`, but keeps still trying forver until success.
 * @param reconnect The `connect()` or `listen()` function
 * @param errorCallback Called once, if all the fast attempts fail. But will keep retrying after that.
 * @param stopNow {() => boolean} true = caller says that the app is now closing, stop retrying */
async function retryToRecover(reconnect, errorCallback, stopNow) {
  const kRetryDelaysMS = [300, 700, 2000, 4000, 4000]; // ms between attempts
  const kKeepTryingMS = 10000; // every 10s forever, until success
  for (let attempt = 0; ; attempt++) {
    await sleep(kRetryDelaysMS[attempt] ?? kKeepTryingMS);
    if (stopNow()) {
      return;
    }
    try {
      await reconnect();
      console.log("Reconnected to backend JPC");
      return;
    } catch (ex) {
      // not fatal, try again
      if (attempt == kRetryDelaysMS.length - 1) {
        console.error(ex);
        errorCallback(new Error("Cannot reconnect to backend JPC. Will keep trying. " + (ex?.message ?? ex)));
      }
    }
  }
}

/** Opens a WebSocket and resolves with it once connected (rejects on error/timeout).
 * Works both in the browser (renderer) and in node.js (backend, mobile). */
function openWebSocket(url, protocol) {
  let webSocket = typeof WebSocket == "function"
    ? new WebSocket(url, protocol) // browser
    : new WebSocketNode(url, protocol); // node.js
  // The browser WebSocket has no node-style `on()`; bridge it to addEventListener.
  webSocket.on ??= (name, func) => webSocket.addEventListener(name, event => func(event.data));
  return new Promise((resolve, reject) => {
    let done = ex => {
      clearTimeout(timer);
      webSocket.removeEventListener("open", onOpen);
      webSocket.removeEventListener("close", onFail);
      webSocket.removeEventListener("error", onFail);
      if (ex) {
        webSocket.close();
        reject(ex);
      } else {
        resolve(webSocket);
      }
    };
    let onOpen = () => done();
    let onFail = () => done(new Error("JPC: Could not connect to " + url));
    let timer = setTimeout(onFail, 2000); // localhost connects in ms; this only bounds a hang
    webSocket.addEventListener("open", onOpen);
    webSocket.addEventListener("close", onFail);
    webSocket.addEventListener("error", onFail);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function verifyClient(info, cb, protocolStr) {
  let origin = info.origin;
  const allowedOrigin =
    !origin || // Node client: no Origin header
    origin === "null" || // file:// pages in Chromium
    origin.startsWith("file://") || // Electron renderer in production
    origin === "http://localhost:5454" || // Vite renderer, prod
    origin === "http://localhost:5453" || // Vite renderer, dev
    origin === "https://localhost" || // Capacitor Android (androidScheme=https)
    origin === "capacitor://localhost"; // Capacitor iOS (iosScheme=capacitor)
  if (!allowedOrigin) {
    console.warn(`JPC: refused Origin ${origin}`);
    return cb(false, 403, `Forbidden: JPC: Wrong Origin ${origin}`);
  }
  if (info.req.headers["sec-websocket-protocol"] !== protocolStr) {
    console.warn(`JPC: Auth failed: Bad or missing secret.`);
    return cb(false, 403, `Forbidden: JPC: Bad or missing secret`);
  }
  cb(true);
}
