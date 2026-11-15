<!-- If space is short, cuts off the start, but always shows the base domain in full.
  The parent must be a flex container, and may contain other flex items, e.g. the name,
  which then shrink together with the start of the email address. -->
<span class="email-address" class:unknown={isUnknown}
  >{#if withBrackets}<span class="fixed">&lt;</span>{/if}<span class="start">{parts.start}</span
  ><span class="base-domain">{parts.baseDomain}</span
  >{#if withBrackets}<span class="fixed">&gt;</span>{/if}</span>

<script lang="ts">
  import { splitAtBaseDomain } from "./EMailAddressParts";

  export let emailAddress: string;
  /** Not in the address book. Emphasizes the base domain. */
  export let isUnknown = false;
  /** Shows `<fred@example.com>` */
  export let withBrackets = false;

  $: parts = splitAtBaseDomain(emailAddress);
</script>

<style>
  .email-address {
    /* The parts are flex items of the parent, so that they can shrink together with the name */
    display: contents;
  }
  .start {
    flex: 0 1 auto;
    min-width: 1em; /* Leave room for the ellipsis, so that it's clear that something is cut off */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .base-domain,
  .fixed {
    flex: none;
    white-space: nowrap;
  }
  .unknown .base-domain {
    font-weight: bold;
  }
</style>
