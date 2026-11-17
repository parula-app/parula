import { notifications, Notification, NotificationSeverity } from "./Notification";
import { production } from "../build";
import { ArrayColl } from "svelte-collections";

/** Shows the error to the user, and logs it to the error log server */
export function showError(ex: Error) {
  console.error(errorMessage(ex), ex);
  if (shouldShow(ex)) {
    notifications.add(new Notification(errorMessage(ex), NotificationSeverity.Error, ex));
  }
}

/** The frontend watches this, sends the errors to the error log server, and removes them */
export const errorsForServer = new ArrayColl<Error>();
/** Logs the error to the error log server, without showing it to the user */
export function logErrorToServer(ex: Error) {
  console.error(errorMessage(ex), ex);
  errorsForServer.add(ex);
}

/** A task failed that the user is not waiting for, e.g. marking the original email as replied after sending the reply.
 * Shows the error as warning only in development builds, and does not log it to the error log server. */
export function minorError(ex: Error) {
  console.error(errorMessage(ex), ex);
  if (production) {
    return;
  }
  if (shouldShow(ex)) {
    notifications.add(new Notification(errorMessage(ex), NotificationSeverity.Warning, ex));
  }
}

/** The data of one item is bad, e.g. a database row, an object from the server, or the HTML of an email.
 * Call it in the `catch` within a loop, so that the loop continues with the other items. @see `Account.dataError()` */
export function dataError(ex: Error) {
  minorError(ex);
}

/** Our own state is inconsistent, e.g. an account lost its main account, or failed to load. Probably a bug. */
export function internalError(ex: Error) {
  logErrorToServer(ex);
}

function shouldShow(ex: Error): boolean {
  return ex?.message &&
    !(ex as any).doNotShow &&
    !notifications.find(noti => noti.message == errorMessage(ex)); // don't repeat
}

/** The account name, for errors of a specific account.
 * It's in a separate property and not in `ex.message`, because we must not
 * send it to the error log server. @see `addAccountName()` */
export function errorMessage(ex: Error): string {
  let message = ex?.message ?? ex + "";
  let accountName = (ex as any)?.accountName;
  return accountName ? `${accountName}: ${message}` : message;
}

export async function catchErrors(func: Function, errorFunc = showError) {
  try {
    await func();
  } catch (ex) {
    errorFunc(ex);
  }
}

/** In case of errors/exceptions, return a fallback value */
export function catchFallback<T>(func: () => T, fallbackResult: T): T {
  try {
    return func();
  } catch (ex) {
    return fallbackResult;
  }
}
