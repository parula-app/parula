import { getBaseDomainFromHost } from "../../../logic/util/netUtil";

/**
 * Splits the email address right before its base domain.
 * The base domain is what shows the end user who really sent the email,
 * so the UI emphasizes it and never cuts it off.
 *
 * E.g. for "fred@mail.example.co.uk" returns
 * `{ start: "fred@mail.", baseDomain: "example.co.uk" }`
 *
 * If there is no known base domain, e.g. for "fred@localhost",
 * the whole hostname is the base domain.
 */
export function splitAtBaseDomain(emailAddress: string): { start: string, baseDomain: string } {
  emailAddress ??= "";
  let atPos = emailAddress.lastIndexOf("@");
  if (atPos < 0) {
    return { start: emailAddress, baseDomain: "" };
  }
  let hostname = emailAddress.substring(atPos + 1);
  let lowerHostname = hostname.toLowerCase();
  let baseDomain: string | null = null;
  try {
    baseDomain = getBaseDomainFromHost(lowerHostname);
  } catch (ex) {
    // Do not throw in UI code. Treat the whole hostname as base domain.
  }
  let isSubdomain = baseDomain && lowerHostname.endsWith("." + baseDomain);
  let baseDomainPos = isSubdomain
    ? emailAddress.length - baseDomain.length
    : atPos + 1;
  return {
    start: emailAddress.substring(0, baseDomainPos),
    baseDomain: emailAddress.substring(baseDomainPos),
  };
}
