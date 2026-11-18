<vbox class="addon-permissions">
  {#each $permissions.each as permission}
    {@const description = describe(permission)}
    {#if description}
      <hbox class="permission" class:risky={description.risky}>
        <hbox class="icon">
          {#if description.risky}
            <RiskyIcon size="16px" />
          {:else}
            <PermissionIcon size="16px" />
          {/if}
        </hbox>
        <div class="label">{description.label}</div>
      </hbox>
    {/if}
  {/each}
</vbox>

<script lang="ts">
  import { addonPermissions } from "../../../logic/Addons/Permissions";
  import type { Collection } from "svelte-collections";
  import RiskyIcon from "lucide-svelte/icons/triangle-alert";
  import PermissionIcon from "lucide-svelte/icons/dot";
  import { t } from "../../../l10n/l10n";

  /** Permission IDs and hosts, one line each */
  export let permissions: Collection<string>;

  function describe(permission: string): { label: string, risky: boolean } | null {
    if (permission.startsWith("https://")) {
      return { label: $t`Connect to ${permission}`, risky: false };
    }
    let addonPermission = addonPermissions.get(permission);
    if (!addonPermission) {
      return null;
    }
    return { label: addonPermission.label, risky: addonPermission.risky };
  }
</script>

<style>
  .addon-permissions {
    gap: 4px;
  }
  .permission {
    align-items: center;
    min-width: 0;
  }
  .icon {
    flex: none;
    margin-inline-end: 8px;
  }
  .label {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .risky .label {
    font-weight: bold;
  }
  .risky .icon {
    color: #DD0000;
  }
  @media (prefers-color-scheme: dark) {
    .risky .icon {
      color: #FF3333;
    }
  }
  :global(.lookout-window) .risky .icon {
    color: var(--lo-warning);
  }
</style>
