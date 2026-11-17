// @vitest-environment happy-dom
import { CertificateRequest } from "../../../Settings/TrustCenter/CertificateRequest";
import { expect, test } from "vitest";

test("Certificate request: subject from the identity, empty fields left out, country upper case", () => {
  let request = CertificateRequest.forIdentity({ realname: "Anna Smith", emailAddress: "anna@example.com" } as any, "de-DE");
  expect(request.country).toBe("DE");
  request.organization = " ACME ";
  request.country = "de";
  expect(request.subject).toEqual({ E: "anna@example.com", CN: "Anna Smith", O: "ACME", C: "DE" });
  expect(() => request.validate()).not.toThrow();
});

test("Certificate request: name required, country as 2 letters", () => {
  let request = CertificateRequest.forIdentity({ realname: "", emailAddress: "anna@example.com" } as any, "en");
  expect(request.country).toBe("");
  expect(() => request.validate()).toThrow();
  request.name = "Anna";
  request.country = "Germany";
  expect(() => request.validate()).toThrow();
  request.country = "";
  expect(() => request.validate()).not.toThrow();
});
