import type { FileOrDirectory } from "../../logic/Files/FileOrDirectory";
import type { File } from "../../logic/Files/File";
import type { Directory } from "../../logic/Files/Directory";
import type { FileSharingAccount } from "../../logic/Files/FileSharingAccount";
import type { WebAppListed } from "../../logic/WebApps/WebAppListed";
import { isDemo } from "../AppsBar/demo";
import { FilesView } from "./LeftPane/PaneViewSwitcher.svelte";
import { AppWindow } from "../MainWindow/AppWindow";
import { writable, type Writable, get } from "svelte/store";
import { ArrayColl } from "svelte-collections";
import { appGlobal } from "../../logic/app";

export let selectedFile: Writable<FileOrDirectory> = AppWindow.perWindow(() => writable(null));
export let selectedFiles = AppWindow.perWindow(() => new ArrayColl<FileOrDirectory>());
export let selectedFolder: Writable<Directory> = AppWindow.perWindow(() => writable(null));
export let selectedAccount: Writable<FileSharingAccount> = AppWindow.perWindow(() => writable(null));
export let selectedLeftTab: Writable<FilesView> = AppWindow.perWindow(() => writable(appGlobal.fileSharingAccounts.hasItems ? FilesView.CloudStorage : FilesView.Person));

/** If set, this file will be display as on the right pane, full page.
 * Only for some supported file types.
 * Will override the other UI. Normally null. */
export let viewFile: Writable<File> = AppWindow.perWindow(() => writable(null));
/** Web app to use for opening `$viewFile`.
 * null = preview */
export let fileViewer: Writable<WebAppListed | null> = AppWindow.perWindow(() => writable(null));
export let isRightSidebarExpanded: Writable<boolean> = AppWindow.perWindow(() => writable(true));
