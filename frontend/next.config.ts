import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: false,
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
