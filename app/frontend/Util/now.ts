import { k1MinuteMS } from "../../logic/util/date";
import { readable } from "svelte/store";

/** The current time, updated every minute */
export const now = readable(new Date(), set => {
  let timeout: ReturnType<typeof setTimeout>;
  function update() {
    let time = new Date();
    timeout = setTimeout(update, k1MinuteMS - time.getSeconds() * 1000 - time.getMilliseconds());
    time.setSeconds(0, 0);
    set(time);
  }
  update();
  return () => clearTimeout(timeout);
});
