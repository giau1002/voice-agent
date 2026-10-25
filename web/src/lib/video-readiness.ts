/** Keep the portrait visible until WebRTC supplies an actual, non-black frame.
 * `playing` can fire while the decoder still outputs its black startup frames.
 * Stop sampling as soon as the first usable frame arrives.
 */
export function waitForPortraitFrame(video: HTMLVideoElement, onReady: () => void): () => void {
  let active = true;
  let callback = 0;
  let canvas: HTMLCanvasElement | undefined;
  let lastCheck = -Infinity;
  const hasFrameCallback = typeof video.requestVideoFrameCallback === 'function';

  function hasContent() {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return false;
    canvas ??= Object.assign(document.createElement('canvas'), { width: 16, height: 16 });
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return false; // The source photo remains a usable fallback.
    try {
      context.drawImage(video, 0, 0, 16, 16);
      const pixels = context.getImageData(0, 0, 16, 16).data;
      let visible = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        // Also reject limited-range black (RGB 16), allowing compression noise.
        if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 32) visible++;
      }
      return visible >= 16;
    } catch {
      // A stream can be replaced between the readiness check and drawImage.
      return false;
    }
  }

  function inspect(now: number) {
    if (!active) return;
    if (hasFrameCallback || now - lastCheck >= 100) {
      lastCheck = now;
      if (hasContent()) {
        active = false;
        onReady();
        return;
      }
    }
    schedule();
  }

  function schedule() {
    callback = hasFrameCallback
      ? video.requestVideoFrameCallback(inspect)
      : requestAnimationFrame(inspect);
  }
  schedule();
  return () => {
    active = false;
    if (hasFrameCallback) video.cancelVideoFrameCallback(callback);
    else cancelAnimationFrame(callback);
  };
}
