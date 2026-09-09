import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @ffmpeg-installer/ffmpeg resolves its platform-specific binary
  // package via a dynamic require() built from process.platform/arch
  // (see its index.js) — the bundler can't statically trace that, the
  // same class of problem sharp already needed a default exemption
  // for. fluent-ffmpeg is external alongside it since it wraps that
  // package directly.
  serverExternalPackages: ["@ffmpeg-installer/ffmpeg", "@ffprobe-installer/ffprobe", "fluent-ffmpeg"],
};

export default nextConfig;
