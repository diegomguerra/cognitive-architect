import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vyrlabs.app',
  appName: 'VYR Labs',
  webDir: 'dist',
  ios: {
    scheme: 'VYR Labs',
    contentInset: 'automatic',
  },
  server: {
    url: 'https://193ad5a4-8d3b-43d4-a430-348ba0154a42.lovableproject.com?forceHideBadge=true',
    cleartext: true,
    allowNavigation: [
      'uirbicdwikvgnuounlia.supabase.co',
      '*.supabase.co',
    ],
  },
  plugins: {
    App: {
      url: 'com.vyrlabs.app',
    },
  },
};

export default config;
