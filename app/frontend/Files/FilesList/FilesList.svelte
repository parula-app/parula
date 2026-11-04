<Scroll>
  <grid class="files-list">
    <hbox class="name header">
      {$t`File name`}
      <RoundButton
        label={$t`Sort by file name`}
        selected={sortBy == SortCriteria.Name}
        onClick={() => sortSetting.value = SortCriteria.Name}
        icon={SortDownIcon}
        iconSize="14px" border={false} classes="sort smallest" />
    </hbox>
    <hbox class="type header">
      {$t`File type`}
      <RoundButton
        label={$t`Sort by file type`}
        selected={sortBy == SortCriteria.Type}
        onClick={() => sortSetting.value = SortCriteria.Type}
        icon={SortDownIcon}
        iconSize="14px" border={false} classes="sort smallest" />
    </hbox>
    <hbox class="size header">
      {$t`Size *=> Size of the file`}
      <RoundButton
        label={$t`Sort by size, largest first`}
        selected={sortBy == SortCriteria.Size}
        onClick={() => sortSetting.value = SortCriteria.Size}
        icon={SizeUpIcon}
        iconSize="14px" border={false} classes="sort smallest" />
    </hbox>
    <hbox class="time header">
      {$t`Last mod *=> Last modification time for the file`}
      <RoundButton
        label={$t`Sort by last modification time, latest first`}
        selected={sortBy == SortCriteria.LastMod}
        onClick={() => sortSetting.value = SortCriteria.LastMod}
        icon={SortUpIcon}
        iconSize="14px" border={false} classes="sort smallest" />
    </hbox>

    <FileOrDirLines files={filesSorted} dirs={dirsSorted} />
  </grid>
</Scroll>

<script lang="ts" context="module">
  export enum SortCriteria {
    Name = "name",
    Type = "type",
    Size = "size",
    LastMod = "last-mod",
  }
</script>

<script lang="ts">
  import { File } from "../../../logic/Files/File";
  import { Directory } from "../../../logic/Files/Directory";
  import FileOrDirLines from "./FileOrDirLines.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import Scroll from "../../Shared/Scroll.svelte";
  import SortDownIcon from "lucide-svelte/icons/arrow-down";
  import SortUpIcon from "lucide-svelte/icons/arrow-up";
  import SizeUpIcon from "lucide-svelte/icons/arrow-up-wide-narrow";
  import { getLocalStorage } from "../../Util/LocalStorage";
  import { t } from "../../../l10n/l10n";
  import type { Collection } from "svelte-collections";

  export let files: Collection<File>;
  export let dirs: Collection<Directory>;

  let sortSetting = getLocalStorage("files.sort", SortCriteria.Name);
  $: sortBy = $sortSetting.value;
  $: filesSorted =
    sortBy == SortCriteria.Size ? files.sortBy(file => -file.size) :
    sortBy == SortCriteria.LastMod ? files.sortBy(file => -file.lastMod.getTime()) :
    sortBy == SortCriteria.Type ? files.sortBy(file => file.mimetype ?? file.ext) :
    files.sortBy(file => file.name);
  $: dirsSorted =
    sortBy == SortCriteria.Size ? dirs.sortBy(dir => -(dir.subDirs.length + dir.files.length)) :
    sortBy == SortCriteria.LastMod ? dirs.sortBy(dir => -dir.lastMod.getTime()) :
    dirs.sortBy(dir => dir.name);
</script>

<style>
  .files-list {
    display: grid;
    grid-template-columns: auto max-content max-content max-content;
  }
  .header {
    align-items: center;
    opacity: 50%;
    font-weight: 300;
    padding-inline-start: 8px;
    border-bottom: 1px dotted var(--border);
    border-right: 1px dotted var(--border);
  }
  .time, .size {
    justify-content: end;
  }
  .name {
    padding-inline-start: 16px;
  }
  .time {
    padding-inline-end: 16px;
  }
  .header :global(button.sort) {
    margin-inline-start: 4px;
  }
  .header :global(button.sort.selected) {
    background-color: unset;
    color: unset
  }
  .header:not(:hover) :global(.button.sort:not(.selected)) {
    visibility: hidden;
  }
</style>
