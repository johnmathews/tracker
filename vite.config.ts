import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import vueDevTools from 'vite-plugin-vue-devtools'
import { APP_NAME } from './src/lib/app.ts'

const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:8000'
const apiProxy = Object.fromEntries(
  [
    '/api',
    '/.well-known/oauth-protected-resource/api/mcp',
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-authorization-server',
  ].map((path) => [path, apiUrl]),
)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    // The e2e suite (playwright.config.ts) sets PLAYWRIGHT: the DevTools overlay is UI the app
    // doesn't have, and axe and the 375px check would measure it.
    process.env.PLAYWRIGHT ? null : vueDevTools(),
    // The page title is the app's one name (src/lib/app.ts), written into index.html.
    {
      name: 'app-name',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) => html.replaceAll('%APP_NAME%', APP_NAME),
      },
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // In development the API runs separately (docs/development.md); the browser still sees one
  // origin, as it does behind nginx. The API's PUBLIC_ORIGIN must be the dev server's origin.
  // The OAuth discovery documents (/.well-known/...) are the API's too; nginx proxies the same paths.
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
})
