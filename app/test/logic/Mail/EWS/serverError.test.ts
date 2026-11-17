import { EWSError } from "../../../../logic/Mail/EWS/EWSError";
import { expect, test } from "vitest";

test("A response that is not XML says what the server sent", () => {
  let error = new EWSError({
    status: 200,
    statusText: "", // `fetch()` leaves this empty for HTTP/2
    responseText: "<html><body>Your session has expired.</body></html>",
    responseXML: null, // `parseXML()` could not parse it
  }, {});

  expect(error.message).toBe("<html><body>Your session has expired.</body></html>");
  expect(error.type).toBe("HTTP 200");
});

test("A response with neither XML nor a body says at least the HTTP status", () => {
  let error = new EWSError({ status: 200, statusText: "", responseText: "" }, {});

  expect(error.message).toBe("HTTP 200");
});
