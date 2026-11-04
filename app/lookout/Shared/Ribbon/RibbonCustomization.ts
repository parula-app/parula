export interface RibbonHiddenParts {
  tabs: string[];
  groups: string[];
}

export function withHiddenRibbonParts(all: Record<string, RibbonHiddenParts>, ribbonID: string, parts: RibbonHiddenParts): Record<string, RibbonHiddenParts> {
  let changed = { ...(all ?? {}) };
  if (parts.tabs.length || parts.groups.length) {
    changed[ribbonID] = { tabs: [...parts.tabs], groups: [...parts.groups] };
  } else {
    delete changed[ribbonID];
  }
  return changed;
}
