{#if $items.hasItems}
  <RibbonGroup label={$t`Addons`}>
    <AddonButtons {place} {mail} let:item let:onClick>
      <RibbonButtonBase label={item.label} {onClick} {disabled}>
        <span slot="icon" class="addon-ribbon-icon">
          <AddonIcon addon={item.addon} path={item.contribution.icon} size="100%" />
        </span>
      </RibbonButtonBase>
    </AddonButtons>
  </RibbonGroup>
{/if}

<script lang="ts">
  import type { EMail } from "../../logic/Mail/EMail";
  import { addonUIItems } from "../../logic/Addons/AddonUI";
  import AddonButtons from "../../frontend/Addons/AddonButtons.svelte";
  import AddonIcon from "../../frontend/Addons/AddonIcon.svelte";
  import RibbonGroup from "../Shared/Ribbon/RibbonGroup.svelte";
  import RibbonButtonBase from "../Shared/Ribbon/RibbonButtonBase.svelte";
  import { t } from "../../l10n/l10n";

  /** The buttons of the running addons in the ribbon */

  /** "message-toolbar" or "composer-toolbar" */
  export let place: string;
  /** The message that the buttons are for, or the draft */
  export let mail: EMail | null;
  export let disabled: boolean | string = false;

  const items = addonUIItems.filterObservable(item => item.place == place);
</script>

<style>
  .addon-ribbon-icon {
    display: flex;
    width: 100%;
    height: 100%;
  }
</style>
