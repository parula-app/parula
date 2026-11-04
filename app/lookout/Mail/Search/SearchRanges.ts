import { gt } from "../../../l10n/l10n";

export enum ReceivedRange {
  Any = "any",
  Today = "today",
  Yesterday = "yesterday",
  ThisWeek = "this-week",
  LastWeek = "last-week",
  ThisMonth = "this-month",
  LastMonth = "last-month",
  ThisYear = "this-year",
  LastYear = "last-year",
  Custom = "custom",
}

export const namedReceivedRanges = [
  ReceivedRange.Today,
  ReceivedRange.Yesterday,
  ReceivedRange.ThisWeek,
  ReceivedRange.LastWeek,
  ReceivedRange.ThisMonth,
  ReceivedRange.LastMonth,
  ReceivedRange.ThisYear,
  ReceivedRange.LastYear,
];

export function receivedRangeLabel(range: ReceivedRange): string {
  switch (range) {
    case ReceivedRange.Any: return gt`Any Time`;
    case ReceivedRange.Today: return gt`Today`;
    case ReceivedRange.Yesterday: return gt`Yesterday *=> The day before today`;
    case ReceivedRange.ThisWeek: return gt`This Week`;
    case ReceivedRange.LastWeek: return gt`Last Week`;
    case ReceivedRange.ThisMonth: return gt`This Month`;
    case ReceivedRange.LastMonth: return gt`Last Month`;
    case ReceivedRange.ThisYear: return gt`This Year`;
    case ReceivedRange.LastYear: return gt`Last Year`;
    case ReceivedRange.Custom: return gt`Custom Dates`;
  }
}

export enum SizeRange {
  Any = "any",
  Tiny = "tiny",
  Small = "small",
  Medium = "medium",
  Large = "large",
  VeryLarge = "very-large",
  Huge = "huge",
  Enormous = "enormous",
}

export const namedSizeRanges = [
  SizeRange.Tiny,
  SizeRange.Small,
  SizeRange.Medium,
  SizeRange.Large,
  SizeRange.VeryLarge,
  SizeRange.Huge,
  SizeRange.Enormous,
];

export function sizeRangeLabel(size: SizeRange): string {
  switch (size) {
    case SizeRange.Any: return gt`Any Size`;
    case SizeRange.Tiny: return gt`Tiny (< 10 KB)`;
    case SizeRange.Small: return gt`Small (10 - 25 KB)`;
    case SizeRange.Medium: return gt`Medium (25 - 100 KB)`;
    case SizeRange.Large: return gt`Large (100 - 500 KB)`;
    case SizeRange.VeryLarge: return gt`Very Large (500 KB - 1 MB)`;
    case SizeRange.Huge: return gt`Huge (1 - 5 MB)`;
    case SizeRange.Enormous: return gt`Enormous (> 5 MB)`;
  }
}

export function sizeRangeBytes(size: SizeRange): { min: number | null, max: number | null } {
  const kKB = 1024;
  const kMB = 1024 * kKB;
  switch (size) {
    case SizeRange.Tiny: return { min: null, max: 10 * kKB - 1 };
    case SizeRange.Small: return { min: 10 * kKB, max: 25 * kKB - 1 };
    case SizeRange.Medium: return { min: 25 * kKB, max: 100 * kKB - 1 };
    case SizeRange.Large: return { min: 100 * kKB, max: 500 * kKB - 1 };
    case SizeRange.VeryLarge: return { min: 500 * kKB, max: kMB - 1 };
    case SizeRange.Huge: return { min: kMB, max: 5 * kMB - 1 };
    case SizeRange.Enormous: return { min: 5 * kMB, max: null };
    default: return { min: null, max: null };
  }
}
