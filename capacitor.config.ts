import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fistoffury.app',
  appName: 'Fist of Fury',
  webDir: 'dist',
  plugins: {
    AdMob: {
      initializeForTesting: true
    }
  },
  // Optimize WebView performance for real-time multiplayer gaming
  android: {
    // Allow mixed content so WebSocket connections work reliably
    allowMixedContent: true,
    // Keep the WebView renderer running even when the app is in background briefly
    backgroundColor: '#0a0a2e',
  },
  server: {
    // Keep the WebSocket connection alive and reduce latency
    cleartext: true,
  }
};

export default config;