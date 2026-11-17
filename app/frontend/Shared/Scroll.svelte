<vbox class="scroll"
  bind:this={containerE}
  on:mousewheel={onScrollWheel}
  on:scroll
  class:hideHorizontalScrollbar>
  <vbox class="inside">
    <slot />
  </vbox>
</vbox>

<script lang="ts">
  export let hideHorizontalScrollbar = false;

  let containerE: HTMLDivElement;
  export function scrollDown() {
    containerE.scrollTop = containerE.scrollHeight;
  }
  export function scrollTo(y: number) {
    containerE.scrollTop = y;
  }

  function onScrollWheel(event: MouseEvent) {
    event.stopPropagation();
  }
</script>

<style>
  .scroll {
    flex: 1 0 0;
    position: relative;
    overflow: auto;
    overflow-wrap: anywhere;
  }
  .scroll.hideHorizontalScrollbar {
    overflow-y: auto;
    overflow-x: hidden;
  }
  .inside {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }
</style>
