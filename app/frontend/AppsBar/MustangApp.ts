import type { PageParams } from "./selectedApp";
import { Observable, notifyChangedProperty } from "../../logic/util/Observable";
import type { URLString } from "../../logic/util/util";
import { ArrayColl, Collection } from "svelte-collections";
import { derived, type Readable } from "svelte/store";
import { locale } from "../../l10n/l10n";

export abstract class MustangApp extends Observable {
  id: string;
  /** User-visible name of the app, in the current UI language */
  abstract get name(): string;
  /** Reflects content of the app. Used for sub-apps. */
  title: Readable<string> = derived([this, locale], () => this.name);
  /** App icon, either as SVG string or as Svelte component */
  icon: string | ConstructorOfATypedSvelteComponent;
  /** Main window content that shows when the user selected this app */
  appURL: URLString;
  /** Parameters that will be passed to the main window in routes
   * as Svelte component properties */
  windowParams: PageParams = {};
  /** Sidebar content that shows `showSidebar` is true.
   * This shows when *another* app is active.
   * This is *not* the sidebar of an app while the app itself is open. */
  sidebar: ConstructorOfATypedSvelteComponent | null;

  /** Whether `sidebar` should be open or not */
  @notifyChangedProperty
  showSidebar: boolean = false;

  /**
   * Shows as smaller apps underneath this app.
   * They are logically part of this app.
   *
   * E.g. an editor (write mail, edit calendar entry) for the app.
   * Or the most favorite third party web apps.
   *
   * Should be a very small number (0, 1 up to max 3-5),
   * due to UI space constaints.
   */
  @notifyChangedProperty
  subApps: Collection<MustangApp> = new ArrayColl<MustangApp>();
}
