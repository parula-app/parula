<OptionsPage icon={PeopleIcon} description={$t`Change how you work with your contacts`}>
  <ContactsImportExport account={$selectedAddressbook ?? $addressbooks.first} />
</OptionsPage>

<script lang="ts">
  import { appGlobal } from "../../../logic/app";
  import { selectedAddressbook } from "../../Contacts/Person/Selected";
  import OptionsPage from "../Shared/OptionsPage.svelte";
  import ContactsImportExport from "./ImportExport.svelte";
  import PeopleIcon from "lucide-svelte/icons/users";
  import { t } from "../../../l10n/l10n";

  const addressbooks = appGlobal.addressbooks;
</script>
