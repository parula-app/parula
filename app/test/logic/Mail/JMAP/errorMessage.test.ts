import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { expect, test } from "vitest";

const kURL = "https://example.com/jmap/";

/** An `HTTPFetchError` as it arrives from the backend: scalar properties only */
function httpError(httpCode: number, responseBody?: string): Error {
  let ex = new Error(`HTTP POST <${kURL}> failed with ${httpCode}`);
  Object.assign(ex, { name: "HTTPError", httpCode, responseBody });
  return ex;
}

function newAccount(failWith: Error): JMAPAccount {
  appGlobal.remoteApp = {
    kyCreate: () => ({ post: async () => { throw failWith } }),
  } as any;
  return new JMAPAccount();
}

test("An HTTP error shows the error message of the server", async () => {
  // Example from <https://www.rfc-editor.org/rfc/rfc8620#section-3.6.1>
  let account = newAccount(httpError(400, JSON.stringify({
    type: "urn:ietf:params:jmap:error:limit",
    limit: "maxSizeRequest",
    status: 400,
    detail: "The request is larger than the server is willing to process.",
  })));

  let ex = await account.httpPost(kURL, {}).catch(ex => ex);

  expect(ex.message).toContain("The request is larger than the server is willing to process.");
});

test("An HTTP error without error message of the server keeps the HTTP message", async () => {
  let account = newAccount(httpError(502, "<html>Bad gateway</html>"));

  let ex = await account.httpPost(kURL, {}).catch(ex => ex);

  expect(ex.message).toContain("502");
});
