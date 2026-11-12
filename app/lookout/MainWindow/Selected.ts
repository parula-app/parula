import type { QuickAccessCommand } from "../Shared/QuickAccess/QuickAccess";
import { AppWindow } from "../../frontend/MainWindow/AppWindow";
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

export const statusBarContent = AppWindow.perWindow(() => writable<StatusBarContent | null>(null));

export const quickAccessCommands = AppWindow.perWindow(() => writable<QuickAccessCommand[]>([]));
