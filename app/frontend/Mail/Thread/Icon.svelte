{#if icon}
  <image
    href={icon}
    x={x - kRadius}
    y={y - kRadius}
    width={kRadius * 2}
    height={kRadius * 2}
    clip-path="url(#clip-{i})"
    preserveAspectRatio="xMidYMid slice"
  />
{:else}
  <!-- Placeholder letter -->
  <text
    x={x}
    y={y}
    text-anchor="middle"
    dominant-baseline="central"
    font-size={kRadius}
    font-weight="bold"
    fill={color ? "white" : "var(--graph-node-text, #333)"}
    pointer-events="none"
  >{letter}</text>
{/if}

<script lang="ts">
  import { kRadius } from "./GraphLayout";

  export let icon: string | null;
  export let letter: string | null;
  /** Background that the letter sits on. @see Node.color */
  export let color: string | null = null;
  export let x: number;
  export let y: number;
  export let i: number;
</script>
