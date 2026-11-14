export default {
  testDir: './tests',
  testMatch: /.*\.spec\.js/,
  timeout: 180000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4190',
    headless: true,
    viewport: { width: 1366, height: 768 },
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: { command: 'python3 -m http.server 4190 --bind 127.0.0.1', url: 'http://127.0.0.1:4190', reuseExistingServer: true },
};
