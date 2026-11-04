import type { Folder } from "../../../logic/Mail/Folder";
import type { ArrangeBy } from "../3pane/MessageGrouping";
import { viewSettingsOf, changeViewSettings, type ViewSettings } from "./ViewSettings";

export function arrangeFolderBy(folder: Folder | null, field: ArrangeBy) {
  let settings = viewSettingsOf(folder);
  let changes: Partial<ViewSettings> = { arrangeBy: field };
  if (settings.arrangeBy != field) {
    changes.reverseSort = false;
  }
  changeViewSettings(folder, changes);
}

export function sortFolderByColumn(folder: Folder | null, field: ArrangeBy) {
  let settings = viewSettingsOf(folder);
  if (settings.arrangeBy == field) {
    changeViewSettings(folder, { reverseSort: !settings.reverseSort });
  } else {
    changeViewSettings(folder, { arrangeBy: field, reverseSort: false });
  }
}
