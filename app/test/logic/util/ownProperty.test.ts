import { getOwnProperty, setOwnProperty } from "../../../logic/util/util";
import { expect, test } from "vitest";

test("getOwnProperty() returns only properties of the object itself", () => {
  // `JSON.parse()` makes `__proto__` an own property, like in a server response
  let json = JSON.parse(`{ "a": { "b": 1 }, "__proto__": { "c": 2 } }`);

  expect(getOwnProperty(json, "a")).toEqual({ b: 1 });
  expect(getOwnProperty(json, "__proto__")).toEqual({ c: 2 });
  expect(getOwnProperty({}, "__proto__")).toBeUndefined();
  expect(getOwnProperty({}, "constructor")).toBeUndefined();
  expect(getOwnProperty({}, "toString")).toBeUndefined();
  expect(getOwnProperty(null, "a")).toBeUndefined();
  expect(getOwnProperty("text" as any, "0")).toBeUndefined();
});

test("setOwnProperty() sets a property of the object itself", () => {
  let obj: Record<string, any> = {};

  let value = setOwnProperty(obj, "constructor", { a: 1 });

  expect(value).toEqual({ a: 1 });
  expect(Object.keys(obj)).toEqual(["constructor"]);
  expect(Object.getPrototypeOf(obj)).toBe(Object.prototype);
});

test("setOwnProperty() refuses the key `__proto__`", () => {
  let obj: Record<string, any> = {};

  expect(() => setOwnProperty(obj, "__proto__", { polluted: true })).toThrow();

  expect(Object.getPrototypeOf(obj)).toBe(Object.prototype);
  expect(Object.keys(obj)).toEqual([]);
  expect(obj.polluted).toBeUndefined();
});
