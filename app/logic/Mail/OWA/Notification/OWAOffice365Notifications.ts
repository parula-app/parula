import { OWANotifications } from "./OWANotifications";
import { OWASubscribeToNotificationRequest } from "../Request/OWASubscribeToNotificationRequest";
import { EventDecoder } from "../../../util/eventSource";
import { ensureArray, sleep } from "../../../util/util";
import { URLPart } from "../../../util/blob";
import { sanitize } from "../../../../../lib/util/sanitizeDatatypes";

/** SignalR v2, see <https://github.com/dotnet/aspnetcore/tree/main/src/SignalR/docs/specs> */
export class OWAOffice365Notifications extends OWANotifications {
  static readonly kRecordSeparator = "\x1e";

  async start(): Promise<never> {
    const kMinConnectionSeconds = 60;
    let cid = "00000000-0000-0000-0000-000000000000".replace(/0/g, () => Math.floor(Math.random() * 16).toString(16));
    // This loop only ends by exception (e.g. logout) or app shutdown.
    while (true) {
      let started = Date.now();
      await this.connect(cid);
      if (Date.now() - started < kMinConnectionSeconds * 1000) {
        throw new Error("Office 365 ended the notification channel right after it opened");
      }
    }
  }

  /** Returns when the server ended the connection */
  protected async connect(cid: string): Promise<void> {
    let hubURL = this.account.url + "notificationchannel";
    let negotiate = await fetch(hubURL + URLPart`/negotiate?negotiateVersion=1&cid=${cid}`, {
      method: "POST",
      headers: {
        Authorization: this.account.authorizationHeader,
        "Content-Type": "text/plain;charset=UTF-8",
      },
    });
    if (!negotiate.ok) {
      let allowed = negotiate.headers.get("Allow");
      throw new Error(`negotiate failed with HTTP ${negotiate.status} ${negotiate.statusText}` +
        (allowed ? `, server allows ${allowed}` : ""));
    }
    let json = await negotiate.json();
    if (json.error) {
      throw new Error("Office 365 refused the notification channel: " + sanitize.label(json.error, ""));
    }
    if (!ensureArray(json.availableTransports).some(available => available?.transport == "ServerSentEvents")) {
      throw new Error("Office 365 doesn't offer server-sent events for notifications");
    }
    let connectionURL = hubURL + URLPart`?id=${sanitize.nonemptystring(json.connectionToken ?? json.connectionId)}&cid=${cid}`;

    let connection = new AbortController();
    let pingTimer: ReturnType<typeof setInterval>;
    try {
      let stream = await fetch(connectionURL, {
        headers: {
          Authorization: this.account.authorizationHeader,
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
        },
        signal: connection.signal,
      });
      if (!stream.ok) {
        throw new Error(`stream fetch failed with HTTP ${stream.status} ${stream.statusText}`);
      }
      await this.send(connectionURL, { protocol: "json", version: 1 });
      // Office 365 closes the connection when we didn't send anything for 5 minutes.
      pingTimer = setInterval(() => {
        this.send(connectionURL, { type: 6 })
          .catch(ex => connection.abort(ex));
      }, 60 * 1000);
      let handshakeDone = false;
      let eventStream = stream.body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream(new EventDecoder()));
      for await (let event of eventStream) {
        for (let record of event.data.split(OWAOffice365Notifications.kRecordSeparator)) {
          if (!record) {
            continue;
          }
          let message = JSON.parse(record);
          if (!handshakeDone) {
            if (message.error) {
              throw new Error("Office 365 refused the notification handshake: " + sanitize.label(message.error, ""));
            }
            handshakeDone = true;
          } else if (message.type == 1) { // Invocation
            let notifications = ensureArray(message.arguments).map(argument => ensureArray(argument));
            // Subscriptions apply only to the connections that are ready at that time
            if (notifications.flat().some(notification => notification?.id == "ChannelReady")) {
              await this.account.callOWA(new OWASubscribeToNotificationRequest());
            }
            await sleep(0.1); // Avoid racing with ourselves, if we caused the notification
            await this.account.onNotificationMessages(notifications);
          } else if (message.type == 7) { // Close
            if (message.error && !message.allowReconnect) {
              throw new Error("Office 365 closed the notification channel: " + sanitize.label(message.error, ""));
            }
            return;
          }
        }
      }
    } catch (ex) {
      throw connection.signal.reason ?? ex;
    } finally {
      clearInterval(pingTimer);
      connection.abort();
    }
  }

  protected async send(connectionURL: string, message: Record<string, any>): Promise<void> {
    let response = await fetch(connectionURL, {
      method: "POST",
      headers: {
        Authorization: this.account.authorizationHeader,
        "Content-Type": "text/plain;charset=UTF-8",
      },
      body: JSON.stringify(message) + OWAOffice365Notifications.kRecordSeparator,
    });
    // 409: Our previous message is still being sent. The connection stays open.
    if (!response.ok && response.status != 409) {
      throw new Error(`notification send failed with HTTP ${response.status} ${response.statusText}`);
    }
  }
}
