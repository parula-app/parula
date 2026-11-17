<svg
  width={width}
  height={height}
  xmlns="http://www.w3.org/2000/svg"
>
  <defs>
    {#each positions as p, i}
      {#if p.node.icon}
        <clipPath id="clip-{i}">
          <circle cx={p.x} cy={p.y} r={kRadius} />
        </clipPath>
      {/if}
    {/each}
  </defs>

  <!-- Edges drawn first, underneath nodes -->
  {#each edges as e}
    <path
      d={e.d}
      fill="none"
      stroke={e.isBold ? "var(--graph-bold-color, #19916F)" : "var(--graph-edge-color, #A8D5CD)"}
      stroke-width={e.isBold ? kBoldBorderWidth : kNormalBorderWidth}
      stroke-linecap="round"
    />
  {/each}

  <!-- Nodes -->
  {#each positions as p, i}
    {@const isFocus = p.node.isFocus}
    {@const isBold = p.node.isBold && !isFocus}

    <g class="node" class:focus={isFocus} class:clickable={!!onSelect}
      role={onSelect ? "button" : "img"}
      tabindex={onSelect ? 0 : null}
      aria-label={p.node.name}
      on:click={() => onSelect?.(p.node)}
      on:keydown={event => selectOnKey(event, p.node)}
      >
      <title>{p.node.name}</title>

      <!-- Focus outer ring -->
      {#if isFocus}
        <circle
          cx={p.x}
          cy={p.y}
          r={kRadius + kFocusGapWidth + kFocusRingWidth / 2}
          fill="none"
          stroke="var(--graph-focus-ring-color, #160C27)"
          stroke-width={kFocusRingWidth}
        />
      {/if}

      <!-- Node background circle -->
      <circle
        cx={p.x}
        cy={p.y}
        r={kRadius}
        fill={p.node.color ?? "var(--graph-node-bg, #E8E8F0)"}
        stroke={isBold ? "var(--graph-bold-color, #19916F)" : "none"}
        stroke-width={kBoldBorderWidth}
      />

      <Icon
        icon={p.node.icon}
        letter={p.node.placeholder ? p.node.placeholder[0].toUpperCase() : "?"}
        color={p.node.color}
        x={p.x} y={p.y} {i} />

      {#if p.node.isStarred}
        <StarIcon size={kStarSize} color="orange" fill="orange"
          x={p.x + kRadius * kDiagonal - kStarSize / 2}
          y={p.y - kRadius * kDiagonal - kStarSize / 2} />
      {/if}
    </g>

    <!-- Replies that are nested too deeply to show -->
    {#if p.hiddenReplies}
      <text
        x={horizontal ? p.x : p.x + kRadius + 3}
        y={horizontal ? p.y + kRadius + 3 : p.y}
        text-anchor={horizontal ? "middle" : "start"}
        dominant-baseline="central"
        font-size={kRadius * 0.7}
        fill="var(--graph-node-text, #333)"
      >+{p.hiddenReplies}</text>
    {/if}
  {/each}
</svg>

<script lang="ts">
  import type { Node } from "./Node";
  import { computeLayout, kRadius } from "./GraphLayout";
  import Icon from "./Icon.svelte";
  import StarIcon from "lucide-svelte/icons/star";

  export let root: Node;
  /** The discussion runs to the right and replies are indented downwards (mobile),
   * instead of the other way around (desktop) */
  export let horizontal = false;
  /** Called when the user clicks a node. When null, the graph is not clickable. */
  export let onSelect: ((node: Node) => void) | null = null;

  const kFocusGapWidth = 3;
  const kFocusRingWidth = 4;
  const kBoldBorderWidth = 3;
  const kNormalBorderWidth = 1.5;
  const kStarSize = 12;
  /** Puts the star on the upper right of the circle */
  const kDiagonal = Math.SQRT1_2;

  $: ({ positions, edges, width, height } = computeLayout(root, horizontal));

  function selectOnKey(event: KeyboardEvent, node: Node) {
    if (event.key == "Enter" || event.key == " ") {
      event.preventDefault();
      onSelect?.(node);
    }
  }
</script>

<style>
  .node.clickable {
    cursor: pointer;
  }
  .node:focus-visible {
    outline: 2px solid var(--graph-focus-ring-color, #160C27);
    outline-offset: 2px;
  }
</style>
