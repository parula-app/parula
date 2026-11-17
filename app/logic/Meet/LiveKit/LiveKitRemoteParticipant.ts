import { MeetingParticipant, ParticipantRole } from "../Participant";
import { VideoStream } from "../VideoStream";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { catchErrors } from "../../util/error";
import { assert } from "../../util/util";
import type { LiveKitConf } from "./LiveKitConf";
import type { RemoteParticipant, Track as TrackType, TrackPublication } from "livekit-client";

export class LiveKitRemoteParticipant extends MeetingParticipant {
  rp: RemoteParticipant;
  conf: LiveKitConf;
  video: VideoStream;
  screenShare: VideoStream;

  constructor(rp: RemoteParticipant, conf: LiveKitConf) {
    super();
    this.rp = rp;
    this.conf = conf;
    this.id = rp.identity;
    this.role = rp.isAgent
      ? ParticipantRole.Agent
      : rp.permissions && !rp.permissions.canSubscribe
        ? ParticipantRole.Waiting
        : ParticipantRole.User;
    this.updateProps();
    rp.on(ParticipantEvent.ParticipantNameChanged, () => catchErrors(() => this.updateProps(), this.conf.errorCallback));
    rp.on(ParticipantEvent.AttributesChanged, () => catchErrors(() => this.updateProps(), this.conf.errorCallback));
    rp.on(ParticipantEvent.ParticipantMetadataChanged, () => catchErrors(() => this.updateProps(), this.conf.errorCallback));
    rp.on(ParticipantEvent.TrackPublished, () => catchErrors(() => this.updateProps(), this.conf.errorCallback));
    rp.on(ParticipantEvent.TrackUnpublished, () => catchErrors(() => this.updateProps(), this.conf.errorCallback));
    rp.on(ParticipantEvent.IsSpeakingChanged, () => catchErrors(() => this.speakingChanged(), this.conf.errorCallback));
    rp.on(ParticipantEvent.TrackSubscribed, track => catchErrors(() => this.addTrack(track), this.conf.errorCallback));
    rp.on(ParticipantEvent.TrackUnsubscribed, track => catchErrors(() => this.removeTrack(track), this.conf.errorCallback));
    rp.on(ParticipantEvent.TrackMuted, trackPub => catchErrors(() => this.trackMuted(trackPub), this.conf.errorCallback));
    rp.on(ParticipantEvent.TrackUnmuted, trackPub => catchErrors(() => this.trackUnmuted(trackPub), this.conf.errorCallback));

    for (let trackPub of rp.trackPublications.values()) {
      if (!trackPub.isSubscribed || !trackPub.track) {
        continue;
      }
      this.addTrack(trackPub.track)
        .catch(conf.account.errorCallback); // TODO throw
    }
  }
  protected updateProps() {
    let rp = this.rp;
    console.log("Participant", rp.identity, rp);
    this.name = rp.name || rp.identity;
    this.cameraOn = rp.isCameraEnabled;
    this.micOn = rp.isMicrophoneEnabled;
    this.screenSharing = rp.isScreenShareEnabled;
    this.handUp = sanitize.boolean(rp.attributes.handUp);
  }
  protected speakingChanged() {
    this.isSpeaking = this.rp.isSpeaking;
    if (this.rp.isSpeaking) {
      this.conf.speaker = this;
    } else if (this.conf.speaker == this) {
      this.conf.speaker = null;
    }
  }

  async addTrack(track: TrackType) {
    console.log("Participant", this.rp.identity, "added a track", track.mediaStream, track.mediaStream.getTracks());
    assert(track.mediaStream, "Need mediaStream for Track");
    let isScreen = track.source == Track.Source.ScreenShare || track.source == Track.Source.ScreenShareAudio;
    let video = isScreen ? this.screenShare : this.video;
    let isNew = !video;
    if (isNew) {
      video = new VideoStream(new MediaStream(), this);
      video.isScreenShare = isScreen;
    }

    // Must add the track before adding it to `conf.videos`, because that will create a
    // `<video>` element, and Firefox needs the source already connected,
    // otherwise it freezes on the first frame.
    video.stream.addTrack(track.mediaStreamTrack);
    if (track.kind == Track.Kind.Video) {
      video.hasVideo = true;
    }

    if (isNew) {
      if (isScreen) {
        this.screenShare = video;
      } else {
        this.video = video;
      }
      this.conf.videos.add(video);
    }
  }
  async removeTrack(track: TrackType) {
    console.log("Participant", this.rp.identity, "removed a track");
    let isScreen = track.source == Track.Source.ScreenShare || track.source == Track.Source.ScreenShareAudio;
    let video = isScreen ? this.screenShare : this.video;
    if (!video) {
      return;
    }

    video.stream.removeTrack(track.mediaStreamTrack);

    let remainingTracks = video.stream.getTracks();
    video.hasVideo = remainingTracks.some(t => t.kind == "video");
    if (!remainingTracks.length) {
      this.conf.videos.remove(video);
      if (isScreen) {
        this.screenShare = null;
      } else {
        this.video = null;
      }
    }
  }
  async trackMuted(trackPub: TrackPublication) {
    this.updateProps();
    if (trackPub.videoTrack) {
      await this.removeTrack(trackPub.videoTrack);
    }
  }
  async trackUnmuted(trackPub: TrackPublication) {
    this.updateProps();
    if (trackPub.videoTrack) {
      await this.addTrack(trackPub.videoTrack);
    }
  }
}

// <copied from="https://github.com/livekit/client-sdk-js/blob/main/src/room/track/Track.ts#L423" reason="avoid import" />
export namespace Track {
  export enum Kind {
    Audio = 'audio',
    Video = 'video',
    Unknown = 'unknown',
  }
  export enum Source {
    Camera = 'camera',
    Microphone = 'microphone',
    ScreenShare = 'screen_share',
    ScreenShareAudio = 'screen_share_audio',
    Unknown = 'unknown',
  }
}
// <copied from="https://github.com/livekit/client-sdk-js/blob/main/src/room/events.ts#L357" reason="avoid import" />
export enum ParticipantEvent {
  TrackPublished = 'trackPublished',
  TrackSubscribed = 'trackSubscribed',
  TrackUnpublished = 'trackUnpublished',
  TrackUnsubscribed = 'trackUnsubscribed',
  TrackMuted = 'trackMuted',
  TrackUnmuted = 'trackUnmuted',
  ParticipantMetadataChanged = 'participantMetadataChanged',
  ParticipantNameChanged = 'participantNameChanged',
  IsSpeakingChanged = 'isSpeakingChanged',
  AttributesChanged = 'attributesChanged',
}
