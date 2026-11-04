export type RibbonLayout = "classic" | "simplified";
export type RibbonItemSize = "large" | "small";
export type RibbonItemLook = "large" | "small" | "small-icon" | "simplified" | "simplified-icon" | "list";

export enum ClassicStage { Designed, SmallButtons, IconsOnly, Collapsed }
export enum SimplifiedStage { Labels, IconsOnly, InMoreMenu }

export interface RibbonMetrics {
  largeWidth: number;
  smallWidth: number;
  smallIconWidth: number;
  simplifiedWidth: number;
  simplifiedIconWidth: number;
  gap: number;
  groupChrome: number;
}

export interface RibbonItemInfo {
  size: RibbonItemSize;
  fixedWidth?: number;
}

export interface RibbonGroupInfo {
  label: string;
  el: HTMLElement;
  bodyEl: HTMLElement;
  stageWidths: number[];
  hasOverflowStage: boolean;
  setStage: (stage: number) => void;
}

export interface RibbonTabInfo {
  label: string;
  isContextual: boolean;
  groups: RibbonGroupInfo[];
}

export interface RibbonGroupLook {
  layout: RibbonLayout;
  stage: number;
  collapsed: boolean;
}

export function fitGroupStages(groups: RibbonGroupInfo[], availableWidth: number, overflowWidth: number): number[] {
  let stages = stagesFor(groups, availableWidth);
  if (overflowWidth && groups.some((group, i) => isOverflowStage(group, stages[i]))) {
    stages = stagesFor(groups, availableWidth - overflowWidth);
  }
  return stages;
}

export function isOverflowStage(group: RibbonGroupInfo, stage: number): boolean {
  return group.hasOverflowStage && stage > 0 && stage == group.stageWidths.length - 1;
}

function stagesFor(groups: RibbonGroupInfo[], availableWidth: number): number[] {
  let stages = groups.map(() => 0);
  let widths = groups.map(group => group.stageWidths[0] ?? 0);
  let totalWidth = widths.reduce((sum, width) => sum + width, 0);
  let maxStage = Math.max(0, ...groups.map(group => group.stageWidths.length - 1));
  let reducedInLastPass: { index: number, previousStage: number, previousWidth: number }[] = [];
  for (let stage = 1; stage <= maxStage && totalWidth > availableWidth; stage++) {
    reducedInLastPass = [];
    for (let i = groups.length - 1; i >= 0 && totalWidth > availableWidth; i--) {
      let group = groups[i];
      if (stage > group.stageWidths.length - 1) {
        continue;
      }
      let width = group.stageWidths[stage] ?? 0;
      if (width >= widths[i]) {
        continue;
      }
      reducedInLastPass.push({ index: i, previousStage: stages[i], previousWidth: widths[i] });
      totalWidth -= widths[i] - width;
      widths[i] = width;
      stages[i] = stage;
    }
  }
  for (let reduced of reducedInLastPass.reverse()) {
    let i = reduced.index;
    let restoredTotal = totalWidth - widths[i] + reduced.previousWidth;
    if (restoredTotal <= availableWidth) {
      totalWidth = restoredTotal;
      widths[i] = reduced.previousWidth;
      stages[i] = reduced.previousStage;
    }
  }
  return stages;
}

export function computeStageWidths(layout: RibbonLayout, items: RibbonItemInfo[], metrics: RibbonMetrics, labelWidth = 0): number[] {
  let chrome = metrics.groupChrome;
  if (layout == "simplified") {
    let row = (width: (item: RibbonItemInfo) => number) =>
      items.reduce((sum, item) => sum + width(item), 0) + metrics.gap * Math.max(0, items.length - 1) + chrome;
    let simplifiedWidths: number[] = [];
    simplifiedWidths[SimplifiedStage.Labels] = row(item => item.fixedWidth || metrics.simplifiedWidth);
    simplifiedWidths[SimplifiedStage.IconsOnly] = row(item => item.fixedWidth || metrics.simplifiedIconWidth);
    simplifiedWidths[SimplifiedStage.InMoreMenu] = 0;
    return simplifiedWidths;
  }
  let designed = columnsWidth(items.map(item => ({
    rows: item.size == "large" && !item.fixedWidth ? 3 : 1,
    width: item.fixedWidth || (item.size == "large" ? metrics.largeWidth : metrics.smallWidth),
  })), metrics.gap);
  let small = columnsWidth(items.map(item => ({
    rows: 1,
    width: item.fixedWidth || metrics.smallWidth,
  })), metrics.gap);
  let icons = columnsWidth(items.map(item => ({
    rows: 1,
    width: item.fixedWidth || metrics.smallIconWidth,
  })), metrics.gap);
  let classicWidths: number[] = [];
  classicWidths[ClassicStage.Designed] = Math.max(designed, labelWidth) + chrome;
  classicWidths[ClassicStage.SmallButtons] = Math.max(small, labelWidth) + chrome;
  classicWidths[ClassicStage.IconsOnly] = Math.max(icons, labelWidth) + chrome;
  classicWidths[ClassicStage.Collapsed] = metrics.largeWidth + chrome;
  return classicWidths;
}

export function columnsWidth(cells: { rows: number, width: number }[], gap: number): number {
  const kRows = 3;
  let columns: number[] = [];
  let row = kRows;
  for (let cell of cells) {
    if (row + cell.rows > kRows) {
      columns.push(0);
      row = 0;
    }
    columns[columns.length - 1] = Math.max(columns[columns.length - 1], cell.width);
    row += cell.rows;
  }
  return columns.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, columns.length - 1);
}

export function itemLook(layout: RibbonLayout, stage: number, collapsed: boolean, size: RibbonItemSize): RibbonItemLook {
  if (layout == "simplified") {
    return collapsed ? "list" : stage >= SimplifiedStage.IconsOnly ? "simplified-icon" : "simplified";
  }
  if (collapsed || stage == ClassicStage.Designed) {
    return size;
  }
  return stage >= ClassicStage.IconsOnly ? "small-icon" : "small";
}

export function largeLabelLines(label: string, hasMenu: boolean): [string, string] {
  const kChevronChars = 2;
  let words: string[] = [];
  for (let word of label.split(" ").filter(word => word)) {
    if (words.length && !/[\p{L}\p{N}]/u.test(word)) {
      words[words.length - 1] += " " + word;
    } else {
      words.push(word);
    }
  }
  if (words.length < 2) {
    return [label, ""];
  }
  let split = 1;
  let splitLength = Infinity;
  for (let i = 1; i < words.length; i++) {
    let first = words.slice(0, i).join(" ").length;
    let second = words.slice(i).join(" ").length + (hasMenu ? kChevronChars : 0);
    if (Math.max(first, second) <= splitLength) {
      split = i;
      splitLength = Math.max(first, second);
    }
  }
  return [words.slice(0, split).join(" "), words.slice(split).join(" ")];
}
