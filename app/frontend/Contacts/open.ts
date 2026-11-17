import type { Person } from "../../logic/Abstract/Person";
import { selectedPerson } from "./Person/Selected";
import { contactsMustangApp } from "./ContactsMustangApp";
import { goTo, openApp } from "../AppsBar/selectedApp";
import { AppWindow } from "../MainWindow/AppWindow";
import { appGlobal } from "../../logic/app";

export function openPersonFromOtherApp(person: Person) {
  AppWindow.current().mainWindow.uiState(selectedPerson).set(person);
  if (appGlobal.isMobile) {
    goTo(`/contacts/person/${person.id}/edit`, { person });
  } else {
    openApp(contactsMustangApp, {});
  }
}
