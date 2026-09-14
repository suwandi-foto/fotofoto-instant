/**
 * Trivial content-type/filename checks used by the upload pipeline to
 * branch between the photo and video code paths. Deliberately kept
 * free of any ffmpeg dependency — @/lib/video imports
 * @ffmpeg-installer/ffmpeg at module load time (to call
 * ffmpeg.setFfmpegPath), so importing even one unrelated helper from
 * that file forces ffmpeg to resolve its bundled binary before every
 * plain photo upload too. On hosts where that binary doesn't resolve,
 * that turned a video-only problem into one that broke photo uploads
 * as well.
 */
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "m4v", "avi"]);

export function isVideoContentType(contentType: string): boolean {
  return contentType.toLowerCase().startsWith("video/");
}

export function isVideoFileName(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return !!ext && VIDEO_EXTENSIONS.has(ext);
}
