<hbox class="fast-list"
  on:scroll={onScrollThrottled}
  on:keydown={event => onKey(event)}
  tabindex={0}
  bind:this={listE}>
  <vbox class="canvas" style="height: {heightY}px;">
    <grid style="grid-template-columns: {columns}; top: {renderStartPosY}px;">
      <div class="header" bind:this={headerE}>
        <slot name="header" />
      </div>
      <div class="content" bind:this={contentE}>
        {#each renderItems as item, i}
          <div class="row"
            class:selected={$selectedItems.includes(item)}
            class:odd={(renderStartPos + i) % 2 == 1}
            on:click={event => onSelectElement(item, event)}>
            <slot name="row" {item} />
          </div>
        {/each}
      </div>
    </grid>
  </vbox>
</hbox>

<script lang="ts">
  /**
  There are many HTML tree widget implementations out there, but most fail when you start
  pushing 100000 entries in there. The problem is that most create a DOM nodes for
  every line and cell, and once you get to a million DOM nodes, that's a noticeable
  load time and costs RAM. For email, we need to render folders with tens of thousands
  and a hundred thousand emails.

  This is a "fast list". The demo is loading 100000 entries on load, and you can add 100000
  more in fractions of a second. You will notice that the addition is very fast. Millions of rows work.
  Scrolling is very fast. Scrolling should work both using the scroll bar and using the mouse wheel.

  We don't create DOM nodes for every row, but only for the visible rows, e.g. only 10 or so.
  The data is in a pure data array. When the user scrolls, we do not move or destroy DOM nodes,
  but merely replace their text content and leave the nodes in place.

  We listen to mouse wheel scroll events, and scroll correspondingly.
  The scroll bar at the right is a dummy element, and we set the inner height of it to the
  calculated height in px that the rows would have, if all rows would be DOM nodes.
  Then we listen to scroll events, and translate them to corresponding row content changes.

  You're not limited to a single line per row, and you can have rich HTML content in each cell.
  However, the number of columns must be the same for every row / entry.

  Try it out at https://benbucksch.github.io/trex/fastlist-test.html (non-Svelte DOM version)

  TODO:
  * alignment
  */

  import { Collection, CollectionObserver, ArrayColl } from "svelte-collections"
  import { catchErrors } from "../Util/error";
  import throttle from "lodash/throttle";
  import { onMount, tick } from "svelte";
  import { createEventDispatcher } from 'svelte';
  const dispatchEvent = createEventDispatcher<{
    init: { scrollToIndex: (index: number) => void, scrollToItem: (item: T) => void },
    selected: T,
  }>();

  type T = $$Generic;

  /**
   * The items to display in the list.
   */
  export let items: Collection<T> = new ArrayColl<T>();

  /** grid-template-columns: */
  export let columns: string = "auto";

  /**
   * The list items that the user selected,
   * e.g. by clicking on them.
   * This is usually just one element,
   * unless the user used multiple selection, e.g. using the SHIFT key.
   *
   * This collection object is always the same.
   * You can be notified of changes in the selection using
   * the normal collection observers.
   *
   * @see also selectedItem
   *
   * out only
   * `let`, not `const`: Svelte 5 nulls a bound readonly export on destroy.
   */
  export let selectedItems = new ArrayColl<T>();

  /**
   * The list item that the user selected,
   * e.g. by clicking on it.
   * Unlike selecteditems, this is always returns just one element.
   *
   * in/out
   */
  export let selectedItem: T = null;

  /** When the `selectedItems` are removed from `items`,
   * select the items which was in their place in the list.
   * When the caller replaces `items` with another list, e.g. a filtered one,
   * nothing else gets selected. */
  export let ensureSelection = true;

  /** Whether the list is scrolled all the way to the top
   * out only */
  export let isAtTop = false;

  let listE: HTMLDivElement;
  let headerE: HTMLDivElement;
  let contentE: HTMLDivElement;
  /** The `items` that the `init` event was dispatched for */
  let initDoneForItems: Collection<T> = null;

  $: headerHeight = headerE?.firstChild?.offsetHeight ?? 10;

  /**
   * Height of the DOM elements for a single row.
   * {integer} in px
   */
  let rowHeight = 10;

  /** First visible row
   * Set by `onScroll()`
   * {integer} index position in entries */
  let showStartPos = 0;

  /** How many rows are actually visible on the screen, without scroll */
  let showRows = 1;

  /** How many invisible rows to create DOM cells for. Avoids empty lines while scrolling.
   * 1 = 100% overdraw in each direction, i.e.
   * renders 3 times as many rows as are visible: 100% above, and 100% below. */
  const overdrawFactor = 1;

  /** First row to create DOM cells for.
   * {integer} index position in entries */
  $: renderStartPos = Math.max(showStartPos - showRows * overdrawFactor, 0);
  $: renderItems = $items.getIndexRange(renderStartPos, showRows + showRows * overdrawFactor * 2) as T[];
  /** Number of pixels *above* the first rendered row
   * {integer} px */
  $: renderStartPosY = Math.max(Math.floor(renderStartPos * rowHeight), 0);
  $: isAtTop = showStartPos == 0;

  /**
   * Number of pixels of all rows, including invisible ones.
   * {integer} px
   */
  $: heightY = $items.length * rowHeight + headerHeight || 100;

  $: $items.hasItems && listE && catchErrors(updateSize);

  //$: console.log("items", $items.length, "header height", headerHeight, "rowHeight", rowHeight, "heightY", heightY, "startPosY", startPosY, "startPos", startPos);

  /**
   * Call this when either the number of entries changes,
   * or the DOM size of <fastlist> changes.
   * Updates the DOM elements with the rows.
   */
  async function updateSize() {
    try {
      if (items.isEmpty) {
        return;
      }
      await tick();
      let contentRow = contentE?.firstElementChild?.firstElementChild as HTMLElement;
      if (!contentRow) {
        return;
      }
      //console.log("size", "contentrow", contentRow.offsetHeight, "list", listE.offsetHeight, "header", headerE.offsetHeight);
      rowHeight = contentRow.offsetHeight;
      let availableHeight = listE.offsetHeight - headerE.offsetHeight;

      showRows = Math.ceil(availableHeight / rowHeight);
      //console.log("size", "contentrow", contentRow.offsetHeight, "list", listE.offsetHeight, "header", headerE.offsetHeight, "rowheight", rowHeight, "available", availableHeight, " showrows", showRows);
      if (initDoneForItems != items) {
        // Dispatching on every item change would yank the view back to the selected row
        initDoneForItems = items;
        dispatchEvent("init", { scrollToIndex: scrollIntoView, scrollToItem: scrollItemIntoView });
      }
    } catch (ex) {
      console.error(ex);
    }
  }

  const updateSizeThrottled = throttle(updateSize, 30);
  const resizeObserver = new ResizeObserver(updateSizeThrottled);

  onMount(() => {
    resizeObserver.observe(listE);
    return onDestroy;
  });

  function onDestroy() {
    resizeObserver.disconnect();
    updateSizeThrottled.cancel();
    onScrollThrottled.cancel();
  }

  function onKey(event: KeyboardEvent) {
    // https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values
    // Do allow Ctrl/Shift, so that we can expand selection with keyboard
    if (event.key == "ArrowDown" || event.key == "ArrowUp" ||
        event.key == "PageDown" || event.key == "PageUp" ||
        event.key == "Home" || event.key == "End") {
      event.stopPropagation();
      event.preventDefault();
      let lastItem = selectedItems.last || selectedItem;
      let oldIndex = lastItem ? items.contents.findIndex(item => item == lastItem) : 0;
      let newIndex = oldIndex;
      if (event.key == "ArrowDown") {
        newIndex++;
      } else if (event.key == "ArrowUp") {
        newIndex--;
      } else if (event.key == "PageDown") {
        newIndex += showRows;
      } else if (event.key == "PageUp") {
        newIndex -= showRows;
      } else if (event.key == "Home") {
        newIndex = 0;
      } else if (event.key == "End") {
        newIndex = items.length - 1;
      }
      if (newIndex < 0) {
        newIndex = 0;
      } else if (newIndex >= items.length) {
        newIndex = items.length - 1;
      }
      let newElement = items.getIndex(newIndex);
      if (!newElement) {
        return;
      }
      /*if (event.shiftKey) {
        let startIndex = oldIndex < newIndex ? oldIndex : newIndex;
        let length = Math.abs(newIndex - oldIndex) + 1;
        console.log("from", startIndex, "len", length);
        selectedItems.addAll(items.getIndexRange(startIndex, length));
      } else */ if (event.ctrlKey || event.shiftKey) {
        selectedItems.add(newElement);
      } else {
        selectedItems.clear();
        selectedItems.add(newElement);
      }
      scrollIntoView(newIndex);
    }

    if ((event.ctrlKey || event.altKey) && !event.shiftKey && !event.altKey) {
      if (event.key == "a") {
        selectedItems.clear();
        selectedItems.addAll(items);
        // Keep selectedItem as-is
        event.preventDefault();
        event.stopPropagation();
      }
    }
  }

  function scrollIntoView(index: number) {
    let indexMinY = index * rowHeight + headerHeight;
    let indexMaxY = indexMinY + rowHeight - listE.clientHeight;
    if (indexMinY < listE.scrollTop) {
      listE.scrollTop = indexMinY;
    } else if (indexMaxY > listE.scrollTop) {
      listE.scrollTop = indexMaxY;
    }
  }

  function scrollItemIntoView(item: T) {
    if (!item) {
      return;
    }
    let index = items.contents.indexOf(item);
    if (index <= 0) {
      return;
    }
    scrollIntoView(index);
  }

  const onScrollThrottled = throttle(onScroll, 10);
  function onScroll() {
    let topY = listE.scrollTop - headerHeight;
    let startPosCalc = Math.floor(topY / rowHeight);
    showStartPos = Math.max(Math.min(startPosCalc, items.length - showRows), 0);
    //console.log("startpos", showStartPos, "top y", topY, "scrolltop", listE.scrollTop, "rowheight", rowHeight);
  }

  function onSelectElement(clickedItem: T, event: MouseEvent) {
    if (event.shiftKey) { // select whole range
      let firstItem = selectedItems.first;
      let lastItem = clickedItem;
      let itemsArray = new ArrayColl(items);
      let firstItemIndex = itemsArray.getKeyForValue(firstItem);
      let lastItemIndex = itemsArray.getKeyForValue(lastItem);
      selectedItems.clear();
      selectedItems.add(firstItem); // Should stay first, to be the anchor for later operations
      if (firstItemIndex == lastItemIndex) {
        // Only this
      } else if (firstItemIndex < lastItemIndex) {
        selectedItems.addAll(itemsArray.getIndexRange(firstItemIndex + 1, lastItemIndex - firstItemIndex));
      } else { // User selected bottom -> top
        selectedItems.addAll(itemsArray.getIndexRange(lastItemIndex, firstItemIndex - lastItemIndex));
      }
    } else if (event.ctrlKey) { // add to current selection
      if (selectedItems.contains(clickedItem)) {
        selectedItems.remove(clickedItem);
      } else {
        selectedItems.add(clickedItem);
      }
    } else { // no modifier, i.e. a simple single-selection click
      selectedItems.clear();
      selectedItems.add(clickedItem);
      dispatchEvent("selected", clickedItem);
    }
  }

  /** If the selected items were removed from the list,
   * adapt the selectedItems and implicitly selectedItem. */
  $: $items && replaceSelectedItem();
  let previousItems: Collection<T> = null;
  function replaceSelectedItem() {
    // Before the first `selectedItems` change, else the caller misses it. Repeats are no-ops.
    selectedItems.registerObserver(singleSelectionObserver);
    if (!ensureSelection) {
      return;
    }
    let isSameList = items == previousItems;
    previousItems = items;
    let wantedItem = selectedItem; // `removeAll()` below clears it
    if (selectedItems.isEmpty) {
      if (items.includes(wantedItem)) { // The caller selected it before the items arrived
        selectedItems.add(wantedItem);
      }
      return;
    }
    selectedItems.removeAll(selectedItems.filterOnce(a => !items.includes(a)));
    if (selectedItems.isEmpty) {
      let newItem = items.includes(wantedItem)
        ? wantedItem
        : isSameList
          ? items.getIndex(lastSelectedIndex) ?? items.first
          : null;
      if (!newItem) {
        return;
      }
      selectedItems.add(newItem);
    }
  }
  $: lastSelectedIndex = ensureSelection ? getLastSelectedIndex(items, selectedItem) : -1;
  function getLastSelectedIndex(coll: Collection<T>, item: T) {
    return coll.contents.findIndex(a => a == item);
  }

  /**
   * Convenience class which returns just the first selected item
   */
  class SingleSelectionObserver<T> extends CollectionObserver<T> {
    added(_items: T[], selectedItems: Collection<T>) {
      this.onSelectedItem(selectedItems.first);
    }
    removed(_items: T[], selectedItems: Collection<T>) {
      this.onSelectedItem(selectedItems.isEmpty ? null : selectedItems.first);
    }
    /**
     * Called when the selected item changed
     * @param selectedItem
     *      null, if no item is selected
     */
    onSelectedItem(selectedItem?: T) {
      throw "implement this";
    }
  }

  const singleSelectionObserver = new SingleSelectionObserver<T>();
  singleSelectionObserver.onSelectedItem = (item: T) => {
    selectedItem = item;
  };
</script>

<style>
  .fast-list {
    position: relative;
    flex: 1 0 0;
    overflow-y: scroll;
    overflow-x: hidden;
  }
  grid {
    width: 100%;
    height: auto;
    position: absolute;
    top: 0px; /* overridden by scrolling code */
    left: 0px;
  }
  .header {
    display: contents;
  }
  .header :global(> *) {
    padding: 2px 5px;
  }
  .content {
    display: contents;
  }
  .row {
    display: contents;
  }
  .row :global(> *) {
    overflow: hidden;
    padding: 0px 5px; /* TODO vertical padding triggers a bug in the size calculation */
  }
  .fast-list::-webkit-scrollbar-thumb {
    min-height: 60px;
  }
  /* 3D style
  .header :global(> *) {
    border-top: 1px solid white;
    border-left: 1px solid white;
    border-right: 1px solid #8E8EA1;
    border-bottom: 1px solid #8E8EA1;
    background-color: #D2D2DC;
  }
  .header :global(> *:hover) {
    background-color: #E5E5F7;
  }
  */
</style>
