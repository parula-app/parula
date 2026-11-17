import { assert } from "./util.js";
import { Buffer } from "buffer";

/** @typedef {object} JSON */

function getClassName(obj) {
  let proto = Object.getPrototypeOf(obj);
  return (proto && (proto[Symbol.toStringTag] || proto.constructor.name)) || "Object";
}

function isPrivateProperty(propName) {
  return propName.startsWith("_") || propName == "constructor";
}

// This is only set as a function on classes that are known to be observers
// @param this {RemoteClass}
// @param subscriber {function(self {RemoteClass})}
function subscribe(subscriber) {
  subscriber(this);
  if (!this._subscribers) {
    this._subscribers = new Set();
  }
  this._subscribers.add(subscriber);
  return () => this._subscribers.delete(subscriber);
}

class RemoteClass {
  constructor(className) {
    this.className = className;
    /** @type {Set<function(RemoteClass): void> | undefined} */
    this._subscribers;
    /** @type string */
    this._jpc_id;
  }
  _notifySubscribers() {
    if (this._subscribers) {
      for (let subscriber of this._subscribers) {
        try {
          subscriber(this);
        } catch (ex) {
          console.error(ex);
          this._subscribers.delete(subscriber);
        }
      }
    }
  }
}

/** A function of an object, as opposed to one of its property values.
 * The remote end will call it on that same object. */
class MethodReference {
  constructor(methodName) {
    this.methodName = methodName;
  }
}

class IncomingContext {
  /** @type Map<number, object> */
  plainObjects = new Map();
  /** @type Map<string, object> */
  stubs = new Map();
}

class OutgoingContext {
  count = 0;
  /** @type Map(object, object) */
  plainObjects = new Map();
  /** @type Map(object, string) */
  localObjects = new Map();
}

export default class BaseProtocol {
  /**
   * @param method {string}
   * @param [payload] {any}
   * @returns {Promise<any>}
   */
  callRemote(method, payload) {
    throw new Error("Implement this");
  }
  registerIncomingCall(method, listener) {
    throw new Error("Implement this");
  }
  /**
   * Called by the wire protocol implementation,
   * before calling any of the other functions.
   *
   * @param startObject {any}
   */
  start(startObject) {
    this.registerIncomingCall("class", this.getClassDescription.bind(this));
    this.registerIncomingCall("start", this.mapOutgoingObjects.bind(this, startObject));
    this.registerIncomingCall("new", this.newObjListener.bind(this));
    this.registerIncomingCall("call", this.callListener.bind(this));
    this.registerIncomingCall("iter", this.iterListener.bind(this));
    this.registerIncomingCall("func", this.funcListener.bind(this));
    this.registerIncomingCall("get", this.getterListener.bind(this));
    this.registerIncomingCall("set", this.setterListener.bind(this));
    this.registerIncomingCall("notify", this.notifyListener.bind(this));
    this.registerIncomingCall("refresh", this.refreshListener.bind(this));
    this.registerIncomingCall("del", payload => {
      this.deleteLocalObject(payload.idRecipient);
    });
    if (globalThis && "FinalizationRegistry" in globalThis) {
      this._localObjectRegistry = new FinalizationRegistry(id => {
        this._localIDsToObjects.delete(id);
      });
      this._remoteObjectRegistry = new FinalizationRegistry(id => {
        this._remoteObjects.delete(id);
        this.callRemote("del", {
          idRecipient: id,
        }).catch(console.error);
      });
      // TODO Free everything when client disconnects
      // See <https://github.com/tc39/proposal-weakrefs/blob/master/reference.md#notes-on-cleanup-callbacks>
      // and <https://github.com/tc39/proposal-weakrefs/issues/125>
    } else { // not supported, use dummy
      console.warn("FinalizationRegistry is not supported. This will leak everything. Please update node.js.");
      this._localObjectRegistry = {
        register: () => { },
      };
      this._remoteObjectRegistry = {
        register: () => { },
      };
    }
  }

  ///////////////////////////////////////////
  // Stub object
  // A local JS object representing a remote object

  /**
   * { Map className {string} -> prototype object {obj} }
   */
  _remoteClasses = new Map();

  /**
   * Generates a stub class
   *
   * @param classDescrJSON {JSON} Describes the remote class, see PROTOCOL.md
   * @param parent {RemoteClass?} The class this class inherits from
   */
  registerRemoteClass(classDescrJSON, parent) {
    let existing = this._remoteClasses.get(classDescrJSON.className);
    if (existing) {
      return existing;
    }

    let proto;
    if (parent) {
      proto = Object.create(parent);
      proto.className = classDescrJSON.className;
    } else {
      proto = new RemoteClass(classDescrJSON.className);
    }
    if (classDescrJSON.iterator) {
      proto[Symbol.asyncIterator] = this.makeIterator(classDescrJSON.iterator);
    }
    if (classDescrJSON.observable) {
      proto.subscribe = subscribe;
    }
    for (let func of classDescrJSON.functions) {
      proto[func.name] = this.makeFunction(func.name);
    }
    for (let getter of classDescrJSON.getters) {
      Object.defineProperty(proto, getter.name, {
        enumerable: true,
        get: this.makeGetter(getter.name),
      });
      if (getter.hasSetter) {
        let setterName = "set" + getter.name[0].toUpperCase() + getter.name.substr(1);
        proto[setterName] = this.makeSetter(getter.name);
      }
    }
    proto.newRemote = this.makeNewObj(classDescrJSON.className); // TODO static function
    this._remoteClasses.set(classDescrJSON.className, proto);
    return proto;
  }

  async promiseRemoteClass(objDescrJSON) {
    let classDescrJSON = await this.callRemote("class", {
      className: objDescrJSON.className,
    });
    let proto = null;
    for (let descr of classDescrJSON) {
      if (descr.className == objDescrJSON.className) {
        this._remoteClasses.delete(objDescrJSON.className);
      }
      proto = this.registerRemoteClass(descr, proto);
      if (proto instanceof Promise) {
        proto = await proto;
      }
    }
    return proto;
  }

  /**
   * Generates a stub object instance
   *
   * @param objDescrJSON {JSON} Describes the remote object, see PROTOCOL.md
   * @returns {Promise<RemoteClass>}
   */
  async makeStub(objDescrJSON, context = new IncomingContext()) {
    let proto = this._remoteClasses.get(objDescrJSON.className);
    if (!proto) {
      proto = this.promiseRemoteClass(objDescrJSON);
      this._remoteClasses.set(objDescrJSON.className, proto);
    }
    if (proto instanceof Promise) {
      proto = await proto;
    }
    let stub = Object.create(proto);
    context.stubs.set(objDescrJSON.idSender, stub);
    stub._jpc_id = objDescrJSON.idSender;
    stub.__refresh = this.makeRefresh();
    this.updateObjectProperties(stub, await this.mapIncomingObjects(objDescrJSON.properties, context));
    // Timing issue: This needs to happen after the caller sets the
    // Promise it gets from calling us into the remote object map.
    this.addRemoteObject(objDescrJSON.idSender, stub);

    return stub;
  }

  updateObjectProperties(obj, properties) {
    for (let propName in properties) {
      Object.defineProperty(obj, propName, {
        configurable: true,
        enumerable: true,
        writable: false,
        value: properties[propName],
      });
    }
  }

  makeCallable(id) {
    return async (...args) => {
      return await this.mapIncomingObjects(await this.callRemote("call", {
        obj: id,
        args: this.mapOutgoingObjects(args),
      }));
    }
  }

  makeIterator(symbolName) {
    let self = this;
    return /** @this {RemoteClass} */ async function* () {
      let remote = await self.mapIncomingObjects(await self.callRemote("iter", {
        obj: this._jpc_id,
        symbol: symbolName,
      }));
      // This object will probably be an iterable iterator,
      // but we don't want to remote that call.
      Object.getPrototypeOf(remote)[Symbol.asyncIterator] = function () { return this; };
      for await (let value of remote) {
        yield value;
      }
    }
  }

  makeFunction(functionName) {
    let self = this;
    return /** @this {RemoteClass} */ async function (...args) {
      // this == stub object
      return await self.mapIncomingObjects(await self.callRemote("func", {
        obj: this._jpc_id,
        name: functionName,
        args: self.mapOutgoingObjects(args),
      }));
    }
  }

  makeGetter(propName) {
    let self = this;
    return /** @this {RemoteClass} */ async function () {
      // this == stub object
      return await self.mapIncomingObjects(await self.callRemote("get", {
        obj: this._jpc_id,
        name: propName,
      }));
    }
  }

  makeSetter(propName) {
    let self = this;
    return /** @this {RemoteClass} */ async function (val) {
      // this == stub object
      return self.callRemote("set", {
        obj: this._jpc_id,
        name: propName,
        value: self.mapOutgoingObjects(val),
      });
    }
  }

  makeNewObj(className) {
    let self = this;
    return async function (...args) {
      // this == stub object
      return await self.mapIncomingObjects(await self.callRemote("new", {
        className: className,
        args: self.mapOutgoingObjects(args),
      }));
    }
  }

  makeRefresh() {
    let self = this;
    return /** @this {RemoteClass} */ async function() {
      // this == stub object
      let props = await self.callRemote("refresh", { obj: this._jpc_id });
      await self.updateObjectProperties(this, await self.mapIncomingObjects(props));
      return this;
    }
  }

  /**
   * @param value {any} string, number, boolean,
   *   array, JSON obj,
   *   Object description or Object references, as defined by PROTOCOL.md
   * @return {any | Promise<any>} same as value, just Object descriptions and Object references
   *   replaced with `StubObject`s.
   *   A Promise only if it needs to wait for a stub, so that plain data doesn't wait once per value.
   */
  mapIncomingObjects(value, context = new IncomingContext()) {
    if (typeof (value) == "string" ||
      typeof (value) == "number" ||
      typeof (value) == "boolean" ||
      value == null) {
      return value;
    } else if (Array.isArray(value)) {
      let array = value.map(el => this.mapIncomingObjects(el, context));
      return array.some(el => el instanceof Promise) ? Promise.all(array) : array;
    } else if (typeof (value) == "object") {
      let obj = value;
      if (obj.bigint) {
        return BigInt(obj.bigint);
      } else if (obj.date) {
        return new Date(obj.date);
      } else if (obj.jsSet) {
        return new Set(obj.jsSet);
      } else if (obj.nodeBuffer) {
        return Buffer.from(obj.nodeBuffer);
      } else if (obj.uint8array) {
        return new Uint8Array(obj.uint8array);
      } else if (obj.idSender) {
        let stub = context.stubs.get(obj.idSender) || this.getRemoteObject(obj.idSender);
        if (stub) {
          return stub;
        }
        if (obj.className == "Function") {
          let stub = this.makeCallable(obj.idSender);
          this.addRemoteObject(obj.idSender, stub);
          return stub;
        }
        let promise = this.makeStub(obj, context);
        this._remoteObjects.set(obj.idSender, promise);
        return promise;
      } else if (obj.idRecipient) {
        return this.getLocalObject(obj.idRecipient);
      } else if (obj.methodName) {
        return this.makeFunction(obj.methodName);
      } else if (obj.plainObject) {
        let plainObject = {};
        let isWaiting = false;
        for (let propName in obj.plainObject) {
          plainObject[propName] = this.mapIncomingObjects(obj.plainObject[propName], context);
          isWaiting ||= plainObject[propName] instanceof Promise;
        }
        if (obj.idMap) {
          context.plainObjects.set(obj.idMap, plainObject);
        }
        return isWaiting ? resolveProperties(plainObject) : plainObject;
      } else if (obj.idMap) {
        return context.plainObjects.get(obj.idMap);
      }
    }
  }


  ///////////////////////////////////////////
  // Local object
  // Passing a normal local JS object to the remote side

  async newObjListener(payload) {
    assert(typeof (payload.className) == "string", "Need class name");
    let classCtor = global[payload.className];
    let obj;
    let args = payload.args;
    if (typeof (args) == "undefined") {
      obj = classCtor();
    } else {
      assert(Array.isArray(args), "Constructor arguments must be an array of values");
      args = await this.mapIncomingObjects(args);
      obj = classCtor(...args);
    }

    return this.createObjectDescription(obj, this.getOrCreateIDForLocalObject(obj));
  }

  async callListener(payload) {
    assert(typeof (payload.obj) == "string", "Need object ID");
    let func = this.getLocalObject(payload.obj);
    let args = await this.mapIncomingObjects(payload.args);

    // may throw
    let result = func(...args);

    if (result instanceof Promise) {
      result = await result;
    }

    try {
      return this.mapOutgoingObjects(result);
    } catch (ex) {
      console.log("mapOutgoingObjects() failed for result");
      console.log(result);
      throw ex;
    }
  }

  async iterListener(payload) {
    let symbol = payload.symbol;
    assert(typeof (symbol) == "string", "Need symbol name");
    assert(typeof (payload.obj) == "string", "Need object ID");
    let obj = this.getLocalObject(payload.obj);

    // may throw
    let result = obj[Symbol[symbol]]();

    return this.mapOutgoingObjects(result);
  }

  async funcListener(payload) {
    let name = payload.name;
    assert(typeof (name) == "string", "Need function name");
    assert(typeof (payload.obj) == "string", "Need object ID");
    let obj = this.getLocalObject(payload.obj);
    let args = await this.mapIncomingObjects(payload.args);

    // may throw
    let result = obj[name](...args);

    if (result instanceof Promise) {
      result = await result;
    }

    try {
      return this.mapOutgoingObjects(result);
    } catch (ex) {
      console.log("mapOutgoingObjects() failed for result");
      console.log(result);
      throw ex;
    }
  }

  async getterListener(payload) {
    let name = payload.name;
    assert(typeof (name) == "string", "Need property getter name");
    assert(typeof (payload.obj) == "string", "Need object ID");
    let obj = this.getLocalObject(payload.obj);

    // may throw
    let value = obj[name];

    return this.mapOutgoingObjects(value);
  }

  async setterListener(payload) {
    let name = payload.name;
    assert(typeof (name) == "string", "Need property setter name");
    assert(typeof (payload.obj) == "string", "Need object ID");
    let obj = this.getLocalObject(payload.obj);
    let value = await this.mapIncomingObjects(payload.value);

    // may throw
    obj[payload.name] = value;
  }

  async notifyListener(objDescrJSON) {
    /* We get the first notification for the object when we subscribe to it;
      this happens when we first encounter the object on the server.
      At this point the remote stub does not yet exist on the client,
      since we have not yet sent the object description to the client.
      The subscription callback doesn't know that because the object already
      has a local id by this point, since we need that id in order to establish
      the subscription without creating a reference loop. */
    let obj = this.getRemoteObject(objDescrJSON.idSender);
    if (obj) {
      if (obj instanceof Promise) {
        obj = /** @type {RemoteClass} */(await obj);
      }
      this.updateObjectProperties(obj, await this.mapIncomingObjects(objDescrJSON.properties));
      obj._notifySubscribers();
    } else {
      let promise = this.makeStub(objDescrJSON); // also fills properties
      this._remoteObjects.set(objDescrJSON.idSender, promise);
    }
  }

  async refreshListener(payload) {
    let props = {};
    let obj = this.getLocalObject(payload.obj);

    for (let propName of Object.getOwnPropertyNames(obj)) {
      if (isPrivateProperty(propName)) {
        continue;
      }
      let property = Object.getOwnPropertyDescriptor(obj, propName);
      if (property.get) {
        continue;
      }

      if (typeof property.value != "function") {
        props[propName] = property.value;
      }
    }

    return this.mapOutgoingObjects(props);
  }

  /**
   * @param value {any} string, number, boolean,
   *   array, JSON obj, or
   *   local JS object
   * @return {any} same as value, just local objects replaced with
   *   Object descriptions and Object references, as defined by PROTOCOL.md
   */
  mapOutgoingObjects(value, context = new OutgoingContext()) {
    if (typeof (value) == "string" ||
      typeof (value) == "number" ||
      typeof (value) == "boolean" ||
      value == null) {
      return value;
    } else if (typeof (value) == "bigint") {
      return {
        bigint: String(value),
      };
    } else if (Array.isArray(value)) {
      return value.map(el => this.mapOutgoingObjects(el, context));
    } else if (typeof (value) == "function") {
      return {
        idSender: this.getOrCreateIDForLocalObject(value),
        className: "Function",
      };
    } else if (typeof (value) == "object") {
      let obj = value;
      if (obj instanceof Date) {
        return {
          date: obj.getTime(),
        };
      }
      if (obj instanceof Set) {
        let elements = [];
        for (let el of obj.values()) {
          elements.push(el);
        }
        return {
          jsSet: elements,
        };
      }
      if (isBuffer(obj)) {
        return {
          nodeBuffer: Array.from(obj),
        };
      }
      if (obj instanceof ArrayBuffer) {
        obj = new Uint8Array(obj);
      }
      if (obj instanceof Uint8Array) {
        return {
          uint8array: Array.from(obj), // TODO inefficient
        };
      }
      if (obj instanceof RemoteClass) {
        return { // Object reference for remote object
          idRecipient: obj._jpc_id,
        };
      }
      if (obj instanceof MethodReference) {
        return {
          methodName: obj.methodName,
        };
      }

      if (getClassName(obj) == "Object") { // JSON object -- TODO better way to check?
        if (context.plainObjects.has(obj)) {
          return {
            idMap: context.plainObjects.get(obj).idMap ||= ++context.count,
          };
        }
        let plainObject = {};
        for (let propName in obj) {
          plainObject[propName] = this.mapOutgoingObjects(obj[propName], context);
        }
        let value = {
          plainObject: plainObject,
        };
        context.plainObjects.set(obj, value);
        return value;
      }

      let id = context.localObjects.get(obj);
      if (id) {
        return { idSender: id };
      }
      id = this.getOrCreateIDForLocalObject(obj);
      context.localObjects.set(obj, id);
      return this.createObjectDescription(obj, id, context);
    }
  }


  /**
   * Notifies the remote end when an observable updates itself.
   */
  observe(id) {
    let props = {};
    let obj = this.getLocalObject(id);
    let proto = obj;
    while (proto) { // should always succeed; loop normally exits by break
      for (let propName of Object.getOwnPropertyNames(proto)) {
        if (isPrivateProperty(propName) || propName in props) {
          continue;
        }

        let value = obj[propName];
        if (typeof value == "function") {
          continue;
        }

        props[propName] = value;
      }

      if (getClassName(proto) == "Object") {
        break;
      }
      proto = Object.getPrototypeOf(proto);
    }

    this.callRemote("notify", {
      idSender: id,
      className: getClassName(obj),
      properties: this.mapOutgoingObjects(props),
    }).catch(console.error);
  }

  /**
   * Return an object instance to the remote party that they did not see yet.
   *
   * @param obj {object} local object
   * @returns {JSON} Object description, see PROTOCOL.md
   */
  createObjectDescription(obj, id, context = new OutgoingContext()) {
    let className = getClassName(obj);
    assert(className, "Could not find class name for local object");

    let props = {};
    if (typeof Object.getPrototypeOf(obj).subscribe == "function") {
      obj.subscribe(this.observe.bind(this, id));
    } else {
      for (let propName of Object.getOwnPropertyNames(obj)) {
        if (isPrivateProperty(propName)) {
          continue;
        }
        let property = Object.getOwnPropertyDescriptor(obj, propName);
        if (property.get) {
          continue;
        }
        if (typeof property.value == "function") {
          props[propName] = new MethodReference(propName);
          continue;
        }

        props[propName] = obj[propName];
      }
    }

    return {
      idSender: id,
      className: className,
      properties: this.mapOutgoingObjects(props, context),
    };
  }

  getClassDescription({ className }) {
    let classDescrJSON = [];
    let proto = this._localClasses.get(className);
    while (proto) { // should always succeed; loop normally exits by break
      let descr = {
        className: className,
        iterator: null,
        observable: false,
        functions: [],
        getters: [],
        properties: [],
      };

      if (Symbol.asyncIterator in proto) {
        descr.iterator = "asyncIterator";
      } else if (Symbol.iterator in proto) {
        descr.iterator = "iterator";
      }
      for (let propName of Object.getOwnPropertyNames(proto)) {
        if (isPrivateProperty(propName)) {
          continue;
        }
        let property = Object.getOwnPropertyDescriptor(proto, propName);
        if (typeof (property.value) == "function") {
          if (propName == "subscribe") {
            descr.observable = true;
          } else {
            descr.functions.push({
              name: propName,
            });
          }
          continue;
        }
        if (typeof (property.get) == "function") {
          descr.getters.push({
            name: propName,
            hasSetter: typeof (property.set) == "function",
          });
          continue;
        }
        descr.properties.push({
          name: propName,
        });
      }

      classDescrJSON.unshift(descr);

      className = getClassName(proto);
      if (className == "Object") {
        break;
      }
      proto = Object.getPrototypeOf(proto);
    }

    return classDescrJSON;
  }


  ///////////////////////////////////////////////
  // ID to objects

  /**
   * {Map ID {string} -> remoteObject {WeakRef<StubObject>} }
   */
  _remoteObjects = new Map();
  /**
   * {Map ID {string} -> localObject {obj | WeakRef<obj>} }
   */
  _localIDsToObjects = new Map();
  /**
   * {WeakMap localObj {obj} -> ID {string} }
   */
  _localObjectsToIDs = new WeakMap();
  /**
   * {Map name {string} -> class {Prototype}
   */
  _localClasses = new Map();
  /**
   * {Map localObj {obj} -> ID {string} }
   */
  _recursiveObjects = new Map();

  generateNewObjID() {
    let id;
    do {
      id = (Math.random() * 1e20).toFixed();
    } while (this._localIDsToObjects.has(id));
    return id;
  }

  /**
   * @param id {string} ID of object refererence
   * @returns {Promise|RemoteClass?} remote object
   */
  getRemoteObject(id) {
    let ref = this._remoteObjects.get(id);
    if (ref instanceof Promise) {
      return ref;
    }
    return ref && ref.deref();
  }

  /**
   * @param id {string} ID of object refererence
   * @returns {obj} local object
   */
  getLocalObject(id) {
    let obj = this._localIDsToObjects.get(id);
    assert(obj, `Local object with ID ${id} is unknown here.`);
    if (obj instanceof WeakRef) {
      obj = obj.deref();
      assert(obj, `Local object with ID ${id} is unknown here.`);
      this._localIDsToObjects.set(id, obj);
    }
    return obj;
  }

  /**
   * @param obj {Object} Local object
   * @returns {string} ID
   */
  getOrCreateIDForLocalObject(obj) {
    let id = this._localObjectsToIDs.get(obj);
    if (!id) {
      id = this.generateNewObjID();
      this._localObjectsToIDs.set(obj, id);
      this._localObjectRegistry.register(obj, id);
      this._localClasses.set(getClassName(obj), Object.getPrototypeOf(obj));
    }
    this._localIDsToObjects.set(id, obj);
    return id;
  }

  /**
   * @param id {string} ID for remote object, as set by the remote side
   * @param obj {RemoteClass | function} Remote object
   */
  addRemoteObject(id, obj) {
    let existing = this.getRemoteObject(id);
    assert(!(existing instanceof WeakRef), `Remote object ID ${id} already exists.`);
    this._remoteObjects.set(id, new WeakRef(obj));
    this._remoteObjectRegistry.register(obj, id);
  }

  /**
   * Remote side says that it no longer needs this object.
   * Drop the reference to it.
   * @param id {string} ID of object refererence
   */
  deleteLocalObject(id) {
    let obj = this._localIDsToObjects.get(id);
    assert(obj, `Local object with ID ${id} is unknown here.`);
    if (obj instanceof WeakRef) {
      return;
    }
    // Keep weak references in case the object gets promoted again
    this._localIDsToObjects.set(id, new WeakRef(obj));
  }

  _localObjectRegistry = null;

  _remoteObjectRegistry = null;
}

/** Replaces the Promises in the properties with their values */
async function resolveProperties(obj) {
  for (let propName in obj) {
    if (obj[propName] instanceof Promise) {
      obj[propName] = await obj[propName];
    }
  }
  return obj;
}

function isBuffer(obj) {
  return obj?.constructor?.isBuffer &&
    typeof (obj.constructor.isBuffer) == "function" &&
    obj.constructor.isBuffer(obj);
}
