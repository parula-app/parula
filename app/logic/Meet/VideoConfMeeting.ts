import { VideoStream } from "./VideoStream";
import type { MeetAccount } from "./MeetAccount";
import type { MeetingParticipant as Participant } from "./Participant";
import type { MediaDeviceStreams } from "./MediaDeviceStreams";
import type { Event } from "../Calendar/Event";
import { appGlobal } from "../app";
import { SetColl, ArrayColl } from 'svelte-collections';
import { Observable, notifyChangedProperty } from "../util/Observable";
import { assert, type URLString, AbstractFunction, NotSupported } from "../util/util";
import { catchErrors } from "../util/error";
import { gt } from "../../l10n/l10n";

export class VideoConfMeeting extends Observable {
  id: string;
  account: MeetAccount;
  @notifyChangedProperty
  event: Event;
  @notifyChangedProperty
  state: MeetingState = MeetingState.Init;
  @notifyChangedProperty
  started: Date;
  @notifyChangedProperty
  ended: Date;
  @notifyChangedProperty
  title: string;
  /** People how are in the meeting.
   * TODO Includes `myParticipant` or not? I think not. */
  readonly participants = new SetColl<Participant>();
  readonly videos = new SetColl<VideoStream>();
  /** People who were asked to join, but are not yet connected */
  readonly invited = new ArrayColl<Participant>();
  /** myParticipant.role: If I'm a moderator, I can manage other users */
  @notifyChangedProperty
  myParticipant: Participant;
  /** Who is currently speaking at the moment */
  speaker: Participant | null = null;
  /**
   * Where to get cam, mic and screenshare of the user from.
   * The UI uses this class to turn on/off cam, mic etc., and
   * to specifc which hardware devices to use.
   *
   * Set in constructor by implementation subclass, and call
   * `listenStreamChanges()` after.
   * Usually `LocalMediaDeviceStreams` or a protocol-specific impl. */
  mediaDeviceStreams: MediaDeviceStreams;
  hasVideo = true;

  /** Subclass constructor must set `this.mediaDeviceStreams` and then call this function. */
  protected listenStreamChanges() {
    this.mediaDeviceStreams.subscribe((_obj, propName: string, oldValue: any) =>
      catchErrors(() => this.streamsChanged(propName, oldValue), ex => this.errorCallback(ex)));
  }

  errorCallback = (ex: Error) => {
    console.error(ex);
  };
  endCallback = () => {
    console.log("Call ended");
  };

  /**
   * Before joining
   *
   * Part of the flow to create a new conference room. Flow:
   * 1. createNewConference(url) <--- You are here
   * 2. MeetingState.Init
   * 3. UI to confirm to create the meeting
   * 4. start() (TODO: Rename to connectNewConference())
   * 5. MeetingState.Ongoing
   * 6. Select person(s) to invite
   * 7. createInvitationURL()
   * 8. Other participants join on their end, using join()
   * 9. hangup()
   * 10. MeetingState.Ended
   */
  async createNewConference() {
    throw new AbstractFunction();
  }

  /**
   * Part of the flow of creating a conference room.
   * TODO: Rename to connectNewConference(), and split from joinConnect()
   */
  async start() {
    this.startNow();
  }

  /**
   *
   */
  protected startNow() {
    this.started = new Date();
  }

  /** Creates a URL that leads to a webpage that allows people
   * outside the organization to join this meeting using only
   * a webbrowser.
   * Mustang should normally recognize this kind of URL
   * (in certain situations, e.g. in an event as onlineMeetingURL)
   * and allow to join within Mustnag using the Meet feature.
   * Only works if `account.canCreateURL`. */
  async createInvitationURL(forName?: string): Promise<URLString> {
    throw new NotSupported(gt`Cannot invite others using a link to this kind of meeting`);
  }

  /**
   * The user received invitation URL out-of-band (using other communication methods)
   * from the conference organizer.
   * The URL should contain both the room and the ticket to permit joining.
   *
   * You need to call `start()` after.
   * TODO: Rename the function: It only prepares the joining.
   *
   * Part of the flow to join a conference room. Flow:
   * 1. join(url) <--- You are here (TODO: Rename to joinPropose())
   * 2. MeetingState.JoinConference
   * 3. UI to confirm to join the meeting
   * 4. start() (TODO: joinConnect(), and split from connectNewConference())
   * 5. MeetingState.Ongoing
   * 6. hangup()
   * 7. MeetingState.Ended
   */
  async join(url: URLString): Promise<void> {
    throw new AbstractFunction();
  }

  /** Called when the user's own local cam/screen from `.mediaDeviceStreams` changes */
  protected async streamsChanged(propName: string, oldValue: MediaStream) {
    console.log("Stream changed", propName, "from", oldValue?.getTracks?.(), "to", this.mediaDeviceStreams[propName]?.getTracks?.());
    if (propName == "cameraMicStream") {
      let stream = this.mediaDeviceStreams.cameraMicStream;
      if (stream) {
        if (oldValue) {
          await this.stopCameraMic(oldValue);
        }
        await this.startCameraMic(stream);
      } else {
        await this.stopCameraMic(oldValue);
      }
    }
    if (propName == "screenStream") {
      let stream = this.mediaDeviceStreams.screenStream;
      if (stream) {
        if (oldValue) {
          await this.stopScreenShare(oldValue);
        }
        await this.startScreenShare(stream);
      } else {
        await this.stopScreenShare(oldValue);
      }
    }
  }

  /**
   * After opening our user's camera and microphone
   * using `getUserMedia()`, pass the stream here.
   *
   * You should preferably do that before `start()`ing the conference,
   * but you can do it at any time.
   *
   * This function will also add or remove the `VideoStream` instance
   * in `.videos`, so showing all `.videos` is enough to show self.
   *
   * @param MediaStream from getUserMedia()
   */
  async startCameraMic(mediaStream: MediaStream) {
    let self = new VideoStream(mediaStream, this.myParticipant);
    self.isMe = true;
    self.hasVideo = mediaStream.getVideoTracks().length > 0;
    this.videos.add(self);
  }

  async stopCameraMic(oldStream?: MediaStream) {
    assert(oldStream, "want old stream to remove");
    this.videos.remove(this.videos.find(v => v.isMe &&
      (v.stream == oldStream || !oldStream)));
  }

  async startScreenShare(mediaStream: MediaStream) {
    let screenShare = new VideoStream(mediaStream, this.myParticipant);
    screenShare.isScreenShare = true;
    screenShare.isMe = true;
    this.videos.add(screenShare);
  }

  async stopScreenShare(oldStream?: MediaStream) {
    assert(oldStream, "want old stream to remove");
    this.videos.remove(this.videos.find(v => v.isScreenShare && v.isMe &&
      (v.stream == oldStream || !oldStream)));
  }

  readonly canHandUp: boolean = false;

  /**
   * Part of the outgoing phone call flow:
   * 1. join(url) (?)
   * 2. MeetingState.OutgoingCallConfirm
   * 3. UI to confirm outgoing call
   * 4. call() <--- You are here
   * 5. MeetingState.OutgoingCall
   * 6. Ringing remote. Waiting for the called person to answer.
   * 7. MeetingState.Ongoing
   * 8. hangup()
   * 9. MeetingState.Ended
   *
   * The function will return once the conference room is established. */
  async call() {
    assert(this.state == MeetingState.OutgoingCallConfirm, "Must be an outgoing call");
    this.state = MeetingState.OutgoingCall;
  }

  /** If a listener tells you that somebody calls us,
   * and the listener passes the VideoConfMeeting object,
   * you can accept the call with this method.
   *
   * Part of the flow for incoming phone calls:
   * 1. onIncomingCall() (?)
   * 2. MeetingState.IncomingCall
   * 3. Ringing here. UI to accept the call.
   * 4. answer() <--- You are here
   * 5. MeetingState.Ongoing
   * 6. hangup()
   * 7. MeetingState.Ended
   *
   * The function will return once the conference room is established. */
  async answer() {
    this.startNow();
  }

  /** Leave this conference. */
  async hangup() {
    /** TODO `remove()` not working when the call starts while I'm in another app and being called.
     * The meeting is in state `Ended` (which is only set here), but still in `appGlobal.meetings`.
     * Workaround: `filterObservable()` in Main.svelte and MeetBackground.svelte. */
    appGlobal.meetings.remove(this);
    this.state = MeetingState.Ended;
    this.ended = new Date();
  }

  get selfVideo(): VideoStream | null {
    return this.videos.find(v => v.isMe && !v.isScreenShare) ?? null;
  }
}

/**
 *
 */
export enum MeetingState {
  /** Initial state, before setting up. */
  Init = "init",
  /** We're about to join a conference room, with a flexible number of attendants,
   * but we didn't connect to the conference server yet.
   * We are letting the user confirm that he really wants to join. */
  JoinConference = "join-conference",
  /** User is about to call 1 or more people directly, but we didn't start ringing yet.
   * Let the user confirm that he really wants to call out. */
  OutgoingCallConfirm = "outgoing-confirm",
  /** We are calling others, and ringing them on their end. */
  OutgoingCall = "outgoing",
  /** Others are calling us. It's ringing on our end. */
  IncomingCall = "incoming",
  /** Parties are connected or connecting. */
  Ongoing = "ongoing",
  /** Call is over. */
  Ended = "ended",
}
