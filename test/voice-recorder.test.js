import { describe, it, expect } from 'vitest';
import { levelOf, holdPeak, micConstraints, levelHint, micSupport } from '../src/_shared/voice-recorder.js';

describe('음성 녹음기', () => {
  it('레벨', () => {
    const l = levelOf(new Float32Array([0.5, -0.5, 0.5, -0.5]));
    expect(l.peakDb).toBeCloseTo(-6.02, 2); expect(l.rmsDb).toBeCloseTo(-6.02, 2);
    expect(levelOf(new Float32Array(4)).peakDb).toBe(-Infinity);
  });
  it('피크 유지', () => {
    expect(holdPeak(-Infinity, -10, 0.1)).toBe(-10);
    expect(holdPeak(-10, -5, 0.1)).toBe(-5);
    expect(holdPeak(-10, -40, 0.5)).toBe(-20);
    expect(holdPeak(-10, -12, 1)).toBe(-12);
  });
  it('마이크 설정', () => {
    expect(micConstraints()).toEqual({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    expect(micConstraints({ raw: true, deviceId: 'x' })).toEqual({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, deviceId: { exact: 'x' } });
  });
  it('문구', () => {
    expect(levelHint(-70)).toContain('거의'); expect(levelHint(-0.5)).toContain('큽니다'); expect(levelHint(-12)).toBe('적당합니다');
    expect(micSupport({ getUserMedia: true, mediaRecorder: false }).ok).toBe(false);
  });
});
