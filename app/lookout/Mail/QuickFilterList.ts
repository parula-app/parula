import type { EMail } from "../../logic/Mail/EMail";
import type { QuickSearchEMail } from "../../logic/Mail/Store/QuickSearchEMail";
import type { ArrayColl, Collection } from "svelte-collections";

export class QuickFilterList {
  protected criteria: string | null = null;
  protected shown: ArrayColl<EMail> | null = null;

  async filter(search: QuickSearchEMail, selection: Collection<EMail> | null): Promise<ArrayColl<EMail> | null> {
    let matches = await search.startSearch();
    let criteria = matches ? JSON.stringify(search.toJSON()) : null;
    let shown = this.shown;
    if (matches && shown && criteria == this.criteria && selection?.hasItems) {
      let folderMessages = search.folder.messages;
      let kept = selection.contents.filter(message =>
        shown.contains(message) && !matches.contains(message) && folderMessages.contains(message));
      if (kept.length) {
        matches.addAll(kept);
      }
    }
    this.criteria = criteria;
    this.shown = matches;
    return matches;
  }
}
