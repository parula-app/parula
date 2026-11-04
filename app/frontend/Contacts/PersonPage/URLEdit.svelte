<input type="url" bind:value={value} on:change={() => value = urlWithScheme(value.trim())} size={40} maxlength={200} />

<script lang="ts">
  import { urlWithScheme } from "../../../logic/util/netUtil";

  export let value: string; /* in/out */
</script>
