import { ColumnOrder } from "../../../Shared/ViewSettings/ColumnOrder";
import { expect, test } from "vitest";

const kAll = ["name", "company", "phone", "fax", "mobile", "city"];

test("Unknown and duplicate columns are dropped, the required column is always shown", () => {
  let order = new ColumnOrder(["company", "unknown", "company", "phone"], kAll, "name");
  expect(order.columns).toEqual(["name", "company", "phone"]);
  expect(order.available()).toEqual(["fax", "mobile", "city"]);
});

test("Remove a column, but not the required one", () => {
  let order = new ColumnOrder(["name", "company", "phone", "fax", "mobile"], kAll, "name");
  order.remove("fax");
  expect(order.columns).not.toContain("fax");
  order.remove("name");
  expect(order.columns[0]).toBe("name");
});

test("Move a column before another one, or to the end", () => {
  let order = new ColumnOrder(["name", "company", "phone", "fax", "mobile"], kAll, "name");
  order.moveBefore("mobile", "company");
  expect(order.columns.slice(0, 3)).toEqual(["name", "mobile", "company"]);
  order.moveBefore("name", null);
  expect(order.columns.at(-1)).toBe("name");
});

test("Add a column after another one, move by offset", () => {
  let order = new ColumnOrder(["name", "phone"], kAll, "name");
  order.add("city", "name");
  expect(order.columns).toEqual(["name", "city", "phone"]);
  expect(order.canMove("name", -1)).toBe(false);
  order.move("phone", -1);
  expect(order.columns).toEqual(["name", "phone", "city"]);
});
