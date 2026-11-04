<CollapsibleHeader label={account ? $account.name : $t`My Contacts`} {collapsed} on:click />

<script lang="ts">
  import type { Account } from "../../logic/Abstract/Account";
  import CollapsibleHeader from "../Shared/CollapsibleHeader.svelte";
  import { t } from "../../l10n/l10n";

  export let account: Account | null;
  export let collapsed: boolean;
</script>
