<ContextMenu bind:this={contextMenu}>
  {#if calendar}
    <MenuItem label={$t`Rename Calendar`} icon={RenameIcon}
      onClick={() => renamingCalendar = calendar} />
    {#if CalendarGroups.isShared(calendar) || !calendar.mainAccount}
      <MenuItem label={$t`Delete Calendar`} icon={DeleteIcon}
        onClick={() => CalendarActions.deleteCalendar(calendar)} />
    {/if}
    {#if canShare(calendar)}
      <MenuDivider />
      <SubMenu label={$t`Share *=> Share the selected calendar with other people`} icon={ShareIcon}>
        <MenuItem label={$t`Share Calendar`} icon={ShareIcon}
          onClick={() => $openCalendarProperties = { calendar, tab: "permissions" }} />
        <MenuItem label={$t`Calendar Permissions`} icon={PermissionsIcon}
          onClick={() => $openCalendarProperties = { calendar, tab: "permissions" }} />
      </SubMenu>
    {/if}
    <MenuDivider />
    <SubMenu label={$t`Color *=> Choose the color of the selected calendar`} icon={ColorIcon}>
      <ColorPalette colors={calendarColors()} selected={calendar.color} label={$t`Calendar color`}
        columns={5} on:select={event => catchErrors(async () => { calendar.color = event.detail; await calendar.save(); })} />
    </SubMenu>
    <MenuItem label={$t`Overlay *=> Show the calendars on top of each other`} icon={OverlayIcon} checked={!$splitView.value} checkable
      onClick={toggleOverlay} />
    <MenuItem label={$t`Show Only This Calendar`} icon={ShowOnlyIcon}
      onClick={showOnly} />
    <MenuDivider />
    <MenuItem label={$t`Move Up *=> Move the calendar up in the list`} icon={MoveUpIcon}
      disabled={!groups.canMove(calendar, -1)}
      onClick={() => { order.value = groups.orderAfterMove(calendar, -1); }} />
    <MenuItem label={$t`Move Down *=> Move the calendar down in the list`} icon={MoveDownIcon}
      disabled={!groups.canMove(calendar, 1)}
      onClick={() => { order.value = groups.orderAfterMove(calendar, 1); }} />
    <MenuDivider />
    <MenuItem label={$t`Properties… *=> Show the settings of the selected folder`} icon={PropertiesIcon}
      onClick={() => $openCalendarProperties = { calendar, tab: "general" }} />
  {/if}
</ContextMenu>
{#if renamingCalendar}
  <RenameDialog account={renamingCalendar} title={$t`Rename Calendar`} on:close={() => renamingCalendar = null} />
{/if}

<script lang="ts">
  import type { Calendar } from "../../logic/Calendar/Calendar";
  import { CalendarActions } from "./CalendarActions";
  import { CalendarGroups } from "./CalendarGroups";
  import { selectedCalendar, shownCalendars } from "../../frontend/Calendar/selected";
  import { calendarColors } from "./CalendarColors";
  import { MailAccount } from "../../logic/Mail/MailAccount";
  import { catchErrors } from "../../frontend/Util/error";
  import { openCalendarProperties } from "./selected";
  import ContextMenu from "../Shared/Menu/ContextMenu.svelte";
  import MenuItem from "../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../Shared/Menu/MenuDivider.svelte";
  import SubMenu from "../Shared/Menu/SubMenu.svelte";
  import ColorPalette from "../Shared/ColorPalette.svelte";
  import RenameDialog from "../Settings/Shared/RenameDialog.svelte";
  import RenameIcon from "lucide-svelte/icons/pencil-line";
  import ShowOnlyIcon from "lucide-svelte/icons/eye";
  import ShareIcon from "lucide-svelte/icons/share-2";
  import PermissionsIcon from "lucide-svelte/icons/user-lock";
  import ColorIcon from "lucide-svelte/icons/palette";
  import PropertiesIcon from "lucide-svelte/icons/file-cog";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import MoveUpIcon from "lucide-svelte/icons/arrow-up";
  import OverlayIcon from "lucide-svelte/icons/layers";
  import { getLocalStorage } from "../../frontend/Util/LocalStorage";
  import MoveDownIcon from "lucide-svelte/icons/arrow-down";
  import { appGlobal } from "../../logic/app";
  import { t } from "../../l10n/l10n";

  let contextMenu: ContextMenu;
  let calendar: Calendar | null = null;
  let renamingCalendar: Calendar | null = null;
  let groups: CalendarGroups;
  const splitView = getLocalStorage<boolean>("lookout.calendar.splitView", false);
  const order = getLocalStorage<string[]>("lookout.calendar.order", []);

  function toggleOverlay() {
    splitView.value = !splitView.value;
  }

  // <copied from="CalendarPropertiesDialog.svelte">
  function canShare(calendar: Calendar | null): boolean {
    let account = calendar?.mainAccount;
    return !!calendar?.sharePermissionLevels.length &&
      account instanceof MailAccount && !account.isDependentAccount && account.canShareWithPersons();
  }
  // </copied>

  function showOnly() {
    for (let listedCalendar of appGlobal.calendars.contents) {
      shownCalendars.show(listedCalendar, listedCalendar == calendar);
    }
    $selectedCalendar = calendar;
  }

  export function openFor(event: MouseEvent, forCalendar: Calendar) {
    event.preventDefault();
    calendar = forCalendar;
    groups = new CalendarGroups(appGlobal.calendars.contents, order.value);
    contextMenu.onContextMenu(event);
  }
</script>
