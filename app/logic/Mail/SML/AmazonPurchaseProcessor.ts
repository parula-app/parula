import type { EMail } from "../EMail";
import { HTMLDataProcessor } from "./HTMLDataProcessor";
import { DeliveryStatus, ProductPurchase, gPurchases } from "./ProductPurchase";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

export abstract class AmazonPurchaseProcessor extends HTMLDataProcessor {
  // Domain after @ in the From: address
  fromDomains = [
    "amazon.com",
    // Big EU countries
    "amazon.de",
    "amazon.fr",
    "amazon.it",
    "amazon.co.uk",
    // Other countries
    "amazon.ae",
    "amazon.ca",
    "amazon.cn",
    "amazon.eg",
    "amazon.es",
    "amazon.ie",
    "amazon.in",
    "amazon.nl",
    "amazon.pl",
    "amazon.sa",
    "amazon.sg",
    "amazon.se",
    // Other countries with SLD
    "amazon.co.jp",
    "amazon.co.za",
    "amazon.com.au",
    "amazon.com.be",
    "amazon.com.br",
    "amazon.com.mx",
    "amazon.com.tr",
  ];
  async processDOM(email: EMail, doc: Document): Promise<void> {
    // Delivered notification doesn't contain product list
    let orderNumberE = doc.querySelector(".rio_delivery_feedback_container .rio_15_heavy_black") ||
      !doc.querySelector(".rio-text-585, .rio-text-379") && doc.querySelector(".rio-text-577, .rio-text-372")?.lastElementChild
    if (orderNumberE) {
      let orderNumber = sanitize.alphanumdash(orderNumberE?.textContent?.trim().replace("\u202B", ""), null);
      if (!orderNumber) {
        return;
      }
      let purchase = gPurchases.find(p => p.orderNumber == orderNumber);
      if (!purchase) {
        purchase = new ProductPurchase();
        purchase.orderNumber = orderNumber;
        purchase.platformName = "Amazon";
        purchase.paid = true;
        gPurchases.push(purchase);
      } else if (purchase.updated > email.sent) {
        return;
      }
      purchase.deliveryStatus = DeliveryStatus.Delivered;
      purchase.updated = new Date(email.sent);
      console.log("Amazon delivered", purchase.productName, purchase.priceString, purchase.deliveryStatus, purchase.deliveryTimeStr, purchase.orderNumber, purchase.orderURL, purchase);
      return;
    }

    // Order confirmation and delivery notifications do contain product list
    let orderNumberEs = doc.querySelectorAll(".rio-text-577, .rio-text-372");
    if (!orderNumberEs?.length) {
      return;
    }
    for (let orderNumberE of orderNumberEs) {
      let orderNumber = sanitize.alphanumdash(orderNumberE.lastElementChild?.textContent?.replace("\u202B", ""), null);
      if (!orderNumber) {
        return;
      }
      let orderRootE = orderNumberE.parentElement.parentElement.parentElement.parentElement.parentElement;
      let productNameEs = orderRootE.querySelectorAll(".rio-text-585, .rio-text-379");
      for (let productNameE of productNameEs) {
        let productName = sanitize.label(productNameE.firstElementChild?.textContent, null);
        if (!productName) {
          continue;
        }
        let purchase = gPurchases.find(p => p.orderNumber == orderNumber && p.productName.substring(0, 20) == productName.substring(0, 20));
        if (!purchase) {
          purchase = new ProductPurchase();
          purchase.orderNumber = orderNumber;
          purchase.productName = productName;
          purchase.platformName = "Amazon";
          purchase.paid = true;
          gPurchases.push(purchase);
        }
        purchase.productName ??= productName;
        purchase.orderURL ??= sanitize.url((productNameE.firstElementChild as HTMLAnchorElement)?.href, null);
        let productRootE = productNameE.parentElement.parentElement.parentElement.parentElement.parentElement;
        let priceE = productRootE.querySelector(".rio-text-591, .rio-text-384")?.firstElementChild;
        let subEs = priceE?.querySelectorAll("sup");
        if (priceE && subEs?.length <= 2) {
          let subArray = [...subEs];
          let centsStr = subArray.shift()?.textContent;
          let integerStr = priceE.firstChild?.textContent
          purchase.priceInCurrency ??= sanitize.float(integerStr + "." + centsStr, null);
          purchase.currency ??= subArray.pop()?.textContent;
          purchase.priceString ??= purchase.priceInCurrency + " " + purchase.currency;
        }
        purchase.count = sanitize.integer(productRootE.querySelector(".rio-text-589, .rio-text-383")?.textContent?.split(": ")[1], purchase.count);
        purchase.shopName ??= sanitize.label(productRootE.querySelector(".rio-text-586, .rio-text-380")?.textContent, null);
        if (purchase.shopName?.includes("Amazon")) {
          purchase.shopName = "Amazon";
        }

        if (!purchase.updated || purchase.updated.getTime() < email.sent.getTime()) {
          // Delivery status
          // rio numbers are 1 higher when active vs. in-active
          if (doc.querySelector(".rio-text-418, .rio-text-314")) {
            purchase.deliveryStatus = DeliveryStatus.Ordered;
          } else if (doc.querySelector(".rio-text-421, .rio-text-317")) {
            purchase.deliveryStatus = DeliveryStatus.Sent;
          } else if (doc.querySelector(".rio-text-424, .rio-text-320, .rio-header-93, .rio-header-39")) {
            purchase.deliveryStatus = DeliveryStatus.DeliveringToday;
          } else if (doc.querySelector(".rio-header-97, .rio_delivery_feedback_container")) {
            purchase.deliveryStatus = DeliveryStatus.Delivered;
          }
          // TODO Relative and translated "Ankunft morgen" is no misleading. Turn into absolute `Date` and set `deliveryTime`.
          purchase.deliveryTimeStr ??= sanitize.label(doc.querySelector(".rio-text-572, .rio-text-368")?.textContent, null);

          purchase.updated = new Date(email.sent);
        }
        console.log("Amazon purchase", purchase.productName, purchase.priceString, purchase.deliveryStatus, purchase.deliveryTimeStr, purchase.orderNumber, purchase.orderURL, purchase);
      }
    }
  }
}

function isBold(el: HTMLElement): boolean {
  return el?.parentElement.style?.fontWeight == "700";
}
