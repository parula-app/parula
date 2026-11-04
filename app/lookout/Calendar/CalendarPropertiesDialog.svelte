<Dialog title={$t`${calendar.name} Properties`}
  okLabel={$t`OK`}
  okDisabled={!name.trim() && $t`Enter a name for the calendar`}
  onOK={onOK}
  width="560px"
  height="560px"
  on:close>
  <vbox class="properties">
    <DialogTabs {tabs} bind:selected={tab} />
    {#if tab == "permissions"}
      <CalendarPermissionsTab {calendar} />
    {:else}
      <vbox class="general">
        <hbox class="name-row">
          <span class="calendar-icon" style:--calendar-color={color}>
            <CalendarIcon size="24" />
          </span>
          <input type="text" class="lo-text-field name" bind:value={name} aria-label={$t`Name`} />
        </hbox>
        <hbox class="divider" />
        <div class="facts">
          <span class="label">{$t`Type *=> Type of the folder`}</span>
          <span>{$t`Folder containing Calendar Items`}</span>
          <span class="label">{$t`Location *=> Where the calendar or address book is stored`}</span>
          <span>{location}</span>
          {#if owner}
            <span class="label">{$t`Owner *=> Person who owns the calendar`}</span>
            <span>{owner}</span>
          {/if}
        </div>
        <hbox class="divider" />
        <vbox class="color-group">
          <span class="label">{$t`Color *=> Color of the calendar`}</span>
          <ColorPalette colors={calendarColors()} bind:selected={color} label={$t`Color *=> Color of the calendar`} columns={15} />
        </vbox>
        {#if isShared || !calendar.mainAccount}
          <hbox class="divider" />
          <hbox class="delete-row">
            <span class="lo-secondary">{isShared
              ? $t`This is the calendar of another person. You can remove it from this app.`
              : $t`You added this calendar yourself. You can remove it from this app.`}</span>
            <DialogButton label={$t`Delete Calendar`} icon={DeleteIcon} onClick={onDelete} />
          </hbox>
        {/if}
      </vbox>
    {/if}
  </vbox>
</Dialog>

<script lang="ts" context="module">
  import type { Calendar } from "../../logic/Calendar/Calendar";
  import { writable } from "svelte/store";

  export type CalendarPropertiesTab = "general" | "permissions";
  export const openCalendarProperties = writable<{ calendar: Calendar, tab: CalendarPropertiesTab } | null>(null);
</script>

<script lang="ts">
  import { MailAccount } from "../../logic/Mail/MailAccount";
  import { calendarColors } from "./CalendarColors";
  import { CalendarGroups } from "./CalendarGroups";
  import { CalendarActions } from "./CalendarActions";
  import Dialog from "../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../Shared/Dialog/DialogButton.svelte";
  import DialogTabs from "../Shared/Dialog/DialogTabs.svelte";
  import ColorPalette from "../Shared/ColorPalette.svelte";
  import CalendarPermissionsTab from "./CalendarPermissionsTab.svelte";
  import CalendarIcon from "lucide-svelte/icons/calendar";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../l10n/l10n";

  export let calendar: Calendar;
  export let tab: CalendarPropertiesTab = "general";

  const dispatch = createEventDispatcher<{ close: void }>();

  let name = calendar.name;
  let color = calendar.color;

  $: tabs = [
    { id: "general", label: $t`General` },
    ...(canShare(calendar) ? [ { id: "permissions", label: $t`Permissions *=> Who can access this folder` } ] : []),
  ];
  $: if (!tabs.some(listed => listed.id == tab)) {
    tab = "general";
  }
  $: isShared = CalendarGroups.isShared(calendar);
  $: location = calendar.mainAccount?.name ?? calendar.name;
  $: owner = isShared ? calendar.username : null;

  // <copied to="CalendarMenu.svelte, CalendarRibbon.svelte">
  function canShare(calendar: Calendar | null): boolean {
    let account = calendar?.mainAccount;
    return !!calendar?.sharePermissionLevels.length &&
      account instanceof MailAccount && !account.isDependentAccount && account.canShareWithPersons();
  }
  // </copied>

  async function onOK() {
    let trimmed = name.trim();
    if (trimmed == calendar.name && color == calendar.color) {
      return;
    }
    calendar.name = trimmed;
    calendar.color = color;
    await calendar.save();
  }

  async function onDelete() {
    if (await CalendarActions.deleteCalendar(calendar)) {
      dispatch("close");
    }
  }
</script>

<style>
  .properties {
    gap: 16px;
    min-height: 0;
  }
  .general {
    gap: 16px;
  }
  .name-row {
    align-items: center;
    gap: 12px;
  }
  .calendar-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: var(--lo-radius-small);
    background-color: color-mix(in srgb, var(--calendar-color) 22%, var(--lo-pane-bg));
    color: var(--calendar-color);
  }
  .name {
    flex: 1 1 auto;
    min-width: 0;
  }
  .divider {
    height: 1px;
    background-color: var(--lo-divider);
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 8px 16px;
  }
  .label {
    color: var(--lo-fg-secondary);
  }
  .color-group {
    gap: 4px;
  }
  .color-group :global(.color-palette) {
    padding: 4px 0;
  }
  .delete-row {
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .delete-row :global(button) {
    flex-shrink: 0;
  }
</style>
