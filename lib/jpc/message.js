import { assert, consoleError } from "./util.js";

/** @typedef {object} JSON */

/**
 * Abstract base implementation for protocols.
 *
 * Creates a very thin generic wrapper around any messaging passing system
 * and allows to make request/response function calls over it.
 *
 * It implements:
 * - The notion of paths to call a specific function on the other end
 * - The notion of a response to a call, or an exception
 * - async waiting for the response
 *
 * To expose a function, you `register()` it,
 * which allows the other side to call it.
 * To call a function on the other side, you use `await makeCall()`.
 *
 * E.g. server:
 * register("/user", arg => {
 *   if (!name) {
 *     throw new Error("I don't know what you're talking about");
 *   }
 *   return "I've seen " + arg.name + " before, yes";
 * })
 * client:
 * let result = await makeCall("/user", { name: "Fred" });
 * result == "I've seen Fred before, yes";
 * whereas:
 * await makeCall("/user", { license: "4" });
 * throws an exception with .message == "I don't know what you're talking about";
 */
export default class MessageCall  {
  constructor() {
    /**
     * Obj map ID {string} ->
     */
    this._functions = {};

    /**
     * Obj map ID {string} -> {
     *   resolve {function(result)} called when the function succeeded
     *   reject {function(ex)}  called when the function had an error or exception on the other end
     * }
     */
    this._callsWaiting = {};

    this._lastID = 0;

    // Subclasses: call `this._incomingMessage(messageStr)` when new messages arrive.
  }

  /**
   * @param message {JSON}
   */
  send(message) {
    throw new Error("Implement this");
  }

  /**
   * @param path {string}  URL relative to the root, e.g. "/app/user"
   * @param func {function(object): Promise} will be called when the path is invoked
   *   arg {object} parameter from the caller
   *   Whatever the function returns will be sent back to the caller.
   *   If the function throws, the error .message {string} and .code {string} will
   *   be sent to the caller as exception.
   */
  register(path, func) {
    assert(path && typeof(path) == "string");
    assert(typeof(func) == "function");
    this._functions[path] = func;
  }

  /**
   * @param message {JSON | string}
   */
  async _incomingMessage(message) {
    try {
      if (typeof(message) == "string") {
        message = /** @type {JSON} */(JSON.parse(message));
      }
    } catch (ex) {
      return;
    }
    if (typeof(message.id) != "number" || !(typeof(message.path) == "string" || typeof(message.success) == "boolean")) {
      return; // not for us
    }
    try {
      if (typeof(message.success) == "boolean") {
        // We called a function on the other side, and they responded
        this._response(message);
        return;
      }
      // The other side is calling a function here
      let func = this._functions[message.path];
      assert(func, "404 " + message.path + ": No such function registered");
      let result = await func(message.arg);
      this.send({
        id: message.id,
        success: true,
        result: result,
      });
    } catch (ex) {
      let exSerialized;
      try {
        // Can throw while serializing error object - e.g. issuerCertificate cyclic reference when configuring foo@yahoo.com.au
        exSerialized = JSON.parse(JSON.stringify(ex));
      } catch (ex) {
      }
      try {
        // Error in function called by remote side
        // console.error(`Error, in function on our side, called by remote side. Function ${message.path}, args ${message.arg || 'none'}, function ${this._functions[message.path]}`);
        // consoleError(ex);
        this.send({
          ...exSerialized, // ex also has `.id` property, so add it first, and let our function `id:` below overwrite it.
          id: message.id,
          success: false,
          message: ex.message,
          code: ex.code,
          backendStack: ex.stack,
          originalCall: message,
        });
      } catch (exInEx) {
        try {
          this.send({
            id: message.id,
            success: false,
            message: "Error while trying to report error",
          });
        } catch (ex) {
          console.error(ex);
        }
      }
    }
  }

  /**
   * Calls a function on other side
   * @param path {string}   like the path component of a HTTP URL.
   *    E.g. "/contact/call/" or "register".
   *    Must match the registration on the other side exactly, including leading slash or not.
   * @param arg {JSON}   arguments for the function call
   * @returns {Promise} waits until the call returns with a result or Exception
   */
  async makeCall(path, arg) {
    assert(path && typeof(path) == "string");
    assert(!arg || typeof(arg) == "object");

    return new Promise((resolve, reject) => {
      let id = this._generateID();
      this._callsWaiting[id] = {
        resolve: resolve,
        reject: reject,
        stack: new Error().stack,
      };
      this.send({
        id: id,
        path: path,
        arg: arg,
      });
      // message will be processed on the other side
      // then they will send us a response with message.result
    });
  }

  _response(message) {
    assert(typeof(message.success) == "boolean");
    let callWaiting = this._callsWaiting[message.id];
    delete this._callsWaiting[message.id];
    assert(callWaiting, "Got a response for call ID " + message.id + ", but we did not make such a call, or we already got the response for it");
    if (message.success) {
      callWaiting.resolve(message.result);
    } else {
      let ex = new Error();
      Object.assign(ex, message);
      ex.stack = callWaiting.stack;
      callWaiting.reject(ex);
    }
  }

  /**
   * Reject every outstanding `makeCall()` promise.
   * Called when the underlying transport (e.g. WebSocket) is closed
   * or errors out, so callers see an error instead of awaiting forever.
   * @param reason {string}
   */
  _rejectAllPendingCalls(reason) {
    let pending = this._callsWaiting;
    this._callsWaiting = {};
    for (let id in pending) {
      let callWaiting = pending[id];
      let ex = new Error(reason || "Connection to backend was lost");
      ex.code = "ConnectionClosed";
      ex.stack = callWaiting.stack;
      try {
        callWaiting.reject(ex);
      } catch (exInReject) {
        console.error(exInReject);
      }
    }
  }

  _generateID() {
    return this._lastID++;
  }
}
