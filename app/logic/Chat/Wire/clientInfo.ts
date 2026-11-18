/** How we identify ourselves to a Wire backend.
 * We are our own product, never Wire, so this is the only file in `Chat/Wire/`
 * that hardcodes the product name, the version, and the device description that
 * every other participant sees in their device list. */

import { appName, appVersion, isMobile } from "../../build";
import { getOSName } from "../../../frontend/Util/util";

/** Sent on every HTTP request. The official web client sends `Wire-Client: Web`
 * plus its build version; we send ours. Informational, the backend does not
 * act on it. */
export const kClientHeaders: Record<string, string> = {
  "Wire-Client": appName,
  "Wire-Client-Version": appVersion,
};

/** Our private URL scheme, which the SSO login window comes back to.
 * Wire's SSO service refuses any scheme that does not start with `wire`.
 * The OS knows it as our deep link: Electron `setAsDefaultProtocolClient()`,
 * `AndroidManifest.xml` and `Info.plist`. */
export const kSSOURLScheme = `wire-${appName.toLowerCase()}`;

/** `class` at `POST /clients`. Wire knows only `desktop`, `phone` and `tablet`. */
export const kDeviceClass = isMobile ? "phone" : "desktop";

/** `model` at `POST /clients`, e.g. `Parula Linux`. Shown to other participants. */
export function deviceModel(): string {
  return `${appName} ${osName()}`;
}

/** `label` at `POST /clients`, the device name that the user recognizes their
 * own device by, in our and in everybody else's device list. */
export function deviceLabel(): string {
  return osName();
}

/** The OS as we show it to humans. `getOSName()` sees Android as Linux. */
function osName(): string {
  let userAgent = navigator.userAgent;
  if (/Android/i.test(userAgent)) {
    return "Android";
  }
  if (/iPhone|iPad|iPod/i.test(userAgent)) {
    return "iOS";
  }
  return kOSNames[getOSName()] ?? "Unknown";
}

const kOSNames = {
  windows: "Windows",
  macintosh: "macOS",
  linux: "Linux",
};
