{#each $items.each as item, index (item)}
  <slot {item} {index} onClick={event => onClick(item, event)}>
    <MenuItem label={item.label} onClick={event => onClick(item, event)}>
      <AddonIcon slot="icon" addon={item.addon} path={item.contribution.icon} size="16px" />
    </MenuItem>
  </slot>
{/each}

<script lang="ts">
  import type { EMail } from "../../logic/Mail/EMail";
  import { addonUIItems, type AddonUIItem } from "../../logic/Addons/AddonUI";
  import AddonPopup from "./AddonPopup.svelte";
  import AddonIcon from "./AddonIcon.svelte";
  import MenuItem from "../Shared/Menu/MenuItem.svelte";
  import { UserError } from "../../logic/util/util";
  import { mount, unmount } from "svelte";
  import { t } from "../../l10n/l10n";

  /** The menu items of the running addons for messages.
   * A click gives the addon these messages, until its command finished or its popup closed. */

  /** The messages that the menu is for */
  export let messages: EMail[];

  const items = addonUIItems.filterObservable(item => item.place == "message-menu");

  async function onClick(item: AddonUIItem, event: Event) {
    const kMaxMessages = 1000;
    if (messages.length > kMaxMessages) {
      throw new UserError($t`Please select at most ${kMaxMessages} messages for ${item.label}`);
    }
    let args = { messages };
    if (item.contribution.popup) {
      // The menu closes on the click, so the popup lives outside of it, where the menu item was
      let menuItemE = (event.target as Element).closest("button");
      let rect = menuItemE.getBoundingClientRect();
      let popup = mount(AddonPopup, {
        target: menuItemE.closest(".main-window") ?? document.body,
        props: {
          item,
          context: args,
          anchor: { getBoundingClientRect: () => rect },
          popupOpen: true,
          onClose: () => setTimeout(() => unmount(popup)),
        },
      });
      return;
    }
    let grant = item.ui.newGrant(item.groups);
    try {
      await item.ui.runCommand(item, args, grant);
    } finally {
      grant.revoke();
    }
  }
</script>
