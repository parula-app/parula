import { RunOnce } from "../../../../logic/util/flow/RunOnce";
import { sleep, UserError } from '../../../../logic/util/util';
import { expect, test } from "vitest";

class WithRunOnce {
  ran = 0;
  runOnce = new RunOnce<string>();
  async run() {
    return await this.runOnce.runOnce(() => this.sayHi());
  }

  async sayHi() {
    await sleep(Math.random());
    this.ran += 1;
    return `Hi #${this.ran}`;
  }
}

class WithRunOnceError {
  ran = 0;
  runOnce = new RunOnce<void>();
  async run() {
    return await this.runOnce.runOnce(() => this.throwErr());
  }

  async throwErr() {
    await sleep(Math.random());
    this.ran += 1;
    throw new UserError(`Err #${this.ran}`);
  }
}

class WithoutRunOnce {
  ran = 0;
  runOnce = new RunOnce<string>();
  async run() {
    return await this.sayHi();
  }

  async sayHi() {
    await sleep(Math.random());
    this.ran += 1;
    return `Hi #${this.ran}`;
  }
}

class WithoutRunOnceError {
  ran = 0;
  runOnce = new RunOnce<void>();
  async run() {
    return await this.throwErr();
  }

  async throwErr() {
    await sleep(Math.random());
    this.ran += 1;
    throw new UserError(`Err #${this.ran}`);
  }
}

const kCalls = 5;

test("RunOnce", async () => {
  let a = new WithRunOnce();
  let promises = Array.from({ length: kCalls }, () => a.run());
  let results = await Promise.all(promises);
  expect(a.ran).toBe(1);
  expect(results.every(r => r == "Hi #1")).toBe(true);
});

test("Without RunOnce", async () => {
  let a = new WithoutRunOnce();
  let promises = Array.from({ length: kCalls }, () => a.run());
  let results = await Promise.all(promises);
  expect(a.ran).toBe(kCalls);
  for (let i = 1; i <= kCalls; i++) {
    expect(!!results.find(r => r == `Hi #${i}`)).toBe(true);
  }
});

test("RunOnce Error", async () => {
  let a = new WithRunOnceError();
  let promises = Array.from({ length: kCalls }, () => a.run());
  let results = await Promise.allSettled(promises) as PromiseRejectedResult[];
  expect(a.ran).toBe(1);
  for (let i = 0; i < kCalls; i++) {
    expect(results[i].reason.isUserError).toBe(true);
    expect(!!results.find(r => (r.reason as UserError).stack?.includes(`Promise.allSettled (index ${i})`))).toBe(true);
    expect(!!results.find(r => (r.reason as UserError).message.includes("Err #1"))).toBe(true);
  }
});

test("Without RunOnce Error", async () => {
  let a = new WithoutRunOnceError();
  let promises = Array.from({ length: kCalls }, () => a.run());
  let results = await Promise.allSettled(promises) as PromiseRejectedResult[];
  expect(a.ran).toBe(kCalls);
  for (let i = 0; i < kCalls; i++) {
    expect(results[i].reason.isUserError).toBe(true);
    expect(!!results.find(r => (r.reason as UserError).stack?.includes(`Promise.allSettled (index ${i})`))).toBe(true);
    expect(!!results.find(r => (r.reason as UserError).message.includes(`Err #${i + 1}`))).toBe(true);
  }
});
