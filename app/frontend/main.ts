import './app.css';
import { mount } from 'svelte';
import { appName, appVersion, production } from '../logic/build';
import { getLocalStorage } from './Util/LocalStorage';
import { sanitize } from '../../lib/util/sanitizeDatatypes';
import { assert } from '../logic/util/util';
import { catchErrors } from './Util/error';
import { gt, getUILocale, setUILocale } from '../l10n/l10n';
import * as Sentry from "@sentry/svelte";

if (production) {
  Sentry.init({
    dsn: "https://dade72a5be5a4a84a3171531b279181a@errorlog.parula.app/3",
    release: appName + "@" + appVersion,
    // An array here would *add* to the default integrations, not replace them.
    // `BrowserSession` sends a session to the server on every navigation.
    integrations: defaults => defaults.filter(integration => integration.name != "BrowserSession"),
  });
}

catchErrors(startUI, console.error);

/** Loads the UI language, then the UI */
async function startUI() {
  await catchErrors(() => setUILocale(getUILocale()), console.error); // if it fails, the UI is in English
  // The UI modules call `gt` when they load, so they're imported only after the language is loaded
  const { default: MainWindow } = await import('./MainWindow/MainWindow.svelte');
  mount(MainWindow, {
    target: document.getElementById('app'),
  });
}

function loadWindowSettings() {
  let windowSize = getLocalStorage("window.size", []).value;
  try {
    assert(windowSize?.length == 2 && windowSize.every(i => sanitize.integer(i, -1) > 0), "Bad window size");
    windowSize[0] = Math.min(windowSize[0], screen.width);
    windowSize[1] = Math.min(windowSize[1], screen.height);
    window.resizeTo(windowSize[0], windowSize[1]);
  } catch (ex) {
    throw gt`Bad window size: ` + windowSize;
  }

  let windowPosition = getLocalStorage("window.position", []).value;
  try {
    assert(windowPosition?.length == 2 && windowPosition.every(i => sanitize.integer(i, null) != null), "Bad window position");
    window.moveTo(windowPosition[0], windowPosition[1]);
  } catch (ex) {
    throw gt`Bad window position: ` + windowPosition;
  }
}
window.addEventListener("DOMContentLoaded", () => catchErrors(loadWindowSettings, console.error), false);
