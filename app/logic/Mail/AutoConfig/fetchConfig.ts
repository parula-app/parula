import type { MailAccount } from "../MailAccount";
import { readConfigFromXML } from "./readConfig";
import { getConfigDir } from "../../util/backend-wrapper";
import { appGlobal } from "../../app";
import { PriorityAbortable, makeAbortable } from "../../util/flow/Abortable";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { getBaseDomainFromHost } from "../../util/netUtil";
import { assert, type URLString } from "../../util/util";
import { URLPart } from "../../util/blob";
import type { ArrayColl } from "svelte-collections";

/** Implements the Autoconfig protocol
 * <https://www.ietf.org/archive/id/draft-ietf-mailmaint-autoconfig-04.html> */
export async function fetchConfig(domain: string, emailAddress: string, abort: AbortController): Promise<ArrayColl<MailAccount>> {
  domain = sanitize.hostname(domain);
  console.log("AutoConfig for", domain);

  let priorityOrder = new PriorityAbortable(abort, [
    fetchConfigFromDisk(domain, abort),
    fetchConfigFromISPDB(domain, abort),
    fetchConfigFromISP(domain, emailAddress, abort),
    fetchConfigForMX(domain, abort),
  ]);
  try {
    let config = await priorityOrder.run();
    console.log("Fetch config results:\n" + priorityOrder.printResults);
    return config;
  } catch (ex) {
    throw new Error(`Could not find a config for ${domain}`);
  }
}

const kISPDBURL = "https://v1.ispdb.net/";
const kDNSoverHTTPSService = "https://1.1.1.1/dns-query?";

/**
 * Tries to get a configuration for this ISP from our central database.
 */
async function fetchConfigFromISPDB(domain: string, abort: AbortController) {
  let xmlStr = await fetchText(kISPDBURL + domain, abort);
  return readConfigFromXML(xmlStr, domain, "ispdb");
}

async function fetchConfigFromISP(domain: string, emailAddress: string | null, abort: AbortController) {
  let url1 = `https://autoconfig.${domain}/mail/config-v1.1.xml`;
  if (emailAddress) {
    url1 += URLPart`?emailaddress=${emailAddress}`;
  }
  let url2 = `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`;
  let url3 = `http://autoconfig.${domain}/mail/config-v1.1.xml`; // TODO HTTP needed, given MX?

  let priorityOrder = new PriorityAbortable(abort, [
    fetchText(url1, abort),
    fetchText(url2, abort),
    fetchText(url3, abort),
  ]);
  let xmlStr = await priorityOrder.run();
  console.log("Fetch from ISP results:\n" + priorityOrder.printResults);
  return readConfigFromXML(xmlStr, domain, "autoconfig-isp");
}

async function fetchConfigFromDisk(domain: string, abort: AbortController) {
  let fileName = await appGlobal.remoteApp.path.join(await getConfigDir(), "autoconfig", sanitize.filename(domain) + ".xml");
  let xmlArray = await appGlobal.remoteApp.readFile(fileName, { encoding: "utf-8" });
  let xmlStr = new TextDecoder().decode(xmlArray);
  if (!xmlStr) {
    return null;
  }
  return readConfigFromXML(xmlStr, domain, "harddisk");
}

async function fetchConfigForMX(domain, abort: AbortController): Promise<ArrayColl<MailAccount>> {
  let mx = await getMX(domain, abort);
  let baseDomain = getBaseDomainFromHost(mx); // e.g. "foo.com" for "mx1.olc.foo.com"
  let longDomain = mx.split(".").slice(1).join("."); // everything after host, e.g. "olc.foo.com" for "mx1.olc.foo.com"
  console.log("AutoConfig MX for", domain, "->", baseDomain, baseDomain != longDomain ? longDomain : "");
  let requests = [
    fetchConfigFromISP(longDomain, null, abort), // without emailAddress
    fetchConfigFromISPDB(longDomain, abort),
  ];
  if (baseDomain.length < longDomain.length) {
    requests.push(
      fetchConfigFromISP(baseDomain, null, abort), // ditto
      fetchConfigFromISPDB(baseDomain, abort),
    );
  }
  let priorityOrder = new PriorityAbortable(abort, requests);
  let config = await priorityOrder.run();
  console.log("Fetch via MX results:\n" + priorityOrder.printResults);
  return config;
}

/**
 * Queries the DNS MX for the domain
 *
 * @param domain {String}
 * @returns hostname of the first MX server
 */
async function getMX_node(domain: string, abort: AbortController): Promise<string> {
  let results = []; // await dns.resolveMx(domain);
  let result = results[0];
  assert(result, `No MX found for domain ${domain}`);
  return sanitize.hostname(result.exchange);
}

/**
 * Queries the DNS MX for the domain
 *
 * TODO Use DoH?
 * TODO Cache result
 * TODO Query both web service and local DNS, and
 * use the result only when they match.
 *
 * @param domain {String}
 * @returns hostname of the first MX server
 */
export async function getMX(domain: string, abort: AbortController): Promise<string> {
  // `curl -H "Accept: application/dns-json" "https://1.1.1.1/dns-query?name=knipp.de&type=MX" | json_pp`
  let params = new URLSearchParams();
  params.set("name", domain);
  params.set("type", "MX");
  let json = await fetchJSON(kDNSoverHTTPSService + params, "application/dns-json", abort);
  let answers = json?.Answer?.filter(a => a.type == 15 || a.type == "MX");
  let mxLine = answers?.[0]?.data as string; // e.g. "15 mx.knipp.de."
  let mx = mxLine.split(" ")[1]?.slice(0, -1);
  assert(mx, `No MX found for domain ${domain}`);
  return sanitize.hostname(mx);
}

let ky;

async function fetchText(url: URLString, abort: AbortController): Promise<string> {
  if (!ky) {
    ky = await appGlobal.remoteApp.kyCreate({
      timeout: 3000,
    });
  }
  console.log("AutoConfig", url);
  let text = await makeAbortable(ky.get(url, {
    result: "text",
    retry: 0,
  }), abort);
  assert(text && typeof (text) == "string", "Did not receive text");
  return text;
}

async function fetchJSON(url: URLString, resultMIMEType: string, abort: AbortController): Promise<any> {
  if (!ky) {
    ky = await appGlobal.remoteApp.kyCreate({
      timeout: 3000,
    });
  }
  let text = await makeAbortable(ky.get(url, {
    result: "json",
    headers: {
      Accept: resultMIMEType,
    },
    retry: 0,
  }), abort);
  assert(text && typeof (text) == "object", "Did not receive JSON");
  return text;
}
