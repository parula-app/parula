<vbox class="colors buttons">
  {#each Object.keys(cssVars) as cssVar}
    {@const label = cssVars[cssVar]}
    <grid class="color-setting">
      <hbox class="label">{label}</hbox>
      <input type="color"
        bind:value={colors[cssVar]}
        on:change={() => onSet(cssVar)}
        />
      <Button
        label={$t`Clear`}
        icon={XIcon}
        iconSize="16px"
        plain
        onClick={() => onClear(cssVar)}
        disabled={!colors[cssVar]}
        />
    </grid>
  {/each}
</vbox>

<script lang="ts">
  import { getLocalStorage } from "../../Util/LocalStorage";
  import Button from "../../Shared/Button.svelte";
  import XIcon from "lucide-svelte/icons/x";
  import { t } from "../../../l10n/l10n";

  let themeSetting = getLocalStorage("appearance.theme", "system");
  let colorsSetting = getLocalStorage("appearance.colors", {});
  $: colors = $colorsSetting.value as Record<string, string>;

  /**
   * Defines which colors (css vars) the user can modify.
   *
   * Key: The CSS var in `app.css` `:root {`
   * Value: User-readable label for the key.
   *
   * List only the "-bg" CSS var.
   * The corresponding "-fg" will be set automatically to the contrast color.
   */
  const cssVars = {
    "bg": $t`Background`,
    "main-bg": $t`Center`,
    "leftbar-bg": $t`Left bar`,
    "appbar-bg": $t`App bar`,
    "selected-bg": $t`Selection`,
  };

  function onSet(cssVar: string) {
    if (cssVar.endsWith("bg")) {
      let color = colors[cssVar];

      // Set text color as contrast color
      let fgVar = cssVar.substring(0, cssVar.length - 2) + "fg";
      let textColor = colors[fgVar] = contrastTextColor(color);

      // adapt light/dark mode
      if (cssVar == "bg") {
        let dark = textColor == "#ffffff";
        themeSetting.value = dark ? "dark" : "light";
      }

      // adapt hover
      if (cssVar == "selected-bg") {
        colors["hover-bg"] = color + "80";
        colors["selected-hover-bg"] = color + "DD"
        colors["hover-fg"] = textColor;
        colors["selected-hover-fg"] = textColor;
      }
    }
    colorsSetting.value = colors;
  }

  function onClear(cssVar: string) {
    if (!colors) {
      return;
    }
    colors[cssVar] = undefined;
    colorsSetting.value = colors;
  }

  /**
   * @param hex a background color, as HTML hex with `#`
   * @returns either black or white,
   *   depending on what gives the best contrast,
   *   as HTML hex with `#`
   */
  function contrastTextColor(hex: string): "#ffffff" | "#000000" {
      let h = hex.replace(/^#/, "");
      let r = parseInt(h.slice(0, 2), 16);
      let g = parseInt(h.slice(2, 4), 16);
      let b = parseInt(h.slice(4, 6), 16);
      let yiq = (r * 299 + g * 587 + b * 114) / 1000;
      return yiq >= 128 ? "#000000" : "#ffffff";
  }
</script>

<style>
  grid.color-setting {
    grid-template-columns: 10em auto auto 1fr;
    gap: 24px;
  }
</style>
