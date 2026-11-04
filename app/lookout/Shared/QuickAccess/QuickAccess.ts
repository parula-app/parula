import type { Readable } from "svelte/store";

export interface QuickAccessCommand {
  id: string;
  label: string;
  icon: ConstructorOfATypedSvelteComponent;
  run: () => void | Promise<void>;
  disabled?: Readable<boolean | string>;
  shortCutInfo?: string;
  shownByDefault?: boolean;
}

export type QuickAccessPosition = "above" | "below";

export function shownQuickAccessCommands(commands: QuickAccessCommand[], chosenIDs: string[] | null): QuickAccessCommand[] {
  if (!chosenIDs) {
    return commands.filter(command => command.shownByDefault);
  }
  return chosenIDs
    .map(id => commands.find(command => command.id == id))
    .filter(command => command);
}

export function toggledQuickAccessIDs(command: QuickAccessCommand, commands: QuickAccessCommand[], chosenIDs: string[] | null): string[] {
  let ids = chosenIDs ?? commands.filter(candidate => candidate.shownByDefault).map(candidate => candidate.id);
  if (ids.includes(command.id)) {
    return ids.filter(id => id != command.id);
  }
  return [...ids, command.id];
}
