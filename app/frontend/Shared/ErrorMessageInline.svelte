{#if ex}
  <hbox class="error">
    <hbox class="icon">
      <ErrorIcon />
    </hbox>
    <div class="value">
      {console.error(ex), logErrorToServer(ex), ""}
      {ex.message ?? ex + ""}
    </div>
  </hbox>
{/if}

<script lang="ts">
  import { logErrorToServer } from "../Util/error";
  import ErrorIcon from "lucide-svelte/icons/triangle-alert";

  export let ex: Error = null;

  export function showError(error: Error) {
    ex = error;
  }
  export function clearError() {
    ex = null;
  }
</script>

<style>
  .error {
    background-color: #F8FFD2;
    color: #DD0000;
    border: 1px solid #FFC83A;
    border-radius: 8px;
    padding: 8px 12px;
    margin: 8px;
  }
  .icon {
    margin-inline-end: 12px;
  }
</style>
