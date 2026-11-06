import { waitTime } from "../logic/util/util";

/** Whether the app waits the real time for network timeouts, retries and throttling.
 * false: The app and the tests wait 1/20 of it, so that the tests run faster.
 * true: To test with the real times. */
const kRealtimeWait = false;
waitTime.factor = kRealtimeWait ? 1 : 0.05;
