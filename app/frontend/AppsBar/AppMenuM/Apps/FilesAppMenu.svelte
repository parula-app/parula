{#if $selectedPerson}
  <CombinedButton
    icon1={filesMustangApp.icon}
    icon2={$selectedPerson.picture ?? PersonIcon}
    page={URLPart`/files/person/${$selectedPerson.id}/files`}
    params={{ person: $selectedPerson }} />
{:else}
  <hbox class="empty" />
{/if}
<!-- TODO list of cloud drives and harddrive, then folders/file list, then file viewer -->
<AccountButton account={myHarddrive} page={acc => URLPart`/files/account/${acc.id}/persons`} defaultIcon={AccountIcon} />

<AppButton app={filesMustangApp} page="/files/" />

<BasicButton icon={SearchIcon} page="/files/search" />
{#if $selectedPerson}
  <BasicButton icon={PlusIcon} page={`/files/person/${$selectedPerson?.id}/upload`} />
{:else}
  <hbox class="empty" />
{/if}

<script lang="ts">
  import { filesMustangApp } from "../../../Files/FilesMustangApp";
  import { myHarddrive } from "../../../../logic/Files/Harddrive/HarddriveAccount";
  import { selectedPerson } from "../../../Contacts/Person/Selected";
  import AccountButton from "../AccountButton.svelte";
  import AppButton from "../AppButton.svelte";
  import CombinedButton from "../CombinedButton.svelte";
  import BasicButton from "../BasicButton.svelte";
  import SearchIcon from "lucide-svelte/icons/search";
  import PersonIcon from "lucide-svelte/icons/user";
  import PlusIcon from "lucide-svelte/icons/plus";
  import AccountIcon from "lucide-svelte/icons/folder-open";
  import { URLPart } from "../../../../logic/util/blob";
</script>
