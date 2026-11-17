<input type="file"
  bind:this={inputFileEl}
  bind:files
  {multiple}
  accept={acceptFileTypes.join(",")}
  on:change={onFileSelected}
  on:cancel={onCancel}
  />

<script lang="ts">
  import { tick } from "svelte";

  export let acceptFileTypes: string[] = ["*"];

  let files: FileList;
  let multiple = false;

  let doneFunc: (returnValue: File[]) => void;
  export async function selectFile(): Promise<File | null> {
    let files = await selectFiles(false);
    let file = files?.[0];
    if (!file) {
      return null;
    }
    return file;
  }

  export async function selectFiles(aMultiple = true): Promise<File[] | null> {
    multiple = aMultiple;
    await tick();
    inputFileEl.click();
    return new Promise(resolve => {
      doneFunc = resolve;
    });
  }

  function onFileSelected() {
    if (!files.length) {
      doneFunc(null);
      return;
    }
    let filesArray = [...files];
    doneFunc(filesArray);
  }

  function onCancel() {
    doneFunc(null);
    return;
  }

  let inputFileEl: HTMLInputElement;
</script>

<style>
  input {
    display: none;
  }
</style>
