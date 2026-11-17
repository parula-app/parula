import { afterEach, beforeEach, expect, test, vi } from "vitest";

/* logic/ shows errors by adding them to `notifications`, and logs them by
 * adding them to `errorsForServer`. It must not depend on Sentry.
 * The frontend watches both lists and sends the errors to the server.
 * Sentry logs only in production builds. */
vi.mock("@sentry/svelte", () => ({ captureException: vi.fn() }));
vi.mock("../../../logic/build", async (importOriginal) => ({ ...await importOriginal<object>(), production: true }));

import * as Sentry from "@sentry/svelte";
import { notifications } from "../../../logic/util/Notification";
import * as logic from "../../../logic/util/error";
import { showError, showUserError, logErrorToServer } from "../../../frontend/Util/error";
import { UserError } from "../../../logic/util/util";

beforeEach(() => {
  notifications.clear();
  logic.errorsForServer.clear();
  vi.mocked(Sentry.captureException).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("An error that logic shows is logged to the server by the frontend", () => {
  let ex = new Error("Server unreachable");

  logic.showError(ex);

  expect(notifications.contents.map(notification => notification.ex)).toEqual([ex]);
  expect(Sentry.captureException).toHaveBeenCalledWith(ex);
});

test("The frontend error functions are the ones of logic", () => {
  expect(showError).toBe(logic.showError);
  expect(logErrorToServer).toBe(logic.logErrorToServer);
});

test("The same error is shown and logged only once", () => {
  logic.showError(new Error("Server unreachable"));
  logic.showError(new Error("Server unreachable"));

  expect(notifications.length).toBe(1);
  expect(Sentry.captureException).toHaveBeenCalledTimes(1);
});

test("logErrorToServer() logs to the server without showing the error", () => {
  let ex = new Error("Unexpected");

  logic.logErrorToServer(ex);

  expect(notifications.isEmpty).toBe(true);
  expect(Sentry.captureException).toHaveBeenCalledWith(ex);
});

test("User errors are shown, but not logged to the server", () => {
  showUserError(new UserError("The recipient does not accept email"));

  expect(notifications.length).toBe(1);
  expect(Sentry.captureException).not.toHaveBeenCalled();
});

test("Errors with `doNotLog` are not logged to the server", () => {
  let ex = new Error("Expected");
  (ex as any).doNotLog = true;

  logic.logErrorToServer(ex);

  expect(Sentry.captureException).not.toHaveBeenCalled();
});

test("The frontend removes the errors from `errorsForServer` after sending them", () => {
  let ex = new Error("Unexpected");

  logic.logErrorToServer(ex);

  expect(Sentry.captureException).toHaveBeenCalledWith(ex);
  expect(logic.errorsForServer.isEmpty).toBe(true);
});

test("An error that is logged while sending another one is sent, and each only once", () => {
  let first = new Error("First");
  let second = new Error("Second");
  vi.mocked(Sentry.captureException).mockImplementationOnce(() => {
    logic.logErrorToServer(second);
    return "";
  });

  logic.logErrorToServer(first);

  expect(Sentry.captureException).toHaveBeenCalledTimes(2);
  expect(Sentry.captureException).toHaveBeenCalledWith(first);
  expect(Sentry.captureException).toHaveBeenCalledWith(second);
  expect(logic.errorsForServer.isEmpty).toBe(true);
});

/* The error functions that say why the error happened.
 * Which of them log to the server is decided in `logic/util/error.ts`. */

test("internalError() is logged to the server, but not shown", () => {
  let ex = new Error("Account lost its main account");

  logic.internalError(ex);

  expect(notifications.isEmpty).toBe(true);
  expect(Sentry.captureException).toHaveBeenCalledWith(ex);
});

test("dataError() and minorError() are neither shown nor logged to the server in production", () => {
  logic.dataError(new Error("Could not read one participant"));
  logic.minorError(new Error("Could not mark the original as replied"));

  expect(notifications.isEmpty).toBe(true);
  expect(Sentry.captureException).not.toHaveBeenCalled();
});

test("Errors that logic logged before the frontend was loaded are sent, too", async () => {
  vi.resetModules();
  let freshSentry = await import("@sentry/svelte");
  let freshLogic = await import("../../../logic/util/error");
  let ex = new Error("At startup");
  freshLogic.logErrorToServer(ex);

  await import("../../../frontend/Util/error");

  expect(freshSentry.captureException).toHaveBeenCalledWith(ex);
  expect(freshLogic.errorsForServer.isEmpty).toBe(true);
});
