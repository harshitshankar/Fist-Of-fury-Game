import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fistoffury.app',
  appName: 'Fist of Fury',
  webDir: 'dist',
  plugins: {
    AdMob: {
      initializeForTesting: true
    }
  }
};

export default config;