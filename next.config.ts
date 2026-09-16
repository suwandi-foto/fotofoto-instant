import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @ffmpeg-installer/ffmpeg resolves its platform-specific binary
  // package via a dynamic require() built from process.platform/arch
  // (see its index.js) — the bundler can't statically trace that, the
  // same class of problem sharp already needed a default exemption
  // for. fluent-ffmpeg is external alongside it since it wraps that
  // package directly.
  serverExternalPackages: ["@ffmpeg-installer/ffmpeg", "@ffprobe-installer/ffprobe", "fluent-ffmpeg"],

  // serverExternalPackages above only stops the bundler from trying to
  // (and failing to) statically bundle these — it doesn't guarantee
  // their actual platform binary files survive whatever file-tracing
  // step a host's build/deploy pipeline runs to decide what to copy
  // into the production runtime (the same tracer that needs this exact
  // exemption for `sharp`, per Next's own docs). Production (Hostinger)
  // confirmed this gap for real: video uploads 500'd with "Failed to
  // load external module @ffmpeg-installer/ffmpeg-...", i.e. the
  // platform-specific binary package never made it to the deployed
  // node_modules even though serverExternalPackages was already set.
  outputFileTracingIncludes: {
    "/*": ["node_modules/@ffmpeg-installer/**/*", "node_modules/@ffprobe-installer/**/*"],
  },
};

export default nextConfig;
