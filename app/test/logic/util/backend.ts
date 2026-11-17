import JPCWebSocket from '../../../../lib/jpc-ws/protocol';
import { appGlobal } from '../../../logic/app';
import { production } from '../../../logic/build';
import { beforeEach } from 'vitest';

/**
 * Start dev backend: `JPC_SECRET=password-with-32-chars yarn dev`
 * Run tests: `JPC_SECRET=password-with-32-chars yarn test`
 * The env var only works in dev builds.
 * The passcode can only be alpha-num-dash chars.
 */
let jpcSecret = process.env.JPC_SECRET;
let haveBackend = !!jpcSecret && jpcSecret.length >= 32;

/** Without the secret, there is no dev backend to talk to, so skip all tests
 * that need it. Registered here, so that the test files need no change. */
beforeEach(ctx => ctx.skip(!haveBackend,
  "needs the dev backend: `JPC_SECRET=<32 chars or more> yarn dev`, and the same JPC_SECRET for the test process"));

let gJPC: JPCWebSocket;

export async function connectToBackend() {
  if (!haveBackend) {
    return; // the tests are skipped, see above
  }
  let jpc = new JPCWebSocket(null);
  await jpc.connect(jpcSecret, "localhost", production ? 5455 : 5453);
  appGlobal.remoteApp = await jpc.getRemoteStartObject();
  gJPC = jpc; // only after connecting: `close()` fails on a half-built socket
}

export async function stopBackend() {
  await gJPC?.close();
}
