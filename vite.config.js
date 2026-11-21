import { defineConfig, loadEnv } from 'vite'
import { simpleAccessRollout } from './scripts/simple-access-rollout.mjs'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'

function currentCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'local'
  }
}

// Dev-server only: when testing against local emulators, allow the page to reach them.
// `apply: 'serve'` guarantees this never alters a production build.
function emulatorCsp(enabled) {
  return {
    name: 'zoko-emulator-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      if (!enabled) return html
      return html.replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*")
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [simpleAccessRollout(loadEnv(mode, process.cwd(), '').VITE_SIMPLE_ACCESS_ENABLED === 'true'), react(), emulatorCsp(loadEnv(mode, process.cwd(), '').VITE_USE_FIREBASE_EMULATORS === 'true' || process.env.VITE_USE_FIREBASE_EMULATORS === 'true')],
  base: '/Zoko-Master/',
  define: {
    'import.meta.env.APP_BUILD_DATE': JSON.stringify(new Date().toISOString()),
    'import.meta.env.APP_COMMIT_SHA': JSON.stringify(currentCommit()),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@firebase/') || id.includes('/node_modules/firebase/')) return 'firebase';
          if (id.includes('/node_modules/lucide-react/')) return 'icons';
          if (id.includes('/node_modules/react') || id.includes('/node_modules/scheduler/')) return 'react';
        },
      },
    },
  },
}))
