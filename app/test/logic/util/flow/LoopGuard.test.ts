import { LoopGuard } from '../../../../logic/util/flow/LoopGuard';
import { expect, test } from 'vitest';

/** Runs a loop like a paging loop against a server.
 * @param maxRounds for the guard
 * @param pages What the server returns in each round, as progress. The loop ends normally after the last page.
 * @returns how many rounds ran, and how often the guard reported */
function runLoop(maxRounds: number, pages: string[]) {
  let stops = 0;
  let rounds = 0;
  let loop = new LoopGuard(maxRounds, () => stops++);
  while (loop.nextRound()) {
    let page = pages[rounds];
    rounds++;
    if (loop.isSameAsLastRound(page)) {
      break;
    }
    if (rounds == pages.length) {
      break;
    }
  }
  return { rounds, stops };
}

test("A loop that ends by itself runs all its rounds, and nothing is reported", () => {
  let { rounds, stops } = runLoop(10, ["a", "b", "c"]);
  expect(rounds).toBe(3);
  expect(stops).toBe(0);
});

test("A loop may use all its rounds", () => {
  let { rounds, stops } = runLoop(3, ["a", "b", "c"]);
  expect(rounds).toBe(3);
  expect(stops).toBe(0);
});

test("A loop stops after the maximum number of rounds, and reports it once", () => {
  let pages = Array.from({ length: 100 }, (_dummy, i) => "page" + i);
  let { rounds, stops } = runLoop(5, pages);
  expect(rounds).toBe(5);
  expect(stops).toBe(1);
});

test("A loop stops when a round got the same as the round before, and reports it once", () => {
  let { rounds, stops } = runLoop(1000, ["a", "b", "b", "c", "d"]);
  expect(rounds).toBe(3);
  expect(stops).toBe(1);
});

test("An empty page as progress is compared like any other", () => {
  let { rounds, stops } = runLoop(1000, ["", "", "a"]);
  expect(rounds).toBe(2);
  expect(stops).toBe(1);
});

test("The report may throw, to end the loop with an exception", () => {
  let loop = new LoopGuard(2, () => {
    throw new Error("The server keeps asking. Stopped.");
  });
  expect(loop.nextRound()).toBe(true);
  expect(loop.nextRound()).toBe(true);
  expect(() => loop.nextRound()).toThrow(/keeps asking/);
});
