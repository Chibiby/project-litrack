/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
