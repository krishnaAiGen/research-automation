import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module — keep it out of the bundler and let
  // Node require it at runtime, otherwise the .node binary never resolves.
  serverExternalPackages: ["better-sqlite3", "nodemailer"],
};

export default nextConfig;
