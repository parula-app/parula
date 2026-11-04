// @vitest-environment happy-dom
import { LicenseStatus } from "../../../Settings/License/LicenseStatus";
import { BadTicket, Ticket } from "../../../../logic/util/LicenseClient";
import { expect, test } from "vitest";

function ticket(daysFromNow: number): Ticket {
  let license = new Ticket();
  license.valid = true;
  license.expiresOn = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  return license;
}

test("A valid license needs nothing", () => {
  let status = new LicenseStatus(ticket(100));
  expect(status.text).toContain("valid until");
  expect(status.needsPurchase).toBe(false);
});

test("A license that expires soon can be renewed", () => {
  let status = new LicenseStatus(ticket(5));
  expect(status.text).toContain("expires in");
  expect(status.needsPurchase).toBe(true);
  expect(status.purchaseLabel).toBe("Renew License");
});

test("An expired license can be renewed", () => {
  let status = new LicenseStatus(ticket(-3));
  expect(status.text).toContain("has expired");
  expect(status.needsPurchase).toBe(true);
});

test("Without a license, the user can buy one", () => {
  let status = new LicenseStatus(new BadTicket());
  expect(status.text).toContain("buy a license");
  expect(status.purchaseLabel).toBe("Buy License");
  expect(status.needsPurchase).toBe(true);
});
