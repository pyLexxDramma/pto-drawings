import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // next dev за CloudPub / другим хостом — иначе браузерные запросы к /_next/* режутся
  allowedDevOrigins: [
    "responsibly-brisk-oryx.cloudpub.ru",
    "*.cloudpub.ru",
  ],
  serverExternalPackages: ["unpdf", "pdfjs-dist"],
  experimental: {
    serverActions: {
      bodySizeLimit: "80mb",
    },
    proxyClientMaxBodySize: "80mb",
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    };
    return config;
  },
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/pdf.worker.min.mjs",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400",
          },
        ],
      },
      {
        source: "/icon.svg",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
