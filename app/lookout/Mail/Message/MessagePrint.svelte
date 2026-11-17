{#if message}
  <hbox class="print-host">
    <MessagePrint {message} bind:this={printE} />
  </hbox>
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { printMessage } from "../Selected";
  import MessagePrint from "../../../frontend/Mail/Message/MessagePrint.svelte";
  import { catchErrors } from "../../../frontend/Util/error";
  import { onDestroy, tick } from "svelte";
  import { AppWindow } from "../../../frontend/MainWindow/AppWindow";

  const appWindow = AppWindow.current();

  let message: EMail | null = null;
  let printE: MessagePrint;

  $printMessage = null;
  $: $printMessage && catchErrors(() => print($printMessage));
  async function print(toPrint: EMail) {
    $printMessage = null;
    message = toPrint;
    await tick();
    await toPrint.loadBody();
    await printE.print();
  }
  onDestroy(() => {
    appWindow.uiState(printMessage).set(null);
  });
</script>

<style>
  .print-host {
    position: fixed;
    left: -10000px;
    top: 0;
    width: 800px;
    height: 600px;
  }
</style>
