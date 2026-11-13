import { MustangApp } from "../AppsBar/MustangApp";
import MeetApp from "./MeetApp.svelte";
import MeetSidebar from "./MeetSidebar.svelte";
import meetIcon from '../asset/icon/appBar/meet.svg?raw';
import { gt } from "../../l10n/l10n";

export class MeetMustangApp extends MustangApp {
  id = "meet";
  get name() {
    return gt`Meet`;
  }
  icon = meetIcon;
  appURL = "/meet";
  sidebar = MeetSidebar;
}

export const meetMustangApp = new MeetMustangApp();
