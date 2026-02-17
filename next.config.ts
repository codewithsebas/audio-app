import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["ffmpeg-static"],
  },
};

export default nextConfig;
