import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vyrlabs.app',
  appName: 'VYR Labs',
  webDir: 'dist',
  server: {
    url: 'https://193ad5a4-8d3b-43d4-a430-348ba0154a42.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
};

export default config;
