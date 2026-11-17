import type { Account } from "../../logic/Abstract/Account";
import { Observable, notifyChangedProperty } from "../../logic/util/Observable";
import { ArrayColl, Collection } from "svelte-collections";
import type { MustangApp } from "../AppsBar/MustangApp";

export class SettingsCategory extends Observable {
  id: string;
  /** User-visible name of the category */
  name: string;
  description: string | null;
  /** Alternative words for `name` that the user might think of. Used for searching settings. */
  synonyms = new ArrayColl<string>();
  /** Icon, either as SVG string or as Svelte component */
  icon: string | ConstructorOfATypedSvelteComponent;

  isMain = false;
  /** Window content with the actual settings that shows on the right
   * when the user selected this settings category */
  windowContent: ConstructorOfATypedSvelteComponent | undefined;

  @notifyChangedProperty
  subCategories: Collection<SettingsCategory> = new ArrayColl<SettingsCategory>();

  /** mail, chat etc. accounts for this app/category */
  @notifyChangedProperty
  accounts: Collection<Account> = new ArrayColl<Account>();
  newAccountURL: string | undefined;
  /** If `isMain && !isAccountSpecific`, can have the app that these settings are for */
  forApp: MustangApp;

  /** Note: Does not work for Account settings, because they are a separate hierarchy. */
  get parentCategory(): SettingsCategory {
    return settingsCategories.find(cat => !!cat.subCategories.find(sub => sub == this));
  }

  constructor(id: string, name: string, content?: ConstructorOfATypedSvelteComponent, isMain = false) {
    super();
    this.id = id;
    this.name = name;
    this.isMain = isMain;
    this.windowContent = content;
  }

  searchMatchesDirect(searchTerm: string) {
    if (!searchTerm || searchTerm.length < 2) {
      return false;
    }
    searchTerm = searchTerm.toLowerCase();
    return this.name.toLowerCase().includes(searchTerm) ||
      this.synonyms.some(word => word.toLowerCase().includes(searchTerm)) ||
      this.description?.toLowerCase().includes(searchTerm);
  }
}

export class AccountSettingsCategory extends SettingsCategory {
  type: typeof Account;
  /** Whether this account of `type` can use it */
  isAvailable: (account: Account) => boolean;
  constructor(type: typeof Account, id: string, name: string, content: ConstructorOfATypedSvelteComponent, isMain = false, isAvailable: (account: Account) => boolean = () => true) {
    super(id, name, content, isMain);
    this.type = type;
    this.isAvailable = isAvailable;
  }
}

export const settingsCategories = new ArrayColl<SettingsCategory>();
export const accountSettings = new ArrayColl<AccountSettingsCategory>();
