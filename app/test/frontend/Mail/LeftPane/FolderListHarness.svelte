<!-- Like `LeftPane`, binds the folder list to the `selectedFolder` store,
  which e.g. `openEMailMessage()` also sets -->
<FolderList {folders} bind:selectedFolder={$selectedFolder} bind:selectedFolders />

<script lang="ts">
  import type { Folder } from "../../../../logic/Mail/Folder";
  import { selectedFolder } from "../../../../frontend/Mail/Selected";
  import FolderList from "../../../../frontend/Mail/LeftPane/FolderList.svelte";
  import type { ArrayColl, Collection } from "svelte-collections";

  export let folders: Collection<Folder>;
  let selectedFolders: ArrayColl<Folder>;
</script>
