import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // core is consumed as TypeScript source, so Next compiles it with the app.
  transpilePackages: ["@tokenburnmarket/core"],
};

export default nextConfig;
