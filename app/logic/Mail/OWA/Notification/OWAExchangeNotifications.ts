import { OWANotifications } from "./OWANotifications";
import { OWASubscribeToNotificationRequest } from "../Request/OWASubscribeToNotificationRequest";
import { appGlobal } from "../../../app";

export class OWAExchangeNotifications extends OWANotifications {
  async start(): Promise<never> {
    await this.account.callOWA(new OWASubscribeToNotificationRequest());
    // handle logout
    // add throttle
    let url = this.account.url + "ev.owa2?ns=PendingRequest&ev=FinishNotificationRequest&UA=0";
    let response = await appGlobal.remoteApp.OWA.fetchJSON(this.account.partition, url, { method: "POST" });
    let json = response.json;
    let cid = json.cid;
    // This loop only ends by exception (e.g. logout) or app shutdown.
    while (true) {
      url = this.account.url + "ev.owa2?ns=PendingRequest&ev=PendingNotificationRequest&UA=0&cid=" + cid + "&X-OWA-CANARY=";
      let stream = await appGlobal.remoteApp.OWA.fetchJSON(this.account.partition, url);
      if (!stream.ok) {
        throw new Error(`stream fetch failed with HTTP ${stream.status} ${stream.statusText}`);
      }
      const endScript = "</script>";
      let data = "";
      for await (let chunk of stream.body) {
        // Avoid racing with ourselves, if we caused the notification.
        await new Promise(resolve => setTimeout(resolve, 100));
        // A notification can be split across chunks,
        // so keep the incomplete tail for the next chunk.
        data += chunk;
        let matches = data.match(/<script>.*?<\/script>/g);
        if (matches) {
          data = data.slice(data.lastIndexOf(endScript) + endScript.length);
          let messages: any[] = [];
          for (let match of matches) {
            let script = match.slice(8, -9);
            if (script.startsWith("[")) {
              messages.push(JSON.parse(script));
            }
          }
          await this.account.onNotificationMessages(messages);
        }
      }
    }
  }
}
