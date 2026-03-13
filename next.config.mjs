/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@lobehub/icons"],
  experimental: {
    serverComponentsExternalPackages: ["@google/genai", "@anthropic-ai/sdk", "e2b", "glob"],
  },
  // 禁用页面缓存，确保每次获取最新版本
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
