import { EMailProcessor, EMailProcessorList, ProcessingStartOn } from "../EMailProcessor";
import { SMLData, transformDatesDuringJSONParse } from "./SMLData";
import { SMLProcessor } from "./SMLProcessor";
import type { EMail } from "../EMail";
import { assert } from "../../util/util";
import type { Collection } from "svelte-collections";

/**
 * Reads the SML JSON at email parse time,
 * and calls all applicable `SMLProcessor`s.
 */
export abstract class SMLParseProcessor extends EMailProcessor {
  runOn = ProcessingStartOn.Parse;
  async process(email: EMail): Promise<void> {
    if (email.sml) {
      return;
    }

    // TODO full vs. partial vs. non representation
    let attachment = email.attachments.find(a => a.mimeType == "application/ld+json");
    if (!attachment) {
      return;
    }
    assert(attachment.content, "Need SML attachment content to be loaded");
    let ldStr = await attachment.content.text();
    let sml = JSON.parse(ldStr, transformDatesDuringJSONParse);

    let data = new SMLData();
    data.fromJSON(sml);
    email.sml = data;

    let processors = EMailProcessorList.processors.filterOnce(p => p instanceof SMLProcessor) as Collection<SMLProcessor>;
    if (processors.hasItems) {
      for (let processor of processors) {
        if (!(processor.context == data.context && processor.types.includes(data.type))) {
          continue;
        }
        processor.processSML(email, sml)
          .catch(ex => email.folder.account.dataError(ex));
      }
    }
  }
}
