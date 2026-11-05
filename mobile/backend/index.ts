import { startupBackend, shutdownBackend, createJPCSecret } from './backend';
// #if [IOS]
import fs from 'node:fs';
// #else
import { createRequire } from 'node:module';
// `bridge` is a runtime-provided module from capacitor-nodejs, registered only as CJS
const require = createRequire(import.meta.url);
const { channel } = require('bridge') as { channel: any };
// #endif

const jpcSecret = createJPCSecret();

// Unlike Electron, the Capacitor WebView loads *before* the backend,
// so wait for the backend WebSocket to start up, so that the frontend knows when to connect.
let resolveStarted: () => void;
const started = new Promise<void>(resolve => { resolveStarted = resolve; });

// #if [!IOS]
channel.addListener('jpc:get-secret', async () => {
  await started;
  channel.send('jpc:secret', jpcSecret);
});
// #endif

async function startup(): Promise<void> {
  try {
    console.log(`Backend starting with node.js ${process.version}`);
    await startupBackend(jpcSecret);
    resolveStarted();
    // #if [IOS]
    // `NodeRunner.swift` passes the write end of a pipe as first argument,
    // and gives the frontend what we wrote there, once we closed it
    let pipe = Number(process.argv[2]);
    fs.writeSync(pipe, jpcSecret);
    fs.closeSync(pipe);
    // #endif
  } catch (ex) {
    console.error(ex);
  }
}

async function shutdown(): Promise<void> { // TODO call
  try {
    await shutdownBackend();
  } catch (ex) {
    console.error(ex);
  }
}

startup();
