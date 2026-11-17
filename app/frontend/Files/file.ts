import { File } from '../../logic/Files/File';
import { viewFile, fileViewer } from './selected';
import type { WebAppListed } from '../../logic/WebApps/WebAppListed';
import { kSupportedExt as kHTMLExt } from './Thumbnail/HTMLThumbnail.svelte';
import { kSupportedExt as kPDFExt } from './Thumbnail/PDFThumbnail.svelte';
import { kSupportedExt as kOfficeExt } from './Thumbnail/OfficeThumbnail.svelte';
import { kSupportedExt as kImageExt } from './Thumbnail/ImageThumbnail.svelte';
import { kSupportedExt as kVideoExt } from './Thumbnail/VideoThumbnail.svelte';
import { kSupportedExt as kAudioExt } from './Thumbnail/AudioThumbnail.svelte';
import { getUILocale } from '../../l10n/l10n';
import { assert } from '../../logic/util/util';
import prettyBytes from 'pretty-bytes';

export function fileSize(sizeInBytes: number) {
  return prettyBytes(sizeInBytes, {
    binary: true,
    locale: getUILocale(),
    maximumFractionDigits: 0,
  }).replace("i", "");
}

/** Open file as preview */
export async function openPreview(file: File) {
  fileViewer.set(null);
  viewFile.set(file);
}

/** Open file in preferred web app from cloud provider
 * @param viewer null = preferred */
export async function openFileInCloudApp(file: File, viewer: WebAppListed | null = null) {
  fileViewer.set(viewer ?? await file.preferredOnlineEditor());
  viewFile.set(file);
}

/** Open file in preferred app for file type, either local or cloud */
export async function openFileInDefaultApp(file: File) {
  assert(file instanceof File, "Need file");
  if (["text/html", "application/pdf", "text/plain"].includes(file.mimetype) || kImageExt.includes(file.ext)) {
    await openPreview(file);
    return;
  }
  // Open web app from cloud provider
  let editor = await file.preferredOnlineEditor();
  if (editor) {
    await openFileInCloudApp(file, editor);
    return;
  }
  // Open native desktop app
  await file.openOSApp();
}

export const kPreviewExt = [...kHTMLExt, ...kOfficeExt, ...kImageExt, ...kVideoExt, ...kAudioExt];

export function canShowPreview(file: File) {
  if (!file) {
    return false;
  }
  return kPreviewExt.includes(file.ext);
}
