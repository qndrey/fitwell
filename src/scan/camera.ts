export type CameraError = 'denied' | 'unavailable' | 'insecure';

export interface Camera {
  stop(): void;
}

export class CameraFailure extends Error {
  constructor(readonly kind: CameraError) {
    super(kind);
  }
}

/** Opens the back camera in `video`. Resolves once frames are flowing. Video never leaves the device. */
export async function startCamera(video: HTMLVideoElement): Promise<Camera> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new CameraFailure(window.isSecureContext ? 'unavailable' : 'insecure');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    throw new CameraFailure(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
  }
  video.srcObject = stream;
  video.muted = true;
  video.setAttribute('playsinline', 'true'); // iOS: stay inline instead of going fullscreen
  try {
    await video.play();
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    throw new CameraFailure('unavailable');
  }
  return {
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}
