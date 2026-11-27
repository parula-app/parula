// app first, to resolve the import cycle around Addons
import "../../../logic/app";
import { AddonConnection } from "../../../logic/Addons/AddonConnection";
import type { AddonProtocolAccount } from "../../../logic/Addons/AddonProtocols";
import type { Account } from "../../../logic/Abstract/Account";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

/** A connection whose addon answers each list call with `answer()`
 * @param answer Gets the sync state that the app sent */
function newConnection(answer: (syncState: string | null) => object) {
  let errors: Error[] = [];
  let account = { name: "Test", protocol: "addon-test", errorCallback: (ex: Error) => errors.push(ex) } as unknown as Account & AddonProtocolAccount;
  let connection = new AddonConnection(account, new ArrayColl<Account>());
  let sentStates: (string | null)[] = [];
  connection.call = async (_operation: string, ...args: unknown[]) => {
    let syncState = args[args.length - 1] as string | null;
    sentStates.push(syncState);
    return answer(syncState);
  };
  return { connection, errors, sentStates };
}

test("The first sync, without a sync state, gets all chunks until the addon has no more", async () => {
  let { connection, errors, sentStates } = newConnection(syncState =>
    ({ events: [], syncState: String(Number(syncState ?? 0) + 1), hasMore: syncState != "2" }));
  let chunkStates: string[] = [];

  await connection.listChanges("listEvents", [], null, "events", async (_items, _removed, syncState) => {
    chunkStates.push(syncState);
  });
  expect(chunkStates).toEqual(["1", "2", "3"]);
  expect(sentStates).toEqual([null, "1", "2"]);
  expect(errors).toEqual([]);
});

test("A sync stops after a maximum number of rounds, when the addon keeps saying that it has more, each time with a new sync state", async () => {
  /** More rounds than any real sync needs. A client that goes on longer is stuck. */
  const kSaneMaxRounds = 100000;
  let next = 1;
  let { connection, errors, sentStates } = newConnection(() => ({ events: [], syncState: "s" + next++, hasMore: true }));

  await connection.listChanges("listEvents", [], null, "events", async () => {});
  expect(sentStates.length).toBeGreaterThan(1);
  expect(sentStates.length).toBeLessThanOrEqual(kSaneMaxRounds);
  expect(errors.length).toBe(1);
});
