import { addon, addonHook } from '../../../../logic/Addons/API/addon';
import { Observable, notifyChangedProperty, notifyChangedAccessor } from '../../../../logic/util/Observable';
import { expect, test } from 'vitest';

@addon("mail")
class Annotated extends Observable {
  @addon("message")
  @notifyChangedProperty
  above = "above";

  @notifyChangedProperty
  @addon("message", "mail.compose")
  below = "below";

  @addon(["mail.all", "chat.all"])
  plain = "plain";

  _accessor = "accessor";
  @addon("message", "mail.compose")
  @notifyChangedAccessor
  get accessor(): string {
    return this._accessor;
  }
  set accessor(value: string) {
    this._accessor = value;
  }

  _reversed = "reversed";
  @notifyChangedAccessor
  @addon("message")
  get reversed(): string {
    return this._reversed;
  }
  set reversed(value: string) {
    this._reversed = value;
  }

  @addon("mail")
  add(a: number, b: number): number {
    return a + b + this.plain.length;
  }

  @addonHook("test.double", "mail")
  async double(value: number): Promise<number> {
    return value * 2;
  }
}

test("@addon keeps the class", () => {
  let annotated = new Annotated();
  expect(annotated).toBeInstanceOf(Annotated);
  expect(annotated).toBeInstanceOf(Observable);
  expect(annotated.plain).toBe("plain");
  annotated.plain = "changed";
  expect(annotated.plain).toBe("changed");
});

test("@addon stacks with @notifyChangedProperty and @notifyChangedAccessor in both orders", () => {
  let annotated = new Annotated();
  let changes: string[] = [];
  annotated.subscribe((_obj, property) => {
    if (property) {
      changes.push(property);
    }
  });
  annotated.above = "above 2";
  annotated.below = "below 2";
  annotated.accessor = "accessor 2";
  annotated.reversed = "reversed 2";
  expect(changes).toEqual(["above", "below", "accessor", "reversed"]);
  expect(annotated.above).toBe("above 2");
  expect(annotated.below).toBe("below 2");
  expect(annotated.accessor).toBe("accessor 2");
  expect(annotated.reversed).toBe("reversed 2");
});

test("@addon and @addonHook keep the methods", async () => {
  let annotated = new Annotated();
  expect(annotated.add(1, 2)).toBe(8);
  expect(await annotated.double(21)).toBe(42);
});

test("@addon and @addonHook add nothing at runtime", () => {
  // Fields stay plain properties of the object, without accessor on the prototype
  expect(Object.getOwnPropertyDescriptor(Annotated.prototype, "plain")).toBeUndefined();
  expect(Object.getOwnPropertyDescriptor(new Annotated(), "plain")).toMatchObject({ value: "plain", writable: true });
  // Methods stay the original functions, without wrapper
  for (let [name, body] of [["add", "a + b + this.plain.length"], ["double", "value * 2"]]) {
    let descriptor = Object.getOwnPropertyDescriptor(Annotated.prototype, name);
    expect(descriptor.get).toBeUndefined();
    expect(descriptor.value.name).toBe(name);
    expect(descriptor.value.toString()).toContain(body);
  }
});
