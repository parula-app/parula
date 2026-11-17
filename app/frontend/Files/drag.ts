import type { File } from "../../logic/Files/File";
import type { Directory } from "../../logic/Files/Directory";
import { selectedFile, selectedFiles } from "./selected";
import { appGlobal } from "../../logic/app";
import { assert } from "../../logic/util/util";
import { gt } from "../../l10n/l10n";
import { ArrayColl } from "svelte-collections";
import { get } from "svelte/store";

export async function onDragStartFile(event: DragEvent, file: File) {
  selectedFile.set(file);
  // #if [!WEBMAIL && !MOBILE]
  if (file.filepathLocal) {
    event.preventDefault();
    await appGlobal.remoteApp.startDrag(file.filepathLocal);
    return;
  }
  // #endif
  let files = get(selectedFiles);
  if (files.contains(file)) {
    event.dataTransfer.setData("file/drag-ids", files.contents.map(f => f.id).join(","));
  } else {
    event.dataTransfer.setData("file/drag-ids", file.id);
  }
  event.dataTransfer.effectAllowed = "copyMove";
}

export async function onDropFile(event: DragEvent, folder: Directory) {
  event.preventDefault();
  event.stopPropagation();
  let file = get(selectedFile);
  let fileIDsStr = event.dataTransfer.getData("file/drag-ids");
  let osFiles = event.dataTransfer.files;
  // #if [!WEBMAIL && !MOBILE]
  // The OS drag from `onDragStartFile()`, dropped back into our app
  if (osFiles.length == 1 && file?.filepathLocal &&
      (window as any).electron.webUtils.getPathForFile(osFiles[0]) == file.filepathLocal) {
    fileIDsStr = file.id;
  }
  // #endif
  if (!fileIDsStr && osFiles.length) {
    // <copied from="MainPane/FilesHeader.svelte">
    for (let fileBlob of osFiles) {
      let ourFile = folder.newFile(fileBlob.name);
      ourFile.fromBrowserFile(fileBlob);
      await folder.addFile(ourFile);
    }
    // </copied>
    return;
  }
  if (!file || !fileIDsStr || file.parent == folder) {
    return;
  }
  let fileIDs = fileIDsStr.split(",");
  let messages = get(selectedFiles).contents;
  if (fileIDs.length == 0) {
    return;
  } else if (fileIDs.length == 1) {
    assert(fileIDs[0] == file.id, gt`Drag&drop failed: Selected file ID doesn't match the drag data`);
    messages = [ file ];
  } else {
    assert(messages.every(msg => fileIDs.includes(msg.id)), gt`Drag&drop failed: Selected file IDs don't match the drag data`);
  }
  if (event.ctrlKey || event.metaKey) {
    await folder.copyFilesHere(new ArrayColl(messages));
  } else {
    await folder.moveFilesHere(new ArrayColl(messages));
  }
}

export async function onDragOverFile(event: DragEvent, folder: Directory) {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) {
    event.dataTransfer.dropEffect = "copy";
  }
}
