<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="lo-submenu" class:open={isOpen} bind:this={anchorEl}
  on:keydown={onKeyDown}>
  <MenuItem {label} {icon} {disabled} {tooltip} {classes} hasSubMenu keepOpen onClick={() => open(true)} bind:buttonEl={itemEl} />
  {#if !disabled}
    <div class="submenu-layer" use:moveOutOfParentMenu>
      <Menu bind:isMenuOpen={isOpen} anchor={anchorEl} placement="right-start" isSubMenu
        on:close={() => itemEl?.focus()}>
        <div class="submenu-content" on:click|capture={onClickInside} bind:this={contentEl}>
          <slot />
        </div>
      </Menu>
    </div>
  {/if}
</div>

<script lang="ts">
  import Menu from "./Menu.svelte";
  import MenuItem from "./MenuItem.svelte";
  import { getContext, onDestroy } from "svelte";
  import type { Writable } from "svelte/store";

  export let label: string;
  export let icon: ConstructorOfATypedSvelteComponent = null;
  export let disabled: boolean | string = false;
  export let tooltip: string = null;
  export let classes = "";

  const closeAllMenus = getContext<() => void>("lo-close-all-menus");
  const openSubMenu = getContext<Writable<object>>("lo-open-submenu");
  const mouseInParentMenu = getContext<Writable<MouseEvent>>("lo-menu-mouse");
  const me = {};

  let anchorEl: HTMLElement;
  let itemEl: HTMLButtonElement;
  let contentEl: HTMLElement;
  let isOpen = false;
  let isOpenedByClick = false;
  let closeTimeout: ReturnType<typeof setTimeout> = null;
  let previousMouse: MouseEvent = null;
  $: if ($openSubMenu != me) {
    isOpen = false;
  }
  $: if (!isOpen) {
    onClosed();
  }

  function open(byClick: boolean) {
    if (disabled) {
      return;
    }
    cancelClose();
    isOpenedByClick ||= byClick;
    $openSubMenu = me;
    isOpen = true;
  }

  function onClosed() {
    cancelClose();
    isOpenedByClick = false;
    if ($openSubMenu == me) {
      $openSubMenu = null;
    }
  }

  function cancelClose() {
    clearTimeout(closeTimeout);
    closeTimeout = null;
  }

  $: onMouseInParentMenu($mouseInParentMenu, $openSubMenu);
  function onMouseInParentMenu(mouse: MouseEvent, openOne: object) {
    const kCloseDelay = 300;
    let previous = previousMouse;
    previousMouse = mouse;
    if (!mouse) {
      cancelClose();
      return;
    }
    let item = (mouse.target as HTMLElement).closest(".lo-menu button");
    if (!item) {
      return;
    }
    if (anchorEl.contains(item)) {
      cancelClose();
      if (!openOne) {
        open(false);
      }
      return;
    }
    if (!isOpen || isOpenedByClick) {
      return;
    }
    if (!closeTimeout || isMovingTowardsSubMenu(previous, mouse)) {
      cancelClose();
      closeTimeout = setTimeout(() => isOpen = false, kCloseDelay);
    }
  }

  function isMovingTowardsSubMenu(from: MouseEvent, to: MouseEvent): boolean {
    let rect = contentEl?.getBoundingClientRect();
    if (!from || !rect) {
      return false;
    }
    let moveX = to.clientX - from.clientX;
    let moveY = to.clientY - from.clientY;
    let edgeX = (rect.left >= to.clientX ? rect.left : rect.right) - from.clientX;
    let topY = rect.top - from.clientY;
    let bottomY = rect.bottom - from.clientY;
    let side = Math.sign(edgeX);
    return (moveX != 0 || moveY != 0) &&
      (edgeX * moveY - topY * moveX) * side >= 0 &&
      (moveX * bottomY - moveY * edgeX) * side >= 0;
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key != "ArrowRight" || event.target != itemEl) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    open(true);
  }

  function onClickInside(event: MouseEvent) {
    let target = event.target as HTMLElement;
    if (!target?.closest?.("button.lo-menuitem:not(:disabled), button.menuitem:not(.disabled)") ||
        target.closest(".lo-submenu")) {
      return;
    }
    setTimeout(() => {
      isOpen = false;
      closeAllMenus?.();
    }, 0);
  }

  // The parent menu clips its content, and the popup positioning would then flip the submenu to the left
  /* <copied to="ContextMenu.svelte"> */
  function moveOutOfParentMenu(node: HTMLElement) {
    let target = node.closest("dialog") ?? node.closest(".lookout-window") ?? document.body;
    target.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }
  /* </copied> */

  onDestroy(onClosed);
</script>

<style>
  .lo-submenu {
    display: flex;
    flex-direction: column;
  }
  .lo-submenu.open > :global(.lo-menuitem) {
    background-color: var(--lo-hover-bg);
  }
  .submenu-content {
    display: flex;
    flex-direction: column;
  }
</style>
