import { defineConfig, devices } from '@playwright/test';

const projects = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
];
if (process.env.CI) {
  projects.push(
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  );
}

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  projects,
  webServer: {
    command: 'npm run build && npm run preview -- --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
