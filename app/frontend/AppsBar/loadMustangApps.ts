import { contactsMustangApp } from "../Contacts/ContactsMustangApp";
import { chatMustangApp } from "../Chat/ChatMustangApp";
// #if [PROPRIETARY]
import { meetMustangApp } from "../Meet/MeetMustangApp";
// #endif
import { mailMustangApp } from "../Mail/MailMustangApp";
import { calendarMustangApp } from "../Calendar/CalendarMustangApp";
// #if [!WEBMAIL]
import { filesMustangApp } from "../Files/FilesMustangApp";
import { topicMustangApp } from "../Topic/TopicMustangApp";
import { webAppsMustangApp } from "../WebApps/WebAppsMustangApp";
// #endif
import { settingsMustangApp } from "../Settings/Window/SettingsMustangApp";
import { addonMustangApps } from "../Addons/AddonMustangApp";
import { mustangApps, selectedApp, showDemoToggle } from "./selectedApp";
import { MustangApp } from "./MustangApp";
import { appGlobal } from "../../logic/app";
import { getConfigDir } from "../../logic/util/backend-wrapper";
import { production } from "../../logic/build";
import JXON from "../../../lib/util/JXON";
import { ArrayColl } from "svelte-collections";

const allMustangApps = new ArrayColl<MustangApp>();

export function loadMustangApps() {

  if (allMustangApps.isEmpty) {
    allMustangApps.addAll([
      contactsMustangApp,
      mailMustangApp,
      chatMustangApp,
      // #if [PROPRIETARY]
      meetMustangApp,
      // #endif
      calendarMustangApp,
      filesMustangApp,
      webAppsMustangApp,
      topicMustangApp,
      settingsMustangApp,
    ]);
  }

  if (false && !production) {
    loadDemoMustangApps();
    selectedApp.set(mailMustangApp);
    return;
  }
  // Once finished, add apps here, and remove loadDemoMustangApps() */

  mustangApps.replaceAll([
    contactsMustangApp,
    mailMustangApp,
    calendarMustangApp,
    // #if [!WEBMAIL]
    filesMustangApp,
    webAppsMustangApp,
    topicMustangApp,
    // #endif
    ...addonMustangApps.contents,
    settingsMustangApp,
  ]);
}

export function loadDemoMustangApps() {
  let apps = new ArrayColl(allMustangApps);
  addonMustangApps.insertInto(apps);
  mustangApps.replaceAll(apps);
}

export async function disableAppsBasedOnFeaturesXML() {
  let fileName = await appGlobal.remoteApp.path.join(await getConfigDir(), "features.xml");
  let xmlArray: Uint8Array;
  try {
    xmlArray = await appGlobal.remoteApp.readFile(fileName, { encoding: "utf-8" });
  } catch (ex) {
    if (ex.message?.includes("ENOENT")) {
      return;
    }
    throw ex;
  }
  let xmlStr = new TextDecoder().decode(xmlArray);
  let xml = JXON.parse(xmlStr);
  let newApps = new ArrayColl<MustangApp>(); // preserve order of apps
  for (let app of allMustangApps) {
    let enabledProp = xml.features?.[app.id]?.["@enabled"];
    let enabled = typeof(enabledProp) == "boolean" ? enabledProp : mustangApps.includes(app);
    if (enabled) {
      newApps.add(app);
    }
  }
  addonMustangApps.insertInto(newApps);
  mustangApps.replaceAll(newApps);
  showDemoToggle.set(false);
}
