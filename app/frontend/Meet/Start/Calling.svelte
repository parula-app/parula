<vbox class="calling" flex bind:clientWidth={width}>
  <SplitterBidirectional name="calling-contact-history"
    hasFirst={showContactHistory}
    initialSecondRatio={0.4}
    horizontal={width < 1000}>
    <vbox flex state={$meeting.state} slot="first">
      <!-- svelte-ignore element_invalid_self_closing_tag -->
      <hbox flex />
      <hbox class="boxes" flex>
        <hbox flex />
        {#if showAvatar}
          <vbox class="box">
            <vbox class="text">
              <hbox class="what">
                {#if $meeting.state == MeetingState.OutgoingCallConfirm}
                  {$t`Do you want to call?`}
                {:else if $meeting.state == MeetingState.OutgoingCall}
                  {$t`You're calling...`}
                {:else if $meeting.state == MeetingState.IncomingCall} <!---->
                {/if}
              </hbox>
              <hbox class="who">
                {#if $participants.length == 1}
                  {participants.first.name}
                {:else if $participants.length > 1}
                  {meeting.event?.title}
                {/if}
              </hbox>
              {#if $participants.length == 1}
                <hbox class="who-id">
                  <!-- Phone number -->
                  {#if participants.first.emailAddress != kDummyPerson.emailAddress}
                    {participants.first.emailAddress}
                  {/if}
                </hbox>
              {/if}
              <hbox class="who-count">
                {#if $participants.length > 1}
                  ({participants.length} participants)
                {/if}
              </hbox>
              <hbox class="what">
                {#if $meeting.state == MeetingState.OutgoingCallConfirm} <!---->
                {:else if $meeting.state == MeetingState.OutgoingCall} <!---->
                {:else if $meeting.state == MeetingState.IncomingCall}
                  {$t`is calling you...`}
                {/if}
              </hbox>
            </vbox>
            <vbox class="participants" flex>
              {#if $participants.length == 1}
                <PersonPicture person={participants.first.findPerson()} size={196} />
              {:else if $participants.length > 1}
                <GroupPicture persons={participants.map(uid => uid.findPerson()).filterOnce(Boolean)} size={196} />
              {/if}
            </vbox>
            <hbox class="actions">
              <hbox class="buttons">
                {#if $meeting.state == MeetingState.OutgoingCallConfirm}
                  <RoundButton classes="cancel action"
                    label={$t`Cancel`}
                    icon={XIcon}
                    iconSize="24px"
                    onClick={hangup}
                    />
                {:else}
                  <RoundButton classes="hangup action"
                    label={$meeting.state == MeetingState.IncomingCall ? $t`Decline call` : $t`Hang up`}
                    icon={HangUpIcon}
                    onClick={hangup}
                    iconSize="24px"
                    border={false} />
                {/if}
              </hbox>
              <hbox flex />
              <hbox class="mic-setup">
                <DeviceSetup withVideo={false} />
              </hbox>
              <hbox flex />
              <hbox class="buttons">
                {#if $meeting.state != MeetingState.OutgoingCall}
                  <RoundButton classes="accept action"
                    label={$meeting.state == MeetingState.OutgoingCallConfirm ? $t`Call` : $t`Accept call`}
                    icon={CallIcon}
                    iconSize="24px"
                    onClick={accept}
                    border={false} />
                {/if}
              </hbox>
            </hbox>
          </vbox>
          <hbox class="gap" />
        {/if}
        {#if meeting.hasVideo}
          <vbox class="device-setup">
            <DeviceSetup>
              <hbox class="actions left" flex slot="buttons-left">
                {#if !showAvatar}
                  <RoundButton classes="cancel"
                    label={$t`Cancel`}
                    icon={XIcon}
                    iconSize="24px"
                    onClick={hangup}
                    />
                {/if}
              </hbox>
              <hbox class="actions right" flex slot="buttons-right">
                {#if !showAvatar}
                  <RoundButton classes="accept"
                    label={$t`Start conference`}
                    icon={OpenIcon}
                    iconSize="24px"
                    onClick={accept}
                    border={false} />
                {/if}
              </hbox>
            </DeviceSetup>
          </vbox>
        {/if}
        <hbox flex />
      </hbox>
      <hbox class="bottom-bar" flex>
        <vbox class="info" flex>
          {#if upcomingMeeting}
            <vbox class="upcoming-meeting">
              <hbox class="when">
                <HourglassIcon size="16px" />
                {$t`You have a meeting in ${upcomingMeetingInMin} minutes:`}
              </hbox>
              <hbox class="title">
                {upcomingMeeting.title}
              </hbox>
            </vbox>
          {/if}
        </vbox>
      </hbox>
    </vbox>
    <hbox class="contact-history" slot="second">
      <ContactHistory {person} colorInherit={true} />
    </hbox>
  </SplitterBidirectional>
</vbox>

<svelte:window on:keydown={ev => catchErrors(() => onKeyEnter(ev, accept))} />

{#if $meeting.state == MeetingState.IncomingCall || $meeting.state == MeetingState.OutgoingCall }
  <audio src="sound/ringtone1.mp3" loop autoplay />
{/if}

{#if ($meeting.state == MeetingState.IncomingCall || $meeting.state == MeetingState.OutgoingCall) &&
    $meeting.account.protocol == "sip" }
  <!-- Workaround: sip.js needs the mic to be open when the other party picks up our outgoing call,
    otherwise the call drops immediately after pickup -->
  <vbox class="sip-outgoing-toolbar">
    <InMeetingToolbar {meeting} isSidebar={true} showSidebar={false} />
  </vbox>
{/if}

{#if $appGlobal.isMobile}
  <StartBarM selectedAccount={appGlobal.meetAccounts.first} />
{/if}

<script lang="ts">
  import { MeetingState, type VideoConfMeeting } from "../../../logic/Meet/VideoConfMeeting";
  import { appGlobal } from "../../../logic/app";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import PersonPicture from "../../Contacts/Person/PersonPicture.svelte";
  import GroupPicture from "../../Contacts/Person/GroupPicture.svelte";
  import DeviceSetup from "../Setup/DeviceSetup.svelte";
  import StartBarM from "./StartBarM.svelte";
  import InMeetingToolbar from "../InMeetingToolbar.svelte";
  import ContactHistory from "../../Contacts/History/ContactHistory.svelte";
  import SplitterBidirectional from "../../Shared/SplitterBidirectional.svelte";
  import CallIcon from "lucide-svelte/icons/phone-call";
  import HangUpIcon from "lucide-svelte/icons/phone";
  import XIcon from "lucide-svelte/icons/x";
  import OpenIcon from "lucide-svelte/icons/door-open";
  import HourglassIcon from "lucide-svelte/icons/hourglass";
  import { t } from "../../../l10n/l10n";
  import { onKeyEnter } from "../../Util/util";
  import { catchErrors } from "../../Util/error";
  import { kDummyPerson } from "../../../logic/Abstract/PersonUID";

  export let meeting: VideoConfMeeting;

  $: participants = meeting.participants;
  $: person = $participants.first?.findPerson();
  $: showAvatar = $meeting.state != MeetingState.Init && $meeting.state != MeetingState.JoinConference;
  $: showContactHistory = person && !$meeting.hasVideo && !appGlobal.isMobile;
  let width: number;

  const now = new Date();
  const maxUpcoming = new Date(); // TODO now + 15 min
  maxUpcoming.setMinutes(maxUpcoming.getMinutes() + 15);
  const upcomingMeetings = appGlobal.calendarEvents.filterObservable(event => event.startTime.getTime() > now.getTime() && event.startTime.getTime() < maxUpcoming.getTime());
  $: upcomingMeeting = $upcomingMeetings.first;
  $: upcomingMeetingInMin = upcomingMeeting?.startTime ? Math.floor((upcomingMeeting.startTime.getTime() - new Date().getTime()) / 1000 / 60) : 0;

  async function accept() {
    if (meeting.state == MeetingState.IncomingCall) {
      await meeting.answer();
    } else if (meeting.state == MeetingState.OutgoingCallConfirm) {
      await meeting.call();
    } else if (meeting.state == MeetingState.Init || meeting.state == MeetingState.JoinConference) {
      await meeting.start();
    } else {
      throw new Error("Unknown state. Cannot start the call.");
    }
  }

  async function hangup() {
    await meeting.hangup();
  }
</script>

<style>
  .calling {
    background-color: #494558;
    color: white;
  }
  @media (max-width: 800px) {
    .boxes {
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
  }
  .box,
  .device-setup {
    aspect-ratio: 8/10;
    border-radius: 4px;
    background-color: var(--inverted-bg);
    color: var(--inverted-fg);
  }
  .box {
    min-width: 400px;
    max-width: 400px;
    max-height: 400px;
    padding: 40px;
  }
  .device-setup {
    min-width: 400px;
    max-width: 400px;
    max-height: 440px;
    padding: 20px 0px;
  }
  .text {
    align-items: center;
    justify-content: center;
    margin-block-end: 20px;
  }
  .text .who {
    font-size: 24px;
    font-weight: bold;
  }
  .participants {
    align-items: center;
    justify-content: center;
  }
  .buttons {
    align-items: end;
  }
  .actions {
    margin-block-start: 12px;
  }
  .actions :global(button.action) {
    padding: 16px;
  }
  .actions :global(button.accept svg),
  .actions :global(button.hangup svg) {
    stroke: white;
  }
  .actions :global(.call-person .avatar) {
    margin: -4px 0px;
  }
  .actions :global(button.accept) {
    background-color: #20AF9E;
  }
  .actions :global(button.hangup) {
    background-color: #F34949 !important;
  }
  .actions :global(button.hangup svg) {
    transform: rotate(135deg);
  }
  .mic-setup :global(.buttons) {
    margin-block-start: 14px;
  }
  .device-setup .actions {
    justify-content: center;
    margin-top: 0px;
  }
  .device-setup .actions :global(button) {
    padding: 9px;
  }

  .gap {
    min-width: 10%;
    min-height: 10%;
  }
  .device-setup :global(button.button),
  .device-setup :global(button.button:hover:not(.disabled)) {
    border: 2px solid var(--inverted-bg) !important;
  }
  .device-setup :global(button.border svg path) {
    stroke-width: 1.5px;
  }
  .device-setup :global(.self-video video) {
    width: 100%;
  }

  .bottom-bar {
    justify-content: end;
    align-items: end;
    width: 100%;
  }
  .info {
    justify-content: center;
    align-items: center;
    height: 100%;
  }
  .upcoming-meeting .when {
    justify-content: center;
    align-items: center;
  }
  .upcoming-meeting .title {
    justify-content: center;
    align-items: center;
  }
  .sip-outgoing-toolbar {
    display: none;
  }

  .calling[state="incoming"] .what,
  .calling[state="outgoing"] .what,
  .actions :global(button.hangup:hover),
  .actions :global(button.accept:hover) {
    animation-name: color;
      animation-duration: 0.5s;
      animation-iteration-count: infinite;
      animation-direction: alternate;
      animation-timing-function: ease;
  }
  @keyframes color {
    to {
      opacity: 70%;
    }
  }
  .calling[state="incoming"] .participants,
  .calling[state="outgoing"] .participants {
    animation-name: shake;
      animation-delay: 0.3s;
      animation-duration: 2s;
      animation-iteration-count: infinite;
      animation-direction: alternate;
      animation-timing-function: ease;
  }
  @keyframes shake {
    from {
      margin-inline-start: 3px;
    }
    2% {
      margin-inline-start: -3px;
    }
    4% {
      margin-inline-start: 3px;
    }
    6% {
      margin-inline-start: -3px;
    }
    8% {
      margin-inline-start: 3px;
    }
    10% {
      margin-inline-start: -3px;
    }
    12% {
      margin-inline-start: 3px;
    }
    14% {
      margin-inline-start: 0px;
    }
  }
</style>
