import type { URLString } from "../../util/util";

export interface TGraphAPIErrorResponse {
  type: string;
  status: number;
  detail: string;
  limit?: number;
}

export interface TGraphAPICallError {
  type: string;
  status: number;
  detail: string;
}

/** <https://learn.microsoft.com/en-us/graph/json-batching> */
export interface TGraphBatchRequest {
  method: string,
  /** like `path` of `GraphAccount.graphCall()` */
  path: string,
  body?: any,
}

export interface TGraphBatchResponse {
  id: string,
  status: number,
  headers?: Record<string, string>,
  body?: any,
}

/** Information about our own user */
export interface TGraphMe {
  id: UUID,
  displayName: string,
  givenName: string,
  surname: string,
  jobTitle: string,
  /** email address */
  userPrincipalName: string,
  /** email address */
  mail: string,
  businessPhones: string[],
  mobilePhone: string,
  officeLocation: string,
  /** locale, e.g. "en-US" */
  preferredLanguage: string,
}

/** ISO date time string, with "Z" as timezone,
 * e.g. "2023-01-04T11:24:48.999Z" */
export type DateTimeString = string;
/** E.g. "18e9526c-2286-41a1-aeeb-4badee766063" */
export type UUID = string;
/** E.g. "MGItNGEzM2E3OTZiZTMGItNGEzM2E3OTZiZTMGItNGEzM2E3OTZiZT" */
export type IDString = string;
/** E.g. "text/html" or "multipart/related" */
export type MIMEType = string;
