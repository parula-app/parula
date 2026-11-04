<button class="activity" class:unread={email && !$email.isRead}
  title={tooltip} on:click={() => catchErrors(open)}>
  <hbox class="icon">
    {#if email}
      <svelte:component this={$email.isRead ? ReadIcon : UnreadIcon} size={16} />
    {:else if file}
      <FileIcon size={16} />
    {:else}
      <MeetingIcon size={16} />
    {/if}
  </hbox>
  <vbox class="text">
    {#if email}
      <hbox class="first-line">
        <span class="primary">{email.from?.name || email.from?.emailAddress || ""}</span>
        <span class="date">{getListDateString(time)}</span>
      </hbox>
      <span class="subject">{$email.subject || $t`(No subject)`}</span>
      {#if preview}
        <span class="secondary">{preview}</span>
      {/if}
    {:else if file}
      <hbox class="first-line">
        <span class="primary">{file.name ?? ""}</span>
        <span class="date">{getListDateString(time)}</span>
      </hbox>
      <span class="secondary">{file.size ? fileSize(file.size) : ""}</span>
    {:else if event}
      <hbox class="first-line">
        <span class="primary">{$event.title || $t`(No title)`}</span>
        <span class="date">{eventDate}</span>
      </hbox>
      {#if $event.location}
        <span class="secondary">{$event.location}</span>
      {/if}
    {/if}
  </vbox>
</button>

<script lang="ts">
  import { EMail } from "../../../logic/Mail/EMail";
  import { Event } from "../../../logic/Calendar/Event";
  import { File } from "../../../logic/Files/File";
  import type { LogEntry } from "../../../logic/Contacts/History/History";
  import { ContactActivities } from "./ContactActivities";
  import { getListDateString, getFullDateString } from "../../Mail/3pane/MessageDates";
  import { fileSize } from "../../../frontend/Files/file";
  import { catchErrors } from "../../../frontend/Util/error";
  import { openEMailMessage } from "../../../frontend/Mail/open";
  import { openEvent } from "../../../frontend/Calendar/open";
  import UnreadIcon from "lucide-svelte/icons/mail";
  import ReadIcon from "lucide-svelte/icons/mail-open";
  import FileIcon from "lucide-svelte/icons/file";
  import MeetingIcon from "lucide-svelte/icons/calendar";
  import { getDateTimeLocale, t } from "../../../l10n/l10n";

  export let message: LogEntry;

  $: email = message instanceof EMail ? message : null;
  $: file = message instanceof File ? message : null;
  $: event = message instanceof Event ? message : null;
  $: time = ContactActivities.timeOf(message);
  $: preview = message instanceof EMail ? (message.text ?? "").replace(/\s+/g, " ").trim().substring(0, 200) : "";
  $: eventDate = message instanceof Event && message.startTime
    ? message.startTime.toLocaleString(getDateTimeLocale(), message.allDay
      ? { weekday: "short", year: "numeric", month: "numeric", day: "numeric" }
      : { weekday: "short", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "";
  $: tooltip = message instanceof EMail ? `${message.subject ?? ""}\n${getFullDateString(time)}`
    : message instanceof Event ? `${message.title ?? ""}\n${eventDate}`
    : message instanceof File ? `${message.name ?? ""}\n${getFullDateString(time)}`
    : "";

  async function open() {
    if (message instanceof EMail) {
      await openEMailMessage(message);
    } else if (message instanceof File) {
      await message.openOSApp();
    } else if (message instanceof Event) {
      openEvent(message, true);
    }
  }
</script>

<style>
  .activity {
    display: flex;
    align-items: start;
    gap: 10px;
    width: 100%;
    padding: 8px;
    border: none;
    border-radius: 4px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .activity:hover {
    background-color: var(--lo-hover-bg);
  }
  .activity:focus-visible {
    outline: 2px solid var(--lo-focus-ring);
    outline-offset: -2px;
  }
  .icon {
    flex: none;
    margin-block-start: 2px;
    color: var(--lo-fg-secondary);
  }
  .text {
    flex: 1 1 0;
    min-width: 0;
    gap: 1px;
  }
  .first-line {
    align-items: baseline;
    gap: 8px;
  }
  .primary {
    flex: 1 1 0;
    min-width: 0;
  }
  .primary,
  .subject,
  .secondary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .date {
    flex: none;
    font-size: var(--lo-font-size-small);
    color: var(--lo-fg-secondary);
  }
  .secondary {
    font-size: var(--lo-font-size-small);
    color: var(--lo-fg-secondary);
  }
  .unread .primary,
  .unread .subject {
    font-weight: 600;
  }
  .unread .subject {
    color: var(--lo-accent-text);
  }
</style>
