const { chromium } = require('@playwright/test');

(async () => {
  const context = await chromium.launchPersistentContext(
    './.pw-profile-salonboard',
    {
      headless: false,
      args: [
        '--disable-http2',
        '--disable-quic',
        '--lang=ja-JP',
      ],
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      viewport: { width: 1365, height: 768 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    }
  );

  const page = await context.newPage();

  await page.goto('https://salonboard.com/login/', {
    waitUntil: 'domcontentloaded',
  });

  await page.pause();
})();