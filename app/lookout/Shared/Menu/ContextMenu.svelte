<div class="context-menu">
  <div class="context-menu-layer" use:moveOutOfRow>
    <Menu bind:isMenuOpen anchor={pointerAnchor} placement="right-start">
      <slot />
    </Menu>
  </div>
</div>

<script lang="ts">
  import Menu from "./Menu.svelte";

  export let isMenuOpen = false;

  let pointerAnchor: HTMLElement;
  export function onContextMenu(event: MouseEvent) {
    let pointer = new DOMRect(event.clientX, event.clientY, 0, 0);
    pointerAnchor = {
      getBoundingClientRect: () => pointer,
    } as HTMLElement;
    isMenuOpen = true;
  }

  // Rows can be stacking contexts that paint over the menu, and they would get the menu's pointer and key events
  /* <copied from="SubMenu.svelte"> */
  function moveOutOfRow(node: HTMLElement) {
    let target = node.closest("dialog") ?? node.closest(".lookout-window") ?? node.ownerDocument.body;
    target.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }
  /* </copied> */
</script>

<style>
  .context-menu {
    display: contents;
  }
</style>
