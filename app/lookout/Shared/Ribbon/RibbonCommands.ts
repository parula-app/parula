export interface RibbonCommandEntry {
  label: string;
  tooltip: string;
  tabLabel: string;
  groupLabel: string;
  iconHTML: string;
  disabled: boolean;
  el: HTMLElement;
}

export function searchRibbonCommands<T extends Pick<RibbonCommandEntry, "label" | "tooltip" | "groupLabel" | "tabLabel">>(entries: T[], searchTerm: string, max = 10): T[] {
  let term = searchTerm?.trim().toLowerCase();
  if (!term) {
    return [];
  }
  let scored = entries
    .map((entry, index) => ({ entry, index, score: scoreRibbonCommand(entry, term) }))
    .filter(scoredEntry => scoredEntry.score > 0);
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  let labels = new Set<string>();
  let results: T[] = [];
  for (let { entry } of scored) {
    let key = entry.label.toLowerCase();
    if (labels.has(key)) {
      continue;
    }
    labels.add(key);
    results.push(entry);
    if (results.length >= max) {
      break;
    }
  }
  return results;
}

function scoreRibbonCommand(entry: Pick<RibbonCommandEntry, "label" | "tooltip" | "groupLabel" | "tabLabel">, term: string): number {
  let label = entry.label.toLowerCase();
  if (label == term) {
    return 100;
  }
  if (label.startsWith(term)) {
    return 80;
  }
  if (label.split(/[\s/]+/).some(word => word.startsWith(term))) {
    return 60;
  }
  if (label.includes(term)) {
    return 40;
  }
  if (entry.tooltip.toLowerCase().includes(term)) {
    return 20;
  }
  if (entry.groupLabel.toLowerCase().includes(term) || entry.tabLabel.toLowerCase().includes(term)) {
    return 10;
  }
  return 0;
}
