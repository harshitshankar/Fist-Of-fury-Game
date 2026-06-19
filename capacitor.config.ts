import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fistoffury.app',
  appName: 'Fist of Fury',
  webDir: 'dist'
  server: {
    // OPTION A (recommended): load the live Render site.
    url: 'https://fist-of-fury-game.onrender.com/',
    cleartext: false,
    // OPTION B (local testing on same Wi-Fi): use your PC's IP + http.
    // url: 'http://192.168.1.5:3001',
    // cleartext: true,
  },
};

export default config;
