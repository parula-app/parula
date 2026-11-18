import type { MailAccount } from "../../../logic/Mail/MailAccount";
import type { AutoResponder } from "../../../logic/Mail/AutoResponder";

/** For the info bar and File > Info. Only when logged in, so that it doesn't ask for a login. */
export async function loadAutomaticReplies(account: MailAccount) {
  if (!account?.isLoggedIn || !account.autoResponder.supported) {
    return;
  }
  await account.autoResponder.load();
}

/** The server replies to mail that arrives now */
export function isReplyingNow(autoResponder: AutoResponder, now = new Date()): boolean {
  return autoResponder.isOn && (!autoResponder.scheduled ||
    autoResponder.startTime.getTime() <= now.getTime() && now.getTime() < autoResponder.endTime.getTime());
}

/** The end time moves with the start time and keeps the length of the time range, as for events */
export function setStartTime(autoResponder: AutoResponder, startTime: Date) {
  let length = autoResponder.endTime.getTime() - autoResponder.startTime.getTime();
  autoResponder.startTime = startTime;
  autoResponder.endTime = new Date(startTime.getTime() + length);
}
