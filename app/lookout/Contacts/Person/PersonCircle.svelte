<vbox class="person-circle" style:width="{size}px" style:height="{size}px" {title}>
  {#if picture && !isBroken}
    <img src={picture} width={size} height={size} alt="" on:error={() => isBroken = true} />
  {:else}
    <hbox class="initials"
      style:background-color={color}
      style:font-size="{Math.round(size * 0.4)}px">
      {#if isGroup}
        <GroupIcon size={Math.round(size * 0.5)} />
      {:else if initials}
        {initials}
      {:else}
        <PersonIcon size={Math.round(size * 0.5)} />
      {/if}
    </hbox>
  {/if}
</vbox>

<script lang="ts">
  import { consistentColor } from "../../../logic/Abstract/personColor";
  import { getInitials } from "../../Shared/Person/Initials";
  import GroupIcon from "lucide-svelte/icons/users-round";
  import PersonIcon from "lucide-svelte/icons/user-round";

  export let name: string;
  export let picture: string = null;
  export let colorKey: string = null;
  export let isGroup = false;
  export let size = 40;
  export let title: string = null;

  let isBroken = false;
  $: picture, isBroken = false;
  $: initials = getInitials(name);
  $: color = colorKey || name ? consistentColor(colorKey || name) : null;
</script>

<style>
  .person-circle {
    flex-shrink: 0;
    border-radius: 50%;
    overflow: hidden;
  }
  img {
    object-fit: cover;
  }
  .initials {
    flex: 1;
    align-items: center;
    justify-content: center;
    background-color: var(--lo-fg-secondary);
    color: #FFFFFF;
    font-weight: 600;
    line-height: 1;
    user-select: none;
  }
</style>
