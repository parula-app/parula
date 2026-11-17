import { Notification, NotificationSeverity } from "../../logic/util/Notification";
import { logErrorToServer } from "../Util/error";
import type { ArrayColl } from "svelte-collections";

export function showNotificationToast(message: string, notifications: ArrayColl<Notification>) {
  showNotification(message, NotificationSeverity.Info, 3, notifications);
}
export function showNotificationError(ex: Error, notifications: ArrayColl<Notification>) {
  logErrorToServer(ex);
  showNotification(ex?.message ?? ex + "", NotificationSeverity.Error, 3, notifications);
}
function showNotification(message: string, severity: NotificationSeverity, closeAfterSec: number, notifications: ArrayColl<Notification>) {
  let msg = new Notification(message, severity);
  notifications.add(msg);
  setTimeout(() => {
    notifications.remove(msg);
  }, closeAfterSec * 1000);
}
