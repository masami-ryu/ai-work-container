import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // デフォルトは Node 環境。フロントテスト（*.browser.test.*）は jsdom 環境を使用
    environmentMatchGlobs: [
      ["src/**/*.browser.test.*", "jsdom"],
    ],
  },
});
