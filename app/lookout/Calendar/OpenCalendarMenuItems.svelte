<MenuItem label={$t`From Address Book… *=> Open the calendar of a person from the address book`} icon={AddressBookIcon}
  disabled={!sharingAccounts.length && $t`None of your accounts can open the calendars of colleagues`}
  onClick={() => $openSharedCalendar = { fromAddressBook: true }} />
<MenuItem label={$t`Open Shared Calendar…`} icon={SharedCalendarIcon}
  disabled={!sharingAccounts.length && $t`None of your accounts can open the calendars of colleagues`}
  onClick={() => $openSharedCalendar = { fromAddressBook: false }} />
<MenuItem label={$t`Create New Blank Calendar…`} icon={NewCalendarIcon}
  onClick={() => openSettingsDialog({ kind: "new-folder-account", folderKind: "calendar", localOnly: true })} />
<MenuDivider />
<MenuItem label={$t`New Calendar Account…`} icon={NewAccountIcon}
  onClick={() => openSettingsDialog({ kind: "new-folder-account", folderKind: "calendar" })} />

<script lang="ts">
  import { openSettingsDialog } from "../Settings/SettingsDialogs";
  import { openSharedCalendar } from "./OpenCalendarDialog.svelte";
  import { appGlobal } from "../../logic/app";
  import MenuItem from "../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../Shared/Menu/MenuDivider.svelte";
  import AddressBookIcon from "lucide-svelte/icons/book-user";
  import SharedCalendarIcon from "lucide-svelte/icons/users-round";
  import NewAccountIcon from "lucide-svelte/icons/calendar-cog";
  import NewCalendarIcon from "lucide-svelte/icons/calendar-plus-2";
  import { t } from "../../l10n/l10n";

  const emailAccounts = appGlobal.emailAccounts;
  $: sharingAccounts = $emailAccounts.contents.filter(account => !account.isDependentAccount && account.canShareWithPersons());
</script>
