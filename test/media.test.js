import { describe, it, expect } from 'vitest';
import {
  pickMime, supportedContainers, extForMime, baseMime, fmtClock, fmtSec, stampName, dbToGain, gainToDb,
  peakOf, rmsOf, meterFraction, mixToMono, resampleLinear, floatToInt16, encodeWav, decodeWav16,
  createClock, isMobileUA, VIDEO_AV_TYPES, AUDIO_TYPES,
} from '../src/_shared/media.js';

describe('녹화 형식 고르기', () => {
  const chrome = new Set(['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']);
  const firefox = new Set(['video/webm;codecs=vp8,opus', 'video/webm', 'audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']);
  it('MP4 를 먼저, 없으면 WebM', () => {
    expect(pickMime(VIDEO_AV_TYPES, (t) => chrome.has(t))).toBe('video/mp4;codecs=avc1,mp4a.40.2');
    expect(pickMime(VIDEO_AV_TYPES, (t) => firefox.has(t))).toBe('video/webm;codecs=vp8,opus');
    expect(pickMime(AUDIO_TYPES, (t) => firefox.has(t))).toBe('audio/webm;codecs=opus');
    expect(pickMime(VIDEO_AV_TYPES, () => false)).toBe('');
    expect(pickMime(['x'], () => { throw new Error('bad'); })).toBe('');
  });
  it('컨테이너별 하나씩', () => {
    expect(supportedContainers(VIDEO_AV_TYPES, (t) => chrome.has(t))).toEqual([
      { container: 'mp4', mime: 'video/mp4;codecs=avc1,mp4a.40.2' }, { container: 'webm', mime: 'video/webm;codecs=vp9,opus' }]);
  });
  it('확장자', () => {
    expect(extForMime('video/mp4;codecs=avc1')).toBe('mp4');
    expect(extForMime('audio/mp4')).toBe('m4a');
    expect(extForMime('audio/webm;codecs=opus')).toBe('webm');
    expect(extForMime('audio/ogg')).toBe('ogg');
    expect(extForMime('')).toBe('webm');
    expect(baseMime('video/webm;codecs=vp9,opus')).toBe('video/webm');
  });
});

describe('시간 표시', () => {
  it('시계', () => {
    expect(fmtClock(0)).toBe('0:00'); expect(fmtClock(65.9)).toBe('1:05'); expect(fmtClock(3725)).toBe('1:02:05');
    expect(fmtSec(0)).toBe('0:00.0'); expect(fmtSec(75.34)).toBe('1:15.3'); expect(fmtSec(9.96)).toBe('0:10.0');
  });
  it('파일 이름', () => expect(stampName('screen', new Date(2026, 8, 5, 7, 3, 9))).toBe('screen-20260905-070309'));
  it('일시정지를 뺀 경과 시간', () => {
    let t = 0; const c = createClock(() => t);
    c.start(); t = 1000; c.pause(); t = 5000; expect(c.elapsed()).toBe(1000);
    c.resume(); t = 7500; expect(c.elapsed()).toBe(3500);
  });
  it('모바일 추정', () => {
    expect(isMobileUA('Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile')).toBe(true);
    expect(isMobileUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 5)).toBe(true);
    expect(isMobileUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140')).toBe(false);
  });
});

describe('데시벨·레벨', () => {
  it('변환', () => {
    expect(dbToGain(0)).toBe(1); expect(dbToGain(-6)).toBeCloseTo(0.501187, 5); expect(gainToDb(0.5)).toBeCloseTo(-6.0206, 3);
    expect(gainToDb(0)).toBe(-Infinity);
  });
  it('피크·RMS', () => {
    const sine = Float32Array.from({ length: 48000 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 1000 * i / 48000));
    expect(peakOf([sine])).toBeCloseTo(0.5, 3);
    expect(rmsOf([sine])).toBeCloseTo(0.5 / Math.SQRT2, 4);
    expect(peakOf([new Float32Array([0.1, -0.9]), new Float32Array([0.2, 0.3])])).toBeCloseTo(0.9, 6);
  });
  it('레벨 막대', () => { expect(meterFraction(-60)).toBe(0); expect(meterFraction(-30)).toBe(0.5); expect(meterFraction(3)).toBe(1); expect(meterFraction(-Infinity)).toBe(0); });
});

describe('모노·리샘플링', () => {
  it('모노로 섞기', () => expect([...mixToMono([new Float32Array([1, 0, -1]), new Float32Array([0, 0, 1])])]).toEqual([0.5, 0, 0]));
  it('44.1k → 48k 길이와 사인 모양', () => {
    const f = 440, inp = Float32Array.from({ length: 44100 }, (_, i) => Math.sin(2 * Math.PI * f * i / 44100));
    const out = resampleLinear(inp, 44100, 48000);
    expect(out.length).toBe(48000);
    let maxErr = 0;
    for (let i = 0; i < 47000; i++) maxErr = Math.max(maxErr, Math.abs(out[i] - Math.sin(2 * Math.PI * f * i / 48000)));
    expect(maxErr).toBeLessThan(0.005);
  });
  it('같은 주파수면 그대로, 반으로 줄이기', () => {
    expect([...resampleLinear(new Float32Array([1, 2, 3]), 48000, 48000)]).toEqual([1, 2, 3]);
    expect([...resampleLinear(new Float32Array([0, 1, 2, 3]), 48000, 24000)]).toEqual([0, 2]);
  });
});

describe('WAV 16비트', () => {
  it('정수 변환과 자르기', () => {
    expect(floatToInt16(1)).toBe(32767); expect(floatToInt16(-1)).toBe(-32768); expect(floatToInt16(2)).toBe(32767);
    expect(floatToInt16(-3)).toBe(-32768); expect(floatToInt16(0.5)).toBe(16384); expect(floatToInt16(NaN)).toBe(0);
  });
  it('머리말', () => {
    const b = encodeWav([new Float32Array([0, 0.5, -0.5]), new Float32Array([1, -1, 0])], 44100);
    const v = new DataView(b.buffer);
    const s = (o) => String.fromCharCode(...b.slice(o, o + 4));
    expect(b.length).toBe(44 + 3 * 4);
    expect(s(0)).toBe('RIFF'); expect(v.getUint32(4, true)).toBe(36 + 12); expect(s(8)).toBe('WAVE');
    expect(s(12)).toBe('fmt '); expect(v.getUint16(20, true)).toBe(1); expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100); expect(v.getUint32(28, true)).toBe(44100 * 4);
    expect(v.getUint16(32, true)).toBe(4); expect(v.getUint16(34, true)).toBe(16);
    expect(s(36)).toBe('data'); expect(v.getUint32(40, true)).toBe(12);
    // 섞어 쓰기(interleave): L0 R0 L1 R1 …
    expect([0, 1, 2, 3, 4, 5].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 32767, 16384, -32768, -16384, 0]);
  });
  it('왕복', () => {
    const ch = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 10) * 0.8);
    const back = decodeWav16(encodeWav([ch], 48000));
    expect(back.sampleRate).toBe(48000); expect(back.channels.length).toBe(1);
    for (let i = 0; i < 1000; i += 37) expect(back.channels[0][i]).toBeCloseTo(ch[i], 4);
  });
  it('채널 없으면 오류', () => expect(() => encodeWav([], 48000)).toThrow());
});
