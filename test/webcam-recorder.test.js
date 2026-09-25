import { describe, it, expect } from 'vitest';
import { RESOLUTIONS, resolutionById, videoConstraints, cameraLabel, describeSettings, webcamSupport } from '../src/_shared/webcam-recorder.js';

describe('웹캠 녹화', () => {
  it('해상도', () => {
    expect(RESOLUTIONS.map((r) => r.id)).toEqual(['480p', '720p', '1080p']);
    expect(resolutionById('nope').id).toBe('720p');
  });
  it('카메라 설정', () => {
    expect(videoConstraints({ res: '1080p' })).toEqual({ width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, facingMode: 'user' });
    const c = videoConstraints({ deviceId: 'abc', res: '480p' });
    expect(c.deviceId).toEqual({ exact: 'abc' }); expect(c.facingMode).toBeUndefined(); expect(c.width.ideal).toBe(640);
  });
  it('이름·설명', () => {
    expect(cameraLabel({ label: '' }, 1)).toBe('카메라 2'); expect(cameraLabel({ label: 'FaceTime HD' }, 0)).toBe('FaceTime HD');
    expect(describeSettings({ width: 1280, height: 720, frameRate: 29.97 })).toBe('1280×720 · 30fps');
    expect(describeSettings({})).toBe('');
  });
  it('지원 여부', () => {
    expect(webcamSupport({ getUserMedia: true, mediaRecorder: true }).ok).toBe(true);
    expect(webcamSupport({ getUserMedia: false, mediaRecorder: true }).ok).toBe(false);
  });
});
