<vbox class="avatar" style="width: var(--person-picture-size, {size}px); height: var(--person-picture-size, {size}px);">
  {#if picture}
    <img
      src={picture}
      width={size} height={size}
      title={$t`Picture of ${person.name}`}
      alt=""
      class:broken-image={isBroken}
      on:error={() => isBroken = true}
      />
  {:else if placeholder == "slot"}
    <slot name="placeholder" />
  {:else if placeholder == "icon"}
    <Icon data={contactsIcon} size="{size}px" />
  {:else if placeholder == "empty"}
    <hbox class="placeholder" />
  {/if}
</vbox>

<script lang="ts">
  import type { PersonOrGroup } from "./PersonOrGroup";
  import type { ChatPersonUID } from "../../../logic/Chat/ChatPersonUID";
  import contactsIcon from '../../asset/icon/appBar/contacts.svg?raw';
  import Icon from "../../Shared/Icon.svelte";
  import { t } from "../../../l10n/l10n";

  export let person: PersonOrGroup | ChatPersonUID;
  export let size = 48;
  export let placeholder: "none" | "empty" | "icon" | "slot" = "none";

  let isBroken = false;
  $: picture = $person?.picture;
  $: picture, isBroken = false;
</script>

<style>
  .avatar {
    /*margin: 7px 12px; -- Breaks mobile app menu, bottom left button, when a contact is selected */
    clip-path: circle();
  }
  .placeholder {
    width: 100%;
    height: 100%;
    border: 1px solid var(--border);
    border-radius: 1000px;
  }
  .avatar img {
    width: 100%;
    height: 100%;
  }
  .avatar .broken-image {
    visibility: hidden;
  }
</style>
