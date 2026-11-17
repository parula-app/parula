import * as logic from "../../logic/util/error";
import { notifications, Notification, NotificationSeverity } from "../../logic/util/Notification";
import { production } from "../../logic/build";
import * as Sentry from "@sentry/svelte";

export const showError = logic.showError;
export const logErrorToServer = logic.logErrorToServer;
export const minorError = logic.minorError;
export const catchErrors = logic.catchErrors;
export const catchFallback = logic.catchFallback;

export function showUserError(ex: Error, autoDisappearAfterSeconds?: number): { remove(): void } {
  let notification = new Notification(logic.errorMessage(ex), NotificationSeverity.Error, ex);
  notifications.add(notification);
  if (autoDisappearAfterSeconds) {
    setTimeout(() => {
      notifications.remove(notification);
    }, autoDisappearAfterSeconds * 1000);
  }
  return {
    remove() {
      notifications.remove(notification);
    }
  };
}

function sendToErrorLogServer(ex: Error) {
  try {
    if ((ex as any)?.isUserError || (ex as any)?.doNotLog) {
      return;
    }
    if (production) {
      Sentry.captureException(ex);
    }
  } catch (ex) {
    console.error(ex);
  }
}

const logNotificationErrors = {
  added(added: Notification[]) {
    for (let notification of added) {
      if (notification.ex) {
        sendToErrorLogServer(notification.ex);
      }
    }
  },
  removed() {
  },
};
notifications.registerObserver(logNotificationErrors);
(notifications as any)._logNotificationErrors = logNotificationErrors; // HACK to keep it alive: `registerObserver()` holds it only weakly

function sendErrorsForServer() {
  let errors = logic.errorsForServer.contents;
  logic.errorsForServer.clear();
  for (let ex of errors) {
    sendToErrorLogServer(ex);
  }
}

const logErrorsForServer = {
  added() {
    sendErrorsForServer();
  },
  removed() {
  },
};
logic.errorsForServer.registerObserver(logErrorsForServer);
(logic.errorsForServer as any)._logErrorsForServer = logErrorsForServer; // HACK to keep it alive: `registerObserver()` holds it only weakly
sendErrorsForServer(); // Errors that logic added before this file was loaded
