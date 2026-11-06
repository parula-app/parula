import { NotImplemented } from "util/util";
import ky from "ky";

/** Implements the same functions as desktop/backend/backend.ts ,
 * but for the web browser.
 * Some of the functions are disabled in this case.
 */
export class WebMailBackend {
  async kyCreate(defaultOptions: any): Promise<any> {
    /* `ky` (like axios) is both a function and acts like an object with functions get(), post() etc. as properties,
     * which confuses jpc, so make it only an object. */
    let kyObj = {};
    let kyFunc = ky.create(defaultOptions);
    for (let name in kyFunc) {
      kyObj[name] = async (input, options) => {
        // let resultKy = ky.post(input, options);
        let kyFetch = kyFunc[name](input, options);
        let resultType = options?.result || defaultOptions?.result;
        if (resultType &&
          ["text", "json", "formData", "blob", "arrayBuffer"].includes(resultType) &&
          ["get", "put", "post", "patch", "delete", "head"].includes(name)) {
          try {
            // console.log("Calling server", "input", input, "options", options, "defaults", defaultOptions);
            // let json = await resultKy.json();
            return await kyFetch[resultType]();
          } catch (ex) {
            throw new HTTPFetchError(ex);
          }
        } else {
          return kyFetch;
        }
      }
    }
    return kyObj;
  }
  async isOSNotificationSupported(): Promise<boolean> {
    return false;
  }
  async setTrayIcon() {
  }
  async setBadgeCount() {
  }
  async minimizeMainWindow() {
  }
  async unminimizeMainWindow() {
  }
  async maximizeMainWindow() {
  }
  async writeTextToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
  }
  async openExternalURL(url: string) {
    window.open(url, "_blank", "noopener, noreferrer");
  }
  async openFileInNativeApp(filePath: string) {
    let url = "file://" + filePath;
    window.open(url, "_blank", "noopener");
  }
  async showFileInFolder(filePath: string) {
    throw new NotImplemented("Cannot open file path in browser");
  }
  async restartApp() {
    window.location.reload();
  }
  async setTheme() {
  }
  /** The browser does not let us at its root store */
  async getCACertificates(type: string): Promise<string[]> {
    return [];
  }
}

export class HTTPFetchError extends Error {
  url: string;
  redirectedURL: string;
  code: string;
  httpCode: number;
  httpStatusText: string;
  httpMethod: string;
  hostname: string;
  /** `Retry-After`, in seconds, when the server rate-limited us */
  retryAfterSeconds: number;

  constructor(ex: Error) {
    super(ex?.message ?? ex + "");
    this.name = ex?.name ?? this.name; // own property, so it survives the JPC JSON serialization
    let request = (ex as any).request;
    let response = (ex as any).response;
    let cause = (ex as any).cause
    if (request && response) {
      this.url = request.url;
      this.redirectedURL = response.url != request.url ? response.url : undefined;
      this.httpCode = response.status;
      this.httpStatusText = response.statusText;
      this.httpMethod = request.method;
      this.hostname = new URL(this.url).hostname;
      this.retryAfterSeconds = parseInt(response.headers.get("Retry-After")) || undefined;
      this.message = `HTTP ${this.httpMethod} <${this.url}>${this.redirectedURL ? ` redirected to <${this.redirectedURL}>` : ''} failed with ${this.httpCode} ${this.httpStatusText}`;
    } else if (cause) {
      this.code = cause.code;
      this.hostname = cause.hostname;
      if (cause.code == "ENOTFOUND") {
        this.message = `HTTP host ${cause.hostname} not found`;
      } else if (cause.code == "ECONNREFUSED") {
        this.message = `HTTP host ${cause.hostname} connection refused`;
      }
    }
  }
}
