import type { EMail } from "./EMail";
import type { ExtraData } from "./ExtraData";
import { AbstractFunction, SpecificError } from "../util/util";
import { ArrayColl, MapColl } from "svelte-collections";
import type { Email as MIME } from "postal-mime";

export class EMailProcessorList {
  static processors = new ArrayColl<EMailProcessor>();
  static extraDataTypes = new MapColl<string, typeof ExtraData>();
}

export class EMailProcessor {
  runOn: ProcessingStartOn;
  async process(email: EMail, mime: MIME): Promise<void> {
    throw new AbstractFunction();
  }

  static hookup() {
    console.log("hookup", this.name);
    if (EMailProcessorList.processors.some(p => p instanceof this)) {
      return;
    }
    EMailProcessorList.processors.add(new this());
  }
  unhookup() {
    EMailProcessorList.processors.remove(this);
  }
}

/** A processor can't get the content of the mail, e.g. can't decrypt it */
export class CannotReadMail extends SpecificError {
  /** A problem of the mail, not a bug */
  isUserError = true;
}

/** For now, only Parse is supported */
export enum ProcessingStartOn {
  Parse = 1,
  BeforeSpamFilter = 2,
  NewMessage = 3,
  AfterFilterRules = 4,
  Sent = 5,
  Manual = 6,
  /** Parse time, with SML JSON already parsed */
  SML = 7,
  /** Parse time, with HTML DOM already parsed */
  HTMLDOM = 8,
}
