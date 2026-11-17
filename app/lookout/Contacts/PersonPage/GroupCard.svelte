<vbox flex class="group-card">
  <hbox class="header">
    <PersonPicture person={group} size={72} />
    <vbox class="title">
      <h1 class="name">{$group.name || $t`(No name)`}</h1>
      <hbox class="kind">{$t`Contact group`}</hbox>
      {#if $group.description}
        <hbox class="description">{$group.description}</hbox>
      {/if}
      <hbox class="actions">
        <CardButton label={$t`Email *=> Write an email to the contact`} icon={MailIcon}
          onClick={() => ContactActions.writeMail([group])}
          disabled={!hasEmailAddress && $t`No member has an email address`} />
        <CardButton label={$t`Meeting`} icon={MeetingIcon} hasMenu={$shownCalendars.length > 1}
          onClick={event => newEventMenu.openMenu(event.currentTarget as HTMLElement, calendar => ContactActions.newMeeting([group], calendar))}
          disabled={!hasEmailAddress && $t`No member has an email address`} />
        <CardButton label={$t`Edit`} icon={EditIcon}
          onClick={() => ContactActions.edit(group)} />
      </hbox>
    </vbox>
  </hbox>

  <vbox flex class="members">
    <h2>{$t`Members *=> Members of the contact group`} <span class="count">{$members.length}</span></h2>
    {#each $members.each as member (member.id)}
      <GroupMemberLine person={member} />
    {:else}
      <hbox class="no-members">{$t`This group has no members yet`}</hbox>
    {/each}
  </vbox>
</vbox>
<NewEventCalendarMenu bind:this={newEventMenu} />

<script lang="ts">
  import type { Group } from "../../../logic/Abstract/Group";
  import { ContactActions } from "../ContactActions";
  import PersonPicture from "../Person/PersonPicture.svelte";
  import CardButton from "./CardButton.svelte";
  import NewEventCalendarMenu from "../../Calendar/NewEventCalendarMenu.svelte";
  import { shownCalendars } from "../../../frontend/Calendar/selected";
  import GroupMemberLine from "./GroupMemberLine.svelte";
  import MailIcon from "lucide-svelte/icons/mail";
  import MeetingIcon from "lucide-svelte/icons/calendar-plus";
  import EditIcon from "lucide-svelte/icons/square-pen";
  import { t } from "../../../l10n/l10n";

  export let group: Group;

  let newEventMenu: NewEventCalendarMenu;

  $: members = group.participants;
  $: hasEmailAddress = ContactActions.hasEmailAddress($members.contents);
</script>

<style>
  .group-card {
    min-height: 0;
  }
  .header {
    align-items: start;
    gap: 20px;
    padding: 24px 24px 20px 24px;
    border-block-end: 1px solid var(--lo-divider);
  }
  .title {
    min-width: 0;
  }
  .name {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .kind,
  .description {
    color: var(--lo-fg-secondary);
  }
  .actions {
    flex-wrap: wrap;
    gap: 8px;
    margin-block-start: 14px;
  }
  .members {
    min-height: 0;
    overflow-y: auto;
    padding: 16px;
  }
  h2 {
    margin: 0 8px 8px 8px;
    font-size: 15px;
    font-weight: 600;
  }
  .count {
    margin-inline-start: 4px;
    font-weight: normal;
    color: var(--lo-fg-secondary);
  }
  .no-members {
    margin: 8px;
    color: var(--lo-fg-secondary);
  }
</style>
