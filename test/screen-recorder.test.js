import { describe, it, expect } from 'vitest';
import { screenSupport, displayOptions, audioPlan, estimateMB } from '../src/_shared/screen-recorder.js';

describe('화면 녹화', () => {
  it('지원 여부 문구', () => {
    expect(screenSupport({ secure: true, getDisplayMedia: true, mediaRecorder: true }).ok).toBe(true);
    const m = screenSupport({ secure: true, getDisplayMedia: false, mediaRecorder: true, mobile: true });
    expect(m.ok).toBe(false); expect(m.msg).toContain('휴대폰');
    expect(screenSupport({ secure: true, getDisplayMedia: false, mediaRecorder: true }).msg).toContain('getDisplayMedia');
    expect(screenSupport({ secure: false, getDisplayMedia: true, mediaRecorder: true }).msg).toContain('https');
    expect(screenSupport({ secure: true, getDisplayMedia: true, mediaRecorder: false }).msg).toContain('MediaRecorder');
  });
  it('getDisplayMedia 옵션', () => {
    expect(displayOptions({ audio: false })).toEqual({ video: { frameRate: { ideal: 30 } }, audio: false, surfaceSwitching: 'include' });
    const o = displayOptions({ audio: true, frameRate: 60 });
    expect(o.audio).toBe(true); expect(o.systemAudio).toBe('include'); expect(o.video.frameRate.ideal).toBe(60);
  });
  it('소리 구성', () => {
    expect(audioPlan({})).toBe('none'); expect(audioPlan({ displayAudio: true })).toBe('display');
    expect(audioPlan({ mic: true })).toBe('mic'); expect(audioPlan({ displayAudio: true, mic: true })).toBe('mix');
  });
  it('크기 추정', () => expect(estimateMB(8 * 1024 * 1024, 60)).toBe(60));
});
