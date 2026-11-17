import { VideoConfMeeting, MeetingState } from "../VideoConfMeeting";
import { MeetingParticipant, ParticipantRole } from "../Participant";
import type { LiveKitAccount } from "./LiveKitAccount";
import { LiveKitMediaDeviceStreams } from "./LiveKitMediaDeviceStreams";
import { LiveKitRemoteParticipant } from "./LiveKitRemoteParticipant";
import { ensureLicensed, getSavedTicket } from "../../util/LicenseClient";
import { appGlobal } from "../../app";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { catchErrors } from "../../util/error";
import { assert, type URLString } from "../../util/util";
import { fetchJSON } from "../../util/netUtil";
import { getDateTimeLocale, gt } from "../../../l10n/l10n";
import type { Room, RemoteParticipant, RpcInvocationData } from "livekit-client";

export class LiveKitConf extends VideoConfMeeting {
  /* Authentication */
  account: LiveKitAccount;
  /* Live connection with the controller, during a conference */
  protected webSocket: WebSocket;
  webSocketURL: URLString;
  room: Room | null = null;
  invitationURL: URLString;
  myParticipantToken: string;
  encryptionKey: string | null = null;
  mediaDeviceStreams: LiveKitMediaDeviceStreams;

  constructor(account: LiveKitAccount) {
    super();
    this.mediaDeviceStreams = new LiveKitMediaDeviceStreams();
    this.listenStreamChanges();
    this.account = account;
    this.id = crypto.randomUUID(); // dummy, will be replaced
  }

  /**
   * Login using OAuth2
   * If already logged in, does nothing.
   * @param relogin if true: Force a new login in any case.
   * @throws OAuth2Error
   */
  async login(interactive: boolean, relogin = false): Promise<void> {
  }

  async createNewConference() {
    await this.login(true);
    await ensureLicensed();
    let time = new Date().toLocaleString(getDateTimeLocale(), { hour: "numeric", minute: "numeric" });
    this.title = `Meeting ${time}`;
    this.state = MeetingState.Init;
  }

  async createInvitationURL(forName?: string): Promise<URLString> {
    /*assert(this.id, "Need to create the conference first");
    let url = this.account.apiURL + "meeting/invitation?" + new URLSearchParams({
      roomName: this.id,
      forName ?? "",
    });
    let response = await fetch(url);
    let tokens = await response.json();
    console.log("invitation code result", tokens);
    let url = tokens.invitationURL;
    let url = `${this.account.webFrontendBaseURL}/rooms/${this.id}#` + new URLSearchParams({
      invitation: tokens.invitationToken,
      name: forName ?? "",
      key: this.encryptionKey ?? "",
    });*/
    await ensureLicensed();
    // The invitation token has to be created together with the meeting, or in the join URL
    if (!this.invitationURL) {
      await this.createMyParticipant();
    }
    let urlObj = new URL(this.invitationURL);
    // add/replace key= and name= after #
    let anchor = new URLSearchParams(urlObj.hash?.substring(1));
    if (this.encryptionKey) {
      anchor.set("key", this.encryptionKey);
    }
    if (forName) {
      anchor.set("name", forName);
    } else {
      anchor.delete("name");
    }
    urlObj.hash = anchor.toString();
    return urlObj.href;
  }

  /**
   * Received invite URL out-of-band (using other communication methods)
   * from conference owner, who did `getInvitationURL()`.
   * URL form: https://<web-frontend-host>/rooms/<room-name>
   */
  async join(url: URLString) {
    let urlParsed = new URL(url);
    // Data comes from user. All error messages in this function are user visible. TODO Translate error messages.
    // Parse URL <https://meet.example.com/#room=abcd&key=34636436>
    assert(this.account.isMeetingURL(urlParsed), gt`This meeting URL is not supported`);
    let anchor = new URLSearchParams(urlParsed.hash?.substring(1));
    /* Parse URL <https://meet.example.com/room/abcd/?key=34636436>
    let paths = urlParsed.pathname.split("/").filter(c => !!c);
    assert(paths[0] == "room", "Not a meeting room URL");
    assert(paths[1], "Meeting room name is missing");
    let roomName = sanitize.alphanumdash(paths[1]);*/
    let roomName = sanitize.alphanumdash(anchor.get("room"), null);
    assert(roomName?.match(/^[a-zA-Z0-9\-]*$/), gt`Not a valid room name in meeting invitation URL`);
    this.id = roomName;
    this.encryptionKey = sanitize.alphanumdash(anchor.get("key"), null);
    this.state = MeetingState.JoinConference;

    if (anchor.has("invitation")) {
      await this.joinWithInvitation(url);
    }
  }

  protected async joinWithInvitation(url: URLString) {
    this.invitationURL = url;
    let anchor = new URLSearchParams(new URL(url).hash?.substring(1));
    let invitationToken = sanitize.alphanumdash(anchor.get("invitation"));

    let params = new URLSearchParams({
      roomName: this.id,
      invitationToken,
    });
    if (this.account.realname) {
      params.set("myName", this.account.realname);
    }
    let tokenURL = this.account.apiURL + "meeting/join-from-invitation?" + params;
    let json;
    try {
      json = await fetchJSON(tokenURL);
    } catch (ex) {
      throw new Error(gt`Could not join the meeting` + ` (${ex.message})`);
    }
    console.log("invitation code result", json);
    this.webSocketURL = sanitize.url(json.webSocketURL, undefined, ["wss"]);
    this.myParticipantToken = sanitize.nonemptystring(json.joinToken);
  }

  /** @returns participant token */
  protected async createMyParticipant(): Promise<string> {
    let ky = await appGlobal.remoteApp.kyCreate({
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 3000,
      result: "json",
    });
    let json = await ky.post(this.account.apiURL + "meeting?" + new URLSearchParams({
      myName: this.account.realname,
    }), {
      headers: {
        "X-AuthToken": btoa(JSON.stringify(getSavedTicket())),
      }
    });
    this.id = sanitize.alphanumdash(json.roomName);
    this.webSocketURL = sanitize.url(json.webSocketURL, undefined, ["wss"]);
    this.invitationURL = sanitize.url(json.invitationURL);
    let joinToken = sanitize.nonemptystring(json.joinToken);
    return joinToken;
  }

  /** For testing only: LiveKit Cloud Sandbox
   * @returns participant token *
  protected async createMyParticipantInLiveKitCloudSandbox(): Promise<string> {
    let myName = this.account.realname;
    assert(this.account.webFrontendBaseURL, "Need web frontend base URL");
    let ky = await appGlobal.remoteApp.kyCreate({
      headers: {
        "Content-Type": "application/json",
        "Origin": this.account.webFrontendBaseURL, // Controller uses this to find the room
      },
      timeout: 3000,
      result: "json",
    });
    let response = await ky.get(`https://cloud-api.livekit.io/api/sandbox/connection-details?` + new URLSearchParams({
      roomName: this.id,
      participantName: myName,
    }));
    this.webSocketURL = sanitize.url(response.serverUrl);
    this.myParticipantToken = sanitize.nonemptystring(response.participantToken);
    // this.controllerWebSocketURL = `wss://${this.webSocketURL}/rtc?access_token=${e(participantToken)}&auto_subscribe=1&protocol=15&adaptive_stream=1`;
    return this.myParticipantToken;
  }*/

  async start() {
    assert(this.id, "Need to create the conference first");
    // Hack for MeetWeb/Join.svelte
    if (this.state == MeetingState.Init && this.invitationURL) {
      await this.join(this.invitationURL);
    }

    await super.start();
    this.myParticipantToken ??= await this.createMyParticipant();
    await this.joinAfterStart(this.myParticipantToken);
  }

  protected async joinAfterStart(participantToken: string) {
    const { Room, RoomEvent } = await import("livekit-client");
    this.room = new Room();
    await this.room.connect(this.webSocketURL, participantToken);
    this.title = this.room.name;
    this.mediaDeviceStreams.localParticipant = this.room.localParticipant;

    this.myParticipant = new MeetingParticipant();
    this.myParticipant.id = this.room.localParticipant.sid;
    this.myParticipant.name = this.room.localParticipant.name;
    this.myParticipant.role = ParticipantRole.User;
    this.myParticipant.subscribe((_obj, propName) => catchErrors(() => this.myUserChanged(propName), this.errorCallback));
    this.state = MeetingState.Ongoing;

    this.room.localParticipant.registerRpcMethod("handUp", async (data: RpcInvocationData) => {
      let remoteParticipant = this.participants.find((p: LiveKitRemoteParticipant) => p.rp.identity == data.callerIdentity);
      assert(remoteParticipant, "LiveKit: Remote participant not found");
      let up = sanitize.translate(data.payload, { "up": true, "down": false });
      console.log(remoteParticipant.name, "has put hand", up ? "up" : "down");
      remoteParticipant.handUp = up;
      return "";
    });

    for (let remoteParticipant of this.room.remoteParticipants.values()) {
      this.participantJoined(remoteParticipant);
    }
    this.room.on(RoomEvent.ParticipantConnected, rp => catchErrors(() => this.participantJoined(rp), this.errorCallback));
    this.room.on(RoomEvent.ParticipantDisconnected, rp => catchErrors(() => this.participantLeft(rp), this.errorCallback));

    /*if (this.myParticipant.cameraOn) {
      this.room.localParticipant.setCameraEnabled(true);
    }
    if (this.myParticipant.micOn) {
      this.room.localParticipant.setMicrophoneEnabled(true);
    }*/
  }

  protected participantJoined(remoteParticipant: RemoteParticipant) {
    let participant = new LiveKitRemoteParticipant(remoteParticipant, this);
    this.participants.add(participant);
  }

  protected async participantLeft(remoteParticipant: RemoteParticipant) {
    let participant = this.participants.find(p => p.id == remoteParticipant.identity) as LiveKitRemoteParticipant | null;
    assert(participant, "Participant left, but we didn't know about him.");
    this.videos.removeAll(this.videos.filter(v => v.participant == participant));
    this.participants.remove(participant);
  }

  readonly canHandUp = true;

  protected async myUserChanged(propName: string) {
    console.log("My participant changed", propName, "to", this.myParticipant[propName]);
    if (propName == "handUp") {
      await this.setMyHandUp(this.myParticipant.handUp);
    }
  }

  protected async setMyHandUp(up: boolean) {
    for (let otherParticipant of this.participants) {
      await this.room.localParticipant.performRpc({
        destinationIdentity: (otherParticipant as LiveKitRemoteParticipant).rp.identity,
        method: "handUp",
        payload: up ? "up" : "down",
      });
    }
  }

  /*protected setMyAttribute(name: string, value: any) {
    if (value == null) {
      // Per docs: To delete an attribute key, set its value to an empty string ('').
      // <https://docs.livekit.io/home/client/state/participant-attributes/>
      value = "";
    }
    let attributes = {};
    Object.assign(attributes, this.room.localParticipant.attributes);
    attributes[name] = value;
    this.room.localParticipant.setAttributes(attributes);
  }*/

  async answer() {
    await super.answer();
  }

  async hangup() {
    await super.hangup();
    if (this.room) {
      await this.room.disconnect();
    }
  }
}

export function arrayRemoveLast(array, item) {
  let pos = array.lastIndexOf(item);
  if (pos > -1) {
    array.splice(pos, 1);
  }
}
