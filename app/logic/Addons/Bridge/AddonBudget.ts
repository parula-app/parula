/** Limits what one addon holds and runs in the app, over all its frames and its worker */
export class AddonBudget {
  readonly maxHandles: number;
  /** App objects that the addon holds */
  handles = 0;
  /** Calls of the addon that run in the app */
  inFlight = 0;
  /** Operations of the addon that wait for their turn */
  backlog = 0;

  constructor(maxHandles = 100000) {
    this.maxHandles = maxHandles;
  }
}
