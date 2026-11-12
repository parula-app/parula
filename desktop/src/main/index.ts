import { setMainWindow, startupBackend, shutdownBackend, startupArgs, updateState, checkForUpdateAndNotify, installUpdate, createJPCSecret } from '../../backend/backend';
import { SecondaryBrowserWindow } from '../../backend/SecondaryBrowserWindow';
import { app, shell, BrowserWindow, session, Menu, MenuItemConstructorOptions, type WebContents, type BrowserWindowConstructorOptions, type HandlerDetails, type WindowOpenHandlerResponse } from 'electron'
import { ipcMain } from 'electron/main';
import { join } from 'path'
import { electronApp, is } from '@electron-toolkit/utils'
import icon from '../../build/icon.png?asset'
import { installSignalServiceCATrust } from './signalServiceCA'
import { appName, dataAppName } from '../../../app/logic/build'

const windowFrame: BrowserWindowConstructorOptions = {
  autoHideMenuBar: true,
  titleBarStyle: process.platform == 'darwin' ? 'hiddenInset' : 'customButtonsOnHover',
  titleBarOverlay: true,
  frame: false,
  ...(process.platform === 'linux' ? { icon } : {}),
};

function createWindow(): void {
  try {
    let jpcSecret = createJPCSecret();
    startupBackend(jpcSecret)
      .catch(console.error);

    // Create the browser window.
    const mainWindow = new BrowserWindow({
      width: 1700,
      height: 950,
      show: false,
      ...windowFrame,
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.mjs'),
        sandbox: false,
        webviewTag: true,
        backgroundThrottling: false,
      }
    })
    setMainWindow(mainWindow);

    if (process.platform == "linux" && app.commandLine.getSwitchValue("ozone-platform") == "wayland") {
      // The "ready-to-show" event doesn't always fire on Wayland.
      // "did-finish-load" works and is close enough.
      // https://github.com/electron/electron/issues/48859
      mainWindow.webContents.on("did-finish-load", () => {
        mainWindow.show();
      });
    } else {
      mainWindow.on("ready-to-show", () => {
        mainWindow.show();
      });
    }

    mainWindow.on('closed', () => shutdownBackend().catch(console.error));

    /** Ensure that new web windows are opened in the browser, not inside our app.
     *
     * Attention: This does *not* catch normal `<a href="">` links.
     * Thus, sanitizeHTML() adds a `target="_blank"` to such links,
     * which is considered a new web window and forces them to end up here. */
    mainWindow.webContents.setWindowOpenHandler((details): any => {
      // Secondary windows of our app. Only our frontend has a valid token.
      let token = details.features?.split(",").find(feature => feature.startsWith("mustang-window="))?.substring("mustang-window=".length);
      let created = details.url == "about:blank" && token ? SecondaryBrowserWindow.use(token) : null;
      if (created) {
        return allowSecondaryWindow(created);
      }
      // Chrome special-cases "about:blank". Make *sure* that we don't get this here.
      if (!details.url?.startsWith("https://")) {
        return { action: 'deny' };
      }
      // Allow windows opened by us for OAuth2
      // Must match OAuth2Window.ts login()
      if (details?.features?.includes("oauth2popup")) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: "center,noopener,noreferrer,sandbox=true",
        };
      }
      return openInBrowser(details);
    })

    mainWindow.webContents.on('did-create-window', (child, _details) => {
      if (secondaryWindows.has(child)) {
        return;
      }
      child.on('closed', () => {
        mainWindow.webContents.send('oauth2-close');
      });
      child.webContents.on('did-navigate', (_event, url) => {
        mainWindow.webContents.send('oauth2-navigate', url);
      });
      // Workaround for window.close() not closing in some cases
      ipcMain.on('oauth2-close', () => {
        child.close();
      });
    });

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    // The `try` above cannot catch these, because they fail asynchronously
    if (is.dev && true) {
      mainWindow.loadURL('http://localhost:5454/#jpcSecret=' + jpcSecret)
        .catch(console.error);
    } else if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#jpcSecret=' + jpcSecret)
        .catch(console.error);
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'jpcSecret=' + jpcSecret })
        .catch(console.error);
    }
  } catch (ex) {
    console.error(ex);
  }
}

/** Opens https URLs in the system web browser, and never a new Electron window */
function openInBrowser(details: HandlerDetails): WindowOpenHandlerResponse {
  if (details.url?.startsWith("https://")) {
    shell.openExternal(details.url)
      .catch(console.error); // must return the action synchronously
  }
  return { action: 'deny' };
}

/** @see `allowSecondaryWindow()` */
const secondaryWindows = new WeakSet<BrowserWindow>();

/**
 * Opens a secondary window of our app, which the frontend opened from the main window.
 * The frontend writes the content into the `about:blank` page, and this content runs
 * in the JS context of the main window. @see `AppWindow` in the frontend
 * The window must never load anything else, and it may not open other windows.
 * @param created from `SecondaryBrowserWindow.use()`
 */
function allowSecondaryWindow(created: (browserWindow: BrowserWindow) => void): WindowOpenHandlerResponse {
  return {
    action: 'allow',
    overrideBrowserWindowOptions: {
      ...windowFrame,
      // Set all of them here, because they are not inherited from the main window,
      // and `window.open()` could set some of them
      webPreferences: {
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        sandbox: true,
        webviewTag: true, // for emails, see `WebView.svelte`. Restricted by `restrictWebViews()`.
        backgroundThrottling: false,
      },
    },
    createWindow: (options: BrowserWindowConstructorOptions) => {
      let browserWindow = new BrowserWindow(options);
      let webContents = browserWindow.webContents;
      webContents.setWindowOpenHandler(openInBrowser);
      webContents.on('will-navigate', event => event.preventDefault());
      secondaryWindows.add(browserWindow);
      created(browserWindow);
      return webContents;
    },
  };
}

function createMenu() {
  // <copied from="https://github.com/electron/electron/blob/main/lib/browser/default-menu.ts#L48-L60">
  const macAppMenu: MenuItemConstructorOptions = { role: 'appMenu' };
  const menu = Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [macAppMenu] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' },
  ]);
  Menu.setApplicationMenu(menu);
}

if (dataAppName != appName) {
  app.setPath('userData', join(app.getPath('appData'), dataAppName));
}

const gotLock = app.requestSingleInstanceLock();
if (gotLock) {
  app.whenReady()
    .then(whenReady)
    .catch(console.error);
} else {
  // This is a second instance
  app.quit();
  // Event 'second-instance' will be called within the primary instance
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
async function whenReady() {
  // Set app user model id for MS Windows
  // <https://learn.microsoft.com/en-us/windows/win32/shell/appids>
  electronApp.setAppUserModelId('im.mustang');

  // Remove exec path
  handleCommandline(process.argv.splice(1));

  allowCrossDomainRequestsFromFrontend();
  installSignalServiceCATrust(); // renderer's HTTPS REST to *.signal.org (the wss socket runs in the backend with its own CA)

  createMenu();
  createWindow();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  try {
    await checkForUpdateAndNotify();
    setInterval(async () => {
      try {
        if (updateState.haveUpdate) {
          console.log(`Already have update waiting.`);
          return; // `checkForUpdates()` downloads the update on every call
        }
        console.log("Routinely checking for app updates...");
        await checkForUpdateAndNotify();
      } catch (ex) {
        console.error(ex);
      }
    }, 60 * 60 * 1000); // once per hour - TODO Change to once per day, when we make less frequent releases
  } catch (ex) {
    console.error(ex);
  }
}

app.on('web-contents-created', (event, webContents) => {
  setWindowOpenHandler(webContents);
  restrictWebViews(webContents);
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform == 'darwin') {
    updateAndRestartNowIfNeeded()
      .catch(console.error);
  } else {
    app.quit();
  }
});

async function updateAndRestartNowIfNeeded() {
  if (await updateState.updateDownloaded()) {
    await installUpdate();
    // TODO restart after install, but open only a background window
  } // else do nothing
}

// macOS: Capture URL during launch
app.on("open-url", (_event, url) => {
  startupArgs.url = url;
  startupArgs.notifyObservers();

  if (BrowserWindow.getAllWindows().length == 0 && app.isReady()) {
    createWindow();
  }
});
// macOS: Capture file open during launch
app.on("open-file", (_event, file) => {
  startupArgs.file = file;
  startupArgs.notifyObservers();

  if (BrowserWindow.getAllWindows().length == 0 && app.isReady()) {
    createWindow();
  }
});

/** Called within the primary instance when a second instance of our app was called. */
app.on("second-instance", (_, argv) => {
  // Remove executable path and "--allow-file-access-from-files"
  handleCommandline(argv.splice(2));
});

function handleCommandline(args: string[]) {
  try {
    console.log("commandline arguments", args);
    startupArgs.commandline = args;
    let lastArg = args[args.length - 1];
    if (lastArg?.includes(":")) {
      let urlObj = new URL(lastArg); // Check syntax
      startupArgs.url = urlObj.href;
    }
    if (lastArg?.startsWith("/") && lastArg.includes(".")) {
      startupArgs.file = lastArg;
    }
    startupArgs.notifyObservers();
  } catch (ex) {
    console.error(ex);
  }
}

function allowCrossDomainRequestsFromFrontend() {
  const filter = { urls: ["https://*/*", "http://*/*"] };
  session.defaultSession.webRequest.onBeforeSendHeaders(
    filter,
    (details, callback) => {
      let requestHeaders = details.requestHeaders ?? {};
      for (let name in requestHeaders) {
        switch (name.toLowerCase()) {
        case "origin":
        case "referer":
          delete requestHeaders[name];
          break;
        case "cookie-bypass":
          // Fake out the Cookie on all ActiveSync requests, because Hotmail.
          requestHeaders.Cookie = requestHeaders[name];
          delete requestHeaders[name];
          break;
        case "user-agent":
          // Fake out the User-Agent on all ActiveSync requests, because Office.
          if (details.url.toLowerCase().includes("/microsoft-server-activesync")) {
            requestHeaders[name] = requestHeaders[name].replace(/\).*/, ") Gecko/20100101");
          }
          break;
        }
      }
      callback({ requestHeaders: requestHeaders });
    }
  );
  session.defaultSession.webRequest.onHeadersReceived(
    filter,
    (details, callback) => {
      let responseHeaders = details.responseHeaders ?? {};
      // Remove server response
      for (let name in responseHeaders) {
        let lowercase = name.toLowerCase();
        if (lowercase.startsWith("access-control-allow-")) {
          delete responseHeaders[name];
        }
      }
      // Allow frontend to access other servers
      responseHeaders["Access-Control-Allow-Origin"] = ["*"];
      responseHeaders["Access-Control-Allow-Methods"] = ["*"];
      responseHeaders["Access-Control-Allow-Headers"] = ["*"];
      responseHeaders["Access-Control-Expose-Headers"] = ["*"];
      // Pretend that all CORS preflight requests succeed
      let statusLine = details.method == "OPTIONS" ? "HTTP/1.1 200 OK" : details.statusLine;
      // console.log("Response", details.url, responseHeaders);
      callback({ responseHeaders, statusLine });
    }
  );
}

function setWindowOpenHandler(webContents: WebContents) {
  webContents.setWindowOpenHandler((details) => {
    return { action: 'deny' };
  });
}

/** We need `webviewTag`, but it also means that any `<webview>` element that ends up
 * in our document decides its own `webPreferences`, and `nodeintegration` there is
 * node.js in the page. We only ever set `src`, `partition` and `title`. */
function restrictWebViews(webContents: WebContents) {
  webContents.on('will-attach-webview', (_event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.webSecurity = true;
    delete params.nodeintegration;
    delete params.nodeintegrationinsubframes;
    delete params.disablewebsecurity;
    delete params.allowpopups;
  });
}

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
