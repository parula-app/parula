import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig, defaultClientConditions } from 'vite'
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { svelte } from '@sveltejs/vite-plugin-svelte';
import wasm from 'vite-plugin-wasm';
import conditionalCompile from "vite-plugin-conditional-compile";
import { webMail, isMobile, includeProprietary, production } from './logic/build';

const conditionalCompilePlugin: any = conditionalCompile({ // its types say that it returns an array, but it returns one plugin
  // <https://github.com/LZS911/vite-plugin-conditional-compile/blob/master/README.md>
  env: {
    // For conditional `// #if [FOO]` statements in the code
    WEBMAIL: webMail && includeProprietary ? webMail : undefined,
    MOBILE: isMobile,
    PROPRIETARY: includeProprietary ? true : undefined,
    PRODUCTION: production ? true : undefined,
  },
});

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    port: 5454,
    strictPort: true,
  },

  plugins: [
    {
      ...conditionalCompilePlugin,
      transform: { filter: { code: "#if" }, handler: conditionalCompilePlugin.transform }, // the plugin parses every file with Babel, which is slow, so give it only the files that use `#if`
    },
    nodePolyfills({ include: ['buffer'], globals: { global: true, process: !!webMail } }),
    svelte(),
    wasm(),
    sentryVitePlugin({
      url: "https://errorlog.parula.app/",
      org: "bugsink-has-no-orgs",
      project: "parula",
        disable: !production,
    })
  ],
  resolve: {
    // Explicitly set the resolve conditions for Vite 7+
    conditions: [...defaultClientConditions],
  },
  optimizeDeps: {
    exclude: ['@matrix-org/matrix-sdk-crypto-wasm'],
  },
  json: {
    namedExports: false, // else each translation file becomes a module with thousands of exports, which every test file loads again
  },
  test: {
    pool: "threads", // faster than the default `forks`, because threads start faster and pass messages faster than processes
    globalSetup: "test/logic/Calendar/timeZone.ts", // worker threads can't change the time zone, so it's set once for all tests
    server: {
      deps: {
        // Workaround for app/logic/Abstract/Workspace.ts
        inline: [/lucide-svelte/],
      },
    },
    setupFiles: ["test/realtimeWait.ts"], // the tests should not wait the real time for network timeouts, retries and throttling
  },
  build: {
    sourcemap: true
  },
  base: './',
});
