import type { Folder } from "../../../logic/Mail/Folder";
import { ArrangeBy } from "../3pane/MessageGrouping";
import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
import { derived, type Readable } from "svelte/store";
import { gt } from "../../../l10n/l10n";

export enum ViewType {
  Compact = "compact",
  Single = "single",
  Preview = "preview",
}

export enum Column {
  Importance = "importance",
  Icon = "icon",
  Attachment = "attachment",
  From = "from",
  To = "to",
  Subject = "subject",
  Received = "received",
  Sent = "sent",
  Size = "size",
  Categories = "categories",
  Flag = "flag",
  Folder = "folder",
}

export enum ApplyScope {
  ThisFolder = "folder",
  AllFolders = "all",
}

export interface ViewSettings {
  type: ViewType;
  columns: Column[];
  columnWidths: Partial<Record<Column, number>>;
  arrangeBy: ArrangeBy;
  reverseSort: boolean;
  showInGroups: boolean;
  groupBy: ArrangeBy | null;
  groupReverse: boolean;
  previewLines: number;
  tighterSpacing: boolean;
  showAsConversations: boolean;
  showSendersAboveSubject: boolean;
  alwaysExpandSelected: boolean;
  classicIndented: boolean;
  useCompactLayout: boolean;
  compactLayoutChars: number;
}

export class ColumnInfo {
  readonly id: Column;
  readonly label: string;
  readonly width: number;
  readonly isIcon: boolean;
  readonly sortField: ArrangeBy | null;

  constructor(id: Column, label: string, width: number, isIcon: boolean, sortField: ArrangeBy | null) {
    this.id = id;
    this.label = label;
    this.width = width;
    this.isIcon = isIcon;
    this.sortField = sortField;
  }

  static readonly all: ColumnInfo[] = [
    new ColumnInfo(Column.Importance, gt`Importance *=> Importance of the email`, 24, true, ArrangeBy.Importance),
    new ColumnInfo(Column.Icon, gt`Icon *=> Column with an icon for the type and state of the email`, 24, true, null),
    new ColumnInfo(Column.Attachment, gt`Attachment`, 24, true, null),
    new ColumnInfo(Column.From, gt`From`, 160, false, ArrangeBy.From),
    new ColumnInfo(Column.To, gt`To`, 160, false, null),
    new ColumnInfo(Column.Subject, gt`Subject`, 0, false, ArrangeBy.Subject),
    new ColumnInfo(Column.Received, gt`Received *=> Date when the email was received`, 132, false, ArrangeBy.Date),
    new ColumnInfo(Column.Sent, gt`Sent`, 132, false, ArrangeBy.Date),
    new ColumnInfo(Column.Size, gt`Size *=> Size of the file`, 72, false, ArrangeBy.Size),
    new ColumnInfo(Column.Categories, gt`Categories *=> Categories of the email`, 104, false, null),
    new ColumnInfo(Column.Flag, gt`Flag Status`, 28, true, ArrangeBy.Flag),
    new ColumnInfo(Column.Folder, gt`In Folder *=> Column with the folder that contains the item`, 120, false, null),
  ];

  static of(id: Column): ColumnInfo | null {
    return ColumnInfo.all.find(column => column.id == id) ?? null;
  }

  static labelOf(id: Column): string {
    return ColumnInfo.of(id)?.label ?? id;
  }

  get isFlexible(): boolean {
    return this.width == 0;
  }
}

export function arrangeFields(): { id: ArrangeBy, label: string, button: string }[] {
  return [
    { id: ArrangeBy.Date, label: gt`Date`, button: gt`By Date` },
    { id: ArrangeBy.From, label: gt`From`, button: gt`By From` },
    { id: ArrangeBy.Subject, label: gt`Subject`, button: gt`By Subject` },
    { id: ArrangeBy.Size, label: gt`Size *=> Size of the file`, button: gt`By Size` },
    { id: ArrangeBy.Importance, label: gt`Importance *=> Importance of the email`, button: gt`By Importance` },
    { id: ArrangeBy.Flag, label: gt`Flag Status`, button: gt`By Flag Status` },
  ];
}

export function arrangeFieldLabel(field: ArrangeBy | null): string {
  return arrangeFields().find(candidate => candidate.id == field)?.label ?? gt`None *=> No field chosen for grouping or sorting`;
}

export const allFoldersView = getLocalStorage<Partial<ViewSettings>>("lookout.mail.view", {});
export const folderViews = getLocalStorage<Record<string, Partial<ViewSettings>>>("lookout.mail.folderViews", {});

export function defaultViewSettings(): ViewSettings {
  return {
    type: ViewType.Compact,
    columns: defaultColumns(),
    columnWidths: {},
    arrangeBy: ArrangeBy.Date,
    reverseSort: false,
    showInGroups: true,
    groupBy: null,
    groupReverse: false,
    previewLines: 1,
    tighterSpacing: false,
    showAsConversations: false,
    showSendersAboveSubject: true,
    alwaysExpandSelected: false,
    classicIndented: false,
    useCompactLayout: true,
    compactLayoutChars: 100,
  };
}

export function shownViewType(view: ViewSettings, listWidth: number, charWidth: number): ViewType {
  if (view.type != ViewType.Compact && view.useCompactLayout &&
      listWidth > 0 && listWidth < view.compactLayoutChars * charWidth) {
    return ViewType.Compact;
  }
  return view.type;
}

export function defaultColumns(): Column[] {
  return [
    Column.Importance,
    Column.Icon,
    Column.Attachment,
    Column.From,
    Column.Subject,
    Column.Received,
    Column.Size,
    Column.Categories,
    Column.Flag,
  ];
}

export function viewSettingsKey(folder: Folder | null): string {
  return folder ? folder.account?.id + "/" + folder.id : "none";
}

export function viewSettingsOf(folder: Folder | null): ViewSettings {
  let forFolder = folderViews.value?.[viewSettingsKey(folder)];
  return { ...defaultViewSettings(), ...allFoldersView.value, ...forFolder };
}

export function viewSettingsStore(folder: Folder | null): Readable<ViewSettings> {
  return derived([allFoldersView, folderViews], () => viewSettingsOf(folder));
}

export function changeViewSettings(folder: Folder | null, changes: Partial<ViewSettings>, scope = ApplyScope.ThisFolder) {
  if (scope == ApplyScope.AllFolders) {
    changeAllFolders(changes);
    return;
  }
  let all = { ...folderViews.value };
  let key = viewSettingsKey(folder);
  all[key] = { ...all[key], ...changes };
  folderViews.value = all;
}

function changeAllFolders(changes: Partial<ViewSettings>) {
  allFoldersView.value = { ...allFoldersView.value, ...changes };
  let all: Record<string, Partial<ViewSettings>> = {};
  for (let [key, settings] of Object.entries(folderViews.value ?? {})) {
    let remaining = { ...settings };
    for (let name of Object.keys(changes)) {
      delete remaining[name];
    }
    if (Object.keys(remaining).length) {
      all[key] = remaining;
    }
  }
  folderViews.value = all;
}

export function resetViewSettings(folder: Folder | null) {
  allFoldersView.value = {};
  let all = { ...folderViews.value };
  delete all[viewSettingsKey(folder)];
  folderViews.value = all;
}

export function replaceViewSettings(folder: Folder | null, settings: ViewSettings) {
  let all = { ...folderViews.value };
  all[viewSettingsKey(folder)] = differences(settings, { ...defaultViewSettings(), ...allFoldersView.value });
  folderViews.value = all;
}

export function applyViewSettingsToFolders(from: Folder | null, targets: Folder[]) {
  let settings = viewSettingsOf(from);
  let all = { ...folderViews.value };
  let base = { ...defaultViewSettings(), ...allFoldersView.value };
  for (let target of targets) {
    all[viewSettingsKey(target)] = differences(settings, base);
  }
  folderViews.value = all;
}

function differences(settings: ViewSettings, base: ViewSettings): Partial<ViewSettings> {
  let result: Partial<ViewSettings> = {};
  for (let [name, value] of Object.entries(settings)) {
    if (JSON.stringify(value) != JSON.stringify(base[name])) {
      result[name] = value;
    }
  }
  return result;
}

export function viewTypeLabel(type: ViewType): string {
  switch (type) {
    case ViewType.Single:
      return gt`Single *=> View with one line per email, in columns`;
    case ViewType.Preview:
      return gt`Preview`;
    default:
      return gt`Compact *=> View with sender, subject and preview in a narrow list`;
  }
}

export function columnWidthOf(settings: ViewSettings, column: Column): number {
  return settings.columnWidths?.[column] ?? ColumnInfo.of(column)?.width ?? 100;
}
