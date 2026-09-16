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
  // their actual platform binary files survive whatever copying step a
  // host's build/deploy pipeline uses to decide what ships to the
  // production runtime. This bit us for real on Hostinger: video
  // uploads 500'd with "Failed to load external module
  // @ffmpeg-installer/ffmpeg-...: Could not find ffmpeg executable".
  //
  // Root cause turned out to be Turbopack specifically (the default
  // bundler for `next build` since v16): its own externals-copying step
  // only copies the directly-required package, not the sibling platform
  // package (e.g. @ffmpeg-installer/linux-x64) it dynamically requires
  // at runtime based on process.platform/arch — and Turbopack has no
  // config surface (unlike webpack's outputFileTracingIncludes below)
  // to force extra files in. package.json's build script now passes
  // `--webpack` specifically to route around this: with webpack, Next
  // leaves a plain require("@ffmpeg-installer/ffmpeg") in the output
  // for Node to resolve normally against the real node_modules tree,
  // no copying step involved at all. outputFileTracingIncludes stays
  // as a second layer, in case a future deploy target trims node_modules
  // to only its own traced-files list.
  outputFileTracingIncludes: {
    "/*": ["node_modules/@ffmpeg-installer/**/*", "node_modules/@ffprobe-installer/**/*"],
  },
};

export default nextConfig;
