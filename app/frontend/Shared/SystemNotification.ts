import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { appGlobal } from "../../logic/app";
import logo from '../asset/icon/general/logo.svg?raw';
import { minorError, logErrorToServer } from "../Util/error";

/** Tells the user about a new mail, a meeting reminder etc.
 * outside of our app window: a popup in the screen corner and in the
 * notification center of the OS. */
export class SystemNotification {
  kinds: NotificationKinds;
  title: string;
  body: string;
  /** Lets the OS replace an earlier popup of the same kind with this one,
   * instead of stacking them up. Only works for web popups. */
  id: string;
  /** Linux and Windows only.
   * Electron defaults to "low", where some desktops show the popup
   * only in the notification center, so we explicitly default to "normal". */
  urgency: "normal" | "critical" | "low" = "normal";
  /** How many mails etc. you want to notify about, at once with this notification.
   * TODO implement */
  count = 1;
  /** Raw SVG of the icon below the bubble
   * TODO implement?
   * TODO makes sense? */
  icon: string;
  /** The user clicked on the popup or the tray icon.
   * The tray icon has no `event`. */
  onClick: (event?: any) => void;
  /** The user typed an answer right into the popup. macOS only. */
  onReply: (text: string) => void;
  replyPlaceholder: string;

  constructor(kinds: NotificationKinds, title: string, body: string, id: string) {
    this.kinds = kinds;
    this.title = title;
    this.body = body;
    this.id = id;
  }

  /** Notifies the user in the `kinds` ways.
   * If one of them fails, the others are still shown. */
  async show() {
    await this.showPopups();

    if (this.kinds.taskbar) {
      try {
        // TODO
      } catch (ex) {
        minorError(ex);
      }
    }

    if (this.kinds.tray) {
      try {
        await appGlobal.remoteApp.setTrayIcon(
          await bubbleImageURL(this.count, this.icon ?? logo),
          this.title,
          () => this.onClick?.());
      } catch (ex) {
        minorError(ex);
      }
    }

    if (this.kinds.sound) {
      try {
        await this.playNotificationSound();
      } catch (ex) {
        minorError(ex);
      }
    }
  }

  async showPopups() {
    if (!this.kinds.popup) {
      return;
    }
    try {
      if (await appGlobal.remoteApp.isOSNotificationSupported()) {
        await this.showOSPopup();
      } else {
        await this.showWebPopup();
      }
    } catch (ex) {
      minorError(ex);
    }
  }

  /** Web API `Notification`
   *
   * Doesn't work on macOS, because Chromium denies the permission silently. */
  protected async showWebPopup() {
    if (typeof (Notification) == "undefined") { // e.g. Android WebView
      return;
    }
    if (Notification.permission != "granted" &&
        await Notification.requestPermission() != "granted") {
      return;
    }
    let popup = new Notification(this.title, {
      body: this.body,
      tag: this.id,
      renotify: true,
      // icon: url,
      // image: url,
    });
    if (this.onClick) {
      popup.onclick = event => this.onClick(event);
    }
    // shows automatically after creating the object
  }

  /** The popup of the OS, created by our backend process.
   * <https://www.electronjs.org/docs/latest/api/notification> */
  protected async showOSPopup() {
    let popup = await appGlobal.remoteApp.newOSNotification({
      title: this.title,
      body: this.body,
      // icon: url,
      urgency: this.urgency,
      hasReply: !!this.onReply,
      replyPlaceholder: this.replyPlaceholder,
      // Windows
      // toastXml: ...,
    });
    openOSPopups.add(popup);
    const onClose = () => openOSPopups.delete(popup);

    if (this.onClick) {
      popup.on("click", event => {
        onClose();
        this.onClick(event);
      });
    }
    if (this.onReply) {
      popup.on("reply", async (event, replyText) => {
        onClose();
        this.onReply(replyText);
      });
    }
    popup.on("close", onClose);
    // e.g. macOS refuses when an app is not signed
    popup.on("failed", (event, error) => {
      onClose();
      logErrorToServer(new Error("Failed to show the OS popup notification: " + error));
    });
    popup.show();
  }

  static lastSound = new Date();

  async playNotificationSound() {
    // Don't annoy user with successive "bing, bing, bing"
    // Don't bing at startup, implemented by default value of `lastSound`.
    const kMinTimeBetweenSounds = 2; // in seconds
    if (Date.now() - SystemNotification.lastSound.getTime() < kMinTimeBetweenSounds * 1000) {
      return;
    }
    SystemNotification.lastSound = new Date();

    let audioEl = new Audio("sound/new-message.mp3");
    await audioEl.play();
  }
}

/** In which ways the user wants to be notified about new mails, reminders etc.
 * @see NotificationKinds.svelte */
export class NotificationKinds {
  /** Popup on OS-level, outside our app window */
  readonly popup: boolean;
  /** Bing! */
  readonly sound: boolean;
  /** In the OS app starter at bottom of the screen, show a bubble on top of the app icon */
  readonly taskbar: boolean;
  /** Show an icon in the OS notifications area, e.g. top right on mac and bottom right on Windows.
   * Not yet implemented correctly. */
  readonly tray: boolean;
  /** In our app bar, in our window, show a bubble on top of the app icon
   * Not yet implemented. */
  readonly appbar: boolean;

  constructor(kinds: string[]) {
    sanitize.array(kinds);
    this.popup = kinds.includes("popup");
    this.sound = kinds.includes("sound");
    this.taskbar = kinds.includes("taskbar");
    this.tray = kinds.includes("tray");
    this.appbar = kinds.includes("appbar");
  }
}

/** The popups that the user can still react to.
 * Hold a reference, so that they don't get GC. */
const openOSPopups = new Set<any>();

/** The size of the icon that we render, in px.
 * The OS scales it down to the height of its tray. */
const kTrayIconSize = 64;

/** Draws the `icon` with a bubble showing the `count` on top of it.
 * @param icon Raw SVG
 * @returns data: URL of a PNG.
 *   The OS tray takes only raster images, not SVG. */
async function bubbleImageURL(count: number, icon: string): Promise<string> {
  let canvas = document.createElement("canvas");
  canvas.width = kTrayIconSize;
  canvas.height = kTrayIconSize;
  let context = canvas.getContext("2d");
  let image = new Image(kTrayIconSize, kTrayIconSize); // Our logo has only a `viewBox`, so set a size
  image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(icon);
  await image.decode();
  context.drawImage(image, 0, 0, kTrayIconSize, kTrayIconSize);
  drawCountBubble(context, count);
  return canvas.toDataURL("image/png");
}

function drawCountBubble(context: CanvasRenderingContext2D, count: number) {
  if (count <= 0) {
    return;
  }
  let radius = kTrayIconSize * 0.3;
  let x = kTrayIconSize - radius;
  let y = radius;
  context.beginPath();
  context.arc(x, y, radius, 0, 2 * Math.PI);
  context.fillStyle = "#DD3322";
  context.fill();
  context.fillStyle = "#FFFFFF";
  context.font = `bold ${Math.round(radius * 1.1)}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(count < 100 ? String(count) : "99+", x, y);
}

/* Missing in the DOM types of TypeScript */
declare global {
  interface NotificationOptions {
    /** Alert the user again, when this popup replaces an earlier one with the same `tag` */
    renotify?: boolean;
  }
}
