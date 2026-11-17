import { type URLString } from "../../../logic/util/util";
import { blobToDataURL } from "../../../logic/util/blob";
import favicon from "@victr/favicon-fetcher";

/** Given a domain name, find the website's homepage favicon
 * Uses server-side API: beonex.com proxies to google.com
 * @param site domain, without "https://"
 * @returns `data:` image URL */
export async function getFavIcon(site: string): Promise<URLString | null> {
  return await getFavIconLocal(site);
}

/** Given a domain name, find the website's homepage favicon
 * Uses server-side API: beonex.com proxies to google.com
 * @param site domain, without "https://"
 * @returns `data:` image URL */
export async function getFavIconFromService(site: string): Promise<URLString | null> {
  try {
    //let imageURL = `https://parula.beonex.com/favicon/${site}`;
    let imageURL = `https://favicon.im/${site}`;
    return await fetchIcon(imageURL);
  } catch (ex) {
    console.warn(`Could not fetch favicon for ${site}:`, ex);
    return null;
  }
}

/** Given a domain name, find the website's homepage favicon
 * @param site domain, without "https://"
 * @returns `data:` image URL */
export async function getFavIconLocal(site: string): Promise<URLString | null> {
  try {
    let blob = await favicon.blob("https://" + site);
    return await blobToDataURL(blob);
  } catch (ex) {
    console.warn(`Could not fetch favicon for ${site}:`, ex);
    return null;
  }
}

/** @returns `data:` image URL */
async function fetchIcon(url: URLString): Promise<URLString> {
  let response = await fetch(url, {
    signal: AbortSignal.timeout(3000),
  });
  let blob = await response.blob();
  return await blobToDataURL(blob);
}
