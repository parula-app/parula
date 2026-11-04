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

test("setOwnProperty() with the key `__proto__` changes no prototype", () => {
  let obj: Record<string, any> = {};

  let value = setOwnProperty(obj, "__proto__", { polluted: true });

  expect(value).toEqual({ polluted: true });
  expect(Object.getPrototypeOf(obj)).toBe(Object.prototype);
  expect(obj.polluted).toBeUndefined();
  expect(Object.keys(obj)).toEqual(["__proto__"]);
  expect(JSON.stringify(obj)).toBe(`{"__proto__":{"polluted":true}}`);
});
