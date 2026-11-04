{#key mail}
  {#each $items.each as item (item)}
    <slot {item} onClick={event => onClick(item, event)} disabled={!mail}>
      <hbox class="addon-button">
        <Button label={item.label} iconOnly plain disabled={!mail}
          onClick={event => onClick(item, event)}>
          <AddonIcon slot="icon" addon={item.addon} path={item.contribution.icon} size="16px" />
        </Button>
      </hbox>
    </slot>
  {/each}
{/key}
{#if popupItem}
  {#key popupItem}
    <AddonPopup item={popupItem} context={popupContext} anchor={popupAnchor}
      bind:popupOpen onClose={() => popupItem = null} />
  {/key}
{/if}

<script lang="ts">
  import type { EMail } from "../../logic/Mail/EMail";
  import { addonUIItems, type AddonUIItem } from "../../logic/Addons/AddonUI";
  import type { Grant } from "../../logic/Addons/Bridge/Grant";
  import AddonPopup from "./AddonPopup.svelte";
  import AddonIcon from "./AddonIcon.svelte";
  import Button from "../Shared/Button.svelte";
  import { ArrayColl } from "svelte-collections";
  import { onDestroy } from "svelte";

  /** The buttons of the running addons at a toolbar.
   * A click gives the addon the message or draft, until the toolbar shows another one. */

  /** "message-toolbar" or "composer-toolbar" */
  export let place: string;
  /** The message that the toolbar is for, or the draft. null = none. */
  export let mail: EMail | null;

  const items = addonUIItems.filterObservable(item => item.place == place);
  const grants = new ArrayColl<Grant>();
  let grantsMail: EMail | null = null;

  $: args = place == "composer-toolbar" ? { draft: mail } : { messages: [mail] };
  $: onMailChanged(mail);
  function onMailChanged(mail: EMail | null) {
    if (mail == grantsMail) {
      return;
    }
    revokeGrants();
    grantsMail = mail;
    popupOpen = false;
  }

  function revokeGrants() {
    for (let grant of grants) {
      grant.revoke();
    }
    grants.clear();
  }

  let popupItem: AddonUIItem | null = null;
  let popupAnchor: HTMLElement;
  let popupContext: Record<string, object>;
  let popupOpen = false;

  async function onClick(item: AddonUIItem, event: Event) {
    if (item.contribution.popup) {
      let wasOpen = popupOpen && popupItem == item;
      popupOpen = false;
      if (wasOpen) {
        return;
      }
      popupItem = item;
      popupAnchor = (event.target as Element).closest("button");
      popupContext = args;
      popupOpen = true;
      return;
    }
    let grant = item.ui.newGrant(item.groups);
    grants.add(grant);
    await item.ui.runCommand(item, args, grant);
  }

  onDestroy(revokeGrants);
</script>

<style>
  .addon-button {
    margin-inline-start: 2px;
  }
</style>
