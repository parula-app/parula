<hbox class="link" class:not-found={!link.target}>
  <Clickable onClick={onOpen} disabled={!link.target}>
    <hbox class="target">
      <svelte:component this={icon} size="16px" />
      <hbox class="name">{link.name}</hbox>
      {#if link.date}
        <hbox class="date font-small">{getDateTimeString(link.date)}</hbox>
      {/if}
    </hbox>
  </Clickable>
  <Button plain
    label={$t`Remove from topic`}
    icon={RemoveIcon}
    iconOnly
    onClick={() => link.topic.removeLink(link)}
    />
</hbox>

<script lang="ts">
  import { TopicLinkType, type TopicLink } from "../../../logic/Topic/Link/TopicLink";
  import { Person } from "../../../logic/Abstract/Person";
  import { Event } from "../../../logic/Calendar/Event";
  import { ChatMessage } from "../../../logic/Chat/ChatMessage";
  import { openPersonFromOtherApp } from "../../Contacts/open";
  import { openEvent } from "../../Calendar/open";
  import { openChatRoomFromOtherApp } from "../../Chat/open";
  import Clickable from "../../Shared/Clickable.svelte";
  import Button from "../../Shared/Button.svelte";
  import PersonIcon from "lucide-svelte/icons/user-round";
  import EventIcon from "lucide-svelte/icons/calendar";
  import ChatIcon from "lucide-svelte/icons/message-circle";
  import EMailIcon from "lucide-svelte/icons/mail";
  import FileIcon from "lucide-svelte/icons/file";
  import RemoveIcon from "lucide-svelte/icons/x";
  import { getDateTimeString } from "../../../logic/util/date";
  import { t } from "../../../l10n/l10n";

  /** A link to a contact, event or chat message, or a link whose target we did not find */
  export let link: TopicLink;

  const kIcons: Record<TopicLinkType, ConstructorOfATypedSvelteComponent> = {
    [TopicLinkType.Person]: PersonIcon,
    [TopicLinkType.Event]: EventIcon,
    [TopicLinkType.ChatMessage]: ChatIcon,
    [TopicLinkType.EMail]: EMailIcon,
    [TopicLinkType.File]: FileIcon,
  };
  $: icon = kIcons[link.type];

  function onOpen() {
    let target = link.target;
    if (target instanceof Person) {
      openPersonFromOtherApp(target);
    } else if (target instanceof Event) {
      openEvent(target, false);
    } else if (target instanceof ChatMessage) {
      openChatRoomFromOtherApp(target.room);
    }
  }
</script>

<style>
  .link {
    align-items: center;
  }
  .link > :global(:first-child) {
    flex: 1;
    min-width: 0;
  }
  .target {
    align-items: center;
    gap: 8px;
    padding-block: 4px;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .date {
    opacity: 60%;
  }
  .not-found {
    opacity: 60%;
  }
</style>
