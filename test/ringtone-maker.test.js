import { describe, it, expect } from 'vitest';
import {
  RINGTONE_MAX_SEC, aacRateFor, clampSelection, waveformPeaks, fadeGain, renderSelection, chunkRanges, planarChunk,
  patchM4aBrand, aacConfigs, encodeM4a,
} from '../src/_shared/ringtone-maker.js';

const tag = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

describe('구간 고르기', () => {
  it('30초를 넘으면 반대쪽을 끌고 온다', () => {
    expect(RINGTONE_MAX_SEC).toBe(30);
    expect(clampSelection(10, 50, 120, { moved: 'end' })).toEqual({ start: 20, end: 50 });
    expect(clampSelection(10, 50, 120, { moved: 'start' })).toEqual({ start: 10, end: 40 });
  });
  it('곡 길이 밖으로 나가지 않는다', () => {
    expect(clampSelection(-5, 200, 100, { moved: 'end' })).toEqual({ start: 70, end: 100 });
    expect(clampSelection(95, 99, 100, { moved: 'start' })).toEqual({ start: 95, end: 99 });
  });
  it('너무 짧으면 1초로 벌린다', () => {
    expect(clampSelection(10, 10.2, 100, { moved: 'end' })).toEqual({ start: 9.2, end: 10.2 });
    expect(clampSelection(99.8, 99.9, 100, { moved: 'start' })).toEqual({ start: 99, end: 100 });
    expect(clampSelection(0, 0.3, 0.5, { moved: 'end' })).toEqual({ start: 0, end: 0.5 });
  });
  it('AAC 주파수', () => { expect(aacRateFor(44100)).toBe(44100); expect(aacRateFor(96000)).toBe(48000); });
});

describe('파형·페이드', () => {
  it('칸마다 최솟값·최댓값', () => {
    const p = waveformPeaks([new Float32Array([0, 1, -1, 0.5]), new Float32Array([0, 0, 0, -0.9])], 2);
    expect([...p.min]).toEqual([0, -1]); expect([...p.max].map((v) => +v.toFixed(3))).toEqual([1, 0.5]);
    expect(waveformPeaks([new Float32Array(0)], 3).max.length).toBe(3);
  });
  it('페이드 이득', () => {
    expect(fadeGain(0, 100, 10, 10)).toBe(0); expect(fadeGain(5, 100, 10, 10)).toBe(0.5); expect(fadeGain(50, 100, 10, 10)).toBe(1);
    expect(fadeGain(99, 100, 10, 10)).toBe(0); expect(fadeGain(94, 100, 10, 10)).toBe(0.5); expect(fadeGain(0, 100, 0, 0)).toBe(1);
  });
  it('자르고 페이드', () => {
    const fs = 100, ch = new Float32Array(1000).fill(1);
    const out = renderSelection([ch, ch, ch], fs, 2, 5, { fadeIn: 1, fadeOut: 0.5 });
    expect(out.length).toBe(2); // 스테레오까지만
    expect(out[0].length).toBe(300);
    expect(out[0][0]).toBe(0); expect(out[0][50]).toBe(0.5); expect(out[0][150]).toBe(1); expect(out[0][299]).toBe(0);
    expect(ch[200]).toBe(1); // 원본은 그대로
  });
});

describe('인코더에 넣을 조각', () => {
  it('나누기', () => { expect(chunkRanges(10, 4)).toEqual([[0, 4], [4, 4], [8, 2]]); expect(chunkRanges(0, 4)).toEqual([]); });
  it('planar', () => {
    const p = planarChunk([new Float32Array([1, 2, 3, 4]), new Float32Array([5, 6, 7, 8])], 1, 2);
    expect([...p]).toEqual([2, 3, 6, 7]);
  });
  it('설정 후보', () => expect(aacConfigs(44100, 2)[0]).toEqual({ codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 2, bitrate: 192000 }));
});

describe('M4A 브랜드', () => {
  it('ftyp 의 isom 을 M4A 로', () => {
    const b = new Uint8Array(24);
    const put = (o, s) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
    b[3] = 24; put(4, 'ftyp'); put(8, 'isom'); b[14] = 2; put(16, 'isom'); put(20, 'mp41');
    const out = patchM4aBrand(b);
    expect(tag(out, 8)).toBe('M4A '); expect(tag(out, 16)).toBe('M4A '); expect(tag(out, 20)).toBe('mp41');
    expect(out[14]).toBe(2); expect(tag(b, 8)).toBe('isom');
  });
  it('ftyp 가 아니면 그대로', () => expect([...patchM4aBrand(new Uint8Array([1, 2, 3]))]).toEqual([1, 2, 3]));
});

describe('M4A 만들기(가짜 인코더로 MP4 포장 확인)', () => {
  class FakeAudioData {
    constructor(o) { Object.assign(this, o); }
    close() { this.closed = true; }
  }
  class FakeAudioEncoder {
    constructor({ output, error }) { this.output = output; this.error = error; this.frames = 0; }
    configure(c) { this.config = c; }
    encode(d) {
      expect(d.format).toBe('f32-planar');
      expect(d.data.length).toBe(d.numberOfFrames * d.numberOfChannels);
      // AAC 한 프레임 = 1024 샘플이라고 치고 가짜 조각을 낸다
      this.frames += d.numberOfFrames;
      while (this.frames >= 1024) {
        this.frames -= 1024;
        const bytes = new Uint8Array(10).fill(7);
        const ts = (this.count = (this.count || 0) + 1) - 1;
        this.output({ type: 'key', byteLength: 10, timestamp: Math.round(ts * 1024 / this.config.sampleRate * 1e6), duration: Math.round(1024 / this.config.sampleRate * 1e6), copyTo: (dst) => dst.set(bytes) }, {});
      }
    }
    async flush() {}
    close() {}
  }
  it('ftyp·moov·mdat 이 있는 파일', async () => {
    const fs = 44100, ch = new Float32Array(fs * 2);
    const out = await encodeM4a([ch, ch], fs, { AudioEncoder: FakeAudioEncoder, AudioData: FakeAudioData }, aacConfigs(fs, 2)[0]);
    expect(tag(out, 4)).toBe('ftyp'); expect(tag(out, 8)).toBe('M4A ');
    const text = String.fromCharCode(...out.slice(0, Math.min(out.length, 4000)));
    expect(text).toContain('moov'); expect(text).toContain('mdat'); expect(text).toContain('mp4a'); expect(text).toContain('esds');
  });
  it('인코더 오류를 전달한다', async () => {
    class Bad extends FakeAudioEncoder { encode() { this.error(new Error('지원 안 함')); } }
    await expect(encodeM4a([new Float32Array(5000)], 48000, { AudioEncoder: Bad, AudioData: FakeAudioData }, aacConfigs(48000, 1)[1])).rejects.toThrow('지원 안 함');
  });
});
