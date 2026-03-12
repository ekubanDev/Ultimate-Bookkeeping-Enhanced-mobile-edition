import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ultimatebookkeeping.app',
  appName: 'Ultimate Bookkeeping',
  webDir: 'build',
  server: {
    url: undefined,
    androidScheme: 'https',
    iosScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#0f1419',
      showSpinner: true,
      spinnerColor: '#007bff',
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      backgroundColor: '#0f1419',
      style: 'LIGHT',
    },
    Camera: {
      permissions: ['camera', 'photos'],
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#0f1419',
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
  },
  ios: {
    contentInset: 'always',
    backgroundColor: '#0f1419',
    preferredContentMode: 'mobile',
    scheme: 'Ultimate Bookkeeping',
  },
};

export default config;
