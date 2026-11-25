import { PersonUID, findPerson, kDummyPerson } from "../Abstract/PersonUID";
import { InvitationResponse, kInviteeResponses } from "./Invitation/InvitationStatus";
import { notifyChangedProperty } from "../util/Observable";
import { gt } from "../../l10n/l10n";

export class Participant extends PersonUID {
  @notifyChangedProperty
  response: InvitationResponse;
  /** DTSTAMP when the status was sent that is captured in this object.
   * Used during auto-update to avoid overwriting with older info.
   * We don't need to track local changes, only those sent by others.
   * Local changes sent to others will always get the current timestamp in `ICalGenerator` */
  lastUpdateTime: Date | null;

  constructor(emailAddress: string | null | undefined, name: string | null | undefined, response: InvitationResponse) {
    let person = emailAddress ? findPerson(emailAddress) : null;
    super(emailAddress ?? kDummyPerson.emailAddress, name ?? person?.name ?? emailAddress);
    this.person = person;
    this.response = response;
  }

  clone(): Participant {
    let clone = new Participant(this.emailAddress, this.name, this.response);
    clone.lastUpdateTime = this.lastUpdateTime;
    return clone;
  }

  get isInvitee(): boolean {
    return kInviteeResponses.includes(this.response);
  }

  get responseLabel(): string {
    return this.response == InvitationResponse.Organizer ? gt`Organizer *=> The person who invited to this meeting` :
    this.response == InvitationResponse.Accept ? gt`Confirmed *=> Accepted to join this business meeting` :
    this.response == InvitationResponse.Decline ? gt`Declined *=> Refused to join this business meeting` :
    this.response == InvitationResponse.Tentative ? gt`Tentative *=> Not sure to join this business meeting` :
    "";
  }
}
