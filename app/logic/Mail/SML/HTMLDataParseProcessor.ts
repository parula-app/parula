import { EMailProcessor, EMailProcessorList, ProcessingStartOn } from "../EMailProcessor";
import { HTMLDataProcessor } from "./HTMLDataProcessor";
import type { EMail } from "../EMail";
import { getDomainForEmailAddress } from "../../util/netUtil";
import { assert } from "../../util/util";
import type { Collection } from "svelte-collections";

/**
 * Reads the HTML DOM at email parse time,
 * and calls all registered `HTMLDataProcessor`s.
 *
 * Not used for displaying HTML content to the user.
 */
export abstract class HTMLDataParseProcessor extends EMailProcessor {
  runOn = ProcessingStartOn.Parse;
  async process(email: EMail): Promise<void> {
    if (!email.hasHTML) {
      return;
    }
    let processors = EMailProcessorList.processors.filterOnce(p => p instanceof HTMLDataProcessor) as Collection<HTMLDataProcessor>;
    if (processors.isEmpty) {
      return;
    }
    let fromDomains: string[] = [];
    let allDomains = false;
    for (let processor of processors.contents) {
      assert(processor.fromDomains?.length, "Please set fromDomains for " + processor);
      if (processor.fromDomains[0] == "*") {
        allDomains = true;
        break;
      }
      fromDomains = fromDomains.concat(processor.fromDomains);
    }
    let fromDomain = getDomainForEmailAddress(email.from?.emailAddress);
    if (!allDomains && !fromDomains.includes(fromDomain)) {
      return;
    }

    let dom = new DOMParser().parseFromString(email.html, "text/html");
    for (let processor of processors.contents) {
      if (!(processor.fromDomains[0] == "*" || processor.fromDomains.includes(fromDomain))) {
        continue;
      }
      processor.processDOM(email, dom)
        .catch(ex => email.folder.account.dataError(ex));
    }
  }
}
