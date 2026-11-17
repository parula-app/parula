import type { QuickAccessCommand } from "../Shared/QuickAccess/QuickAccess";
import { writable } from "svelte/store";

export interface StatusBarItem {
  label: string;
  icon?: ConstructorOfATypedSvelteComponent;
  tooltip?: string;
  busy?: boolean;
}

export interface StatusBarView {
  label: string;
  icon: ConstructorOfATypedSvelteComponent;
  isActive: boolean;
  onClick: () => void;
}

export interface StatusBarContent {
  left: StatusBarItem[];
  right: StatusBarItem[];
  views: StatusBarView[];
}

export const statusBarContent = writable<StatusBarContent | null>(null);

export const quickAccessCommands = writable<QuickAccessCommand[]>([]);
