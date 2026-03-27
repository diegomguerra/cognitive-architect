import type { CapacitorConfig } from '@capacitor/cli';

/**
 * FIX P4: server.url must NOT be present in production/TestFlight builds.
 * When server.url is set, Capacitor loads JS from a remote server. On TestFlight,
 * this creates a race between the remote JS loading and the native plugin being
 * registered by MyViewController — HealthKit calls can fire before the bridge is ready.
 *
 * Use VITE_DEV_SERVER_URL env var to enable live-reload only during local development:
 *   VITE_DEV_SERVER_URL=https://your-lovable-url.com npx cap run ios
 *
 * For TestFlight / App Store builds: run `npm run build` first, then `npx cap sync ios`.
 * The built webDir (dist/) will be bundled into the app — no remote URL.
 */
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'com.vyrlabs.app',
  appName: 'VYR Labs',
  webDir: 'dist',
  ios: {
    scheme: 'VYR Labs',
    contentInset: 'automatic',
  },
  // FIX P4: server block only active when VITE_DEV_SERVER_URL is explicitly set
  ...(devServerUrl
    ? {
        server: {
          url: devServerUrl,
          cleartext: true,
          allowNavigation: [
            'uirbicdwikvgnuounlia.supabase.co',
            '*.supabase.co',
          ],
        },
      }
    : {}),
  plugins: {
    App: {
      url: 'com.vyrlabs.app',
    },
  },
};

export default config;
