import { describe, it, expect } from 'vitest';
import { windowedLossRate, LOSS_WINDOW_MS } from '@/lib/webrtc-stats';
import { extractOpusFmtp, mungeOpusSdpParams, stepListenerTier } from '@/hooks/useWebRTC';

describe('windowedLossRate', () => {
  it('reports loss over the window as a percentage, not the cumulative count', () => {
    const samples = [
      { timestamp: 0, lost: 600, total: 60000 },
      { timestamp: 5000, lost: 605, total: 60250 },
      { timestamp: 10000, lost: 610, total: 60500 },
    ];
    // 10 lost of 500 sent in the window = 2%
    expect(windowedLossRate(samples, 10000)).toBeCloseTo(2, 5);
  });

  it('drops samples older than the window so old loss stops counting', () => {
    const samples = [
      { timestamp: 0, lost: 0, total: 0 },
      { timestamp: 1000, lost: 100, total: 500 },
      { timestamp: 20000, lost: 100, total: 10000 },
      { timestamp: 21000, lost: 100, total: 10050 },
    ];
    expect(windowedLossRate(samples, 21000)).toBe(0);
    expect(samples.length).toBe(2);
    expect(samples[0].timestamp).toBe(20000);
  });

  it('is zero with fewer than two samples or no packets', () => {
    expect(windowedLossRate([], 0)).toBe(0);
    expect(windowedLossRate([{ timestamp: 0, lost: 1, total: 1 }], 0)).toBe(0);
    expect(windowedLossRate([{ timestamp: 0, lost: 1, total: 1 }, { timestamp: 1000, lost: 1, total: 1 }], 1000)).toBe(0);
    expect(LOSS_WINDOW_MS).toBeGreaterThan(0);
  });
});

describe('Opus fmtp echo', () => {
  const offer = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;maxaveragebitrate=510000;cbr=1',
    'a=rtpmap:63 red/48000/2',
    'a=fmtp:63 111/111',
  ].join('\r\n');

  it('reads the Opus parameters out of an offer', () => {
    expect(extractOpusFmtp(offer)).toEqual({
      minptime: '10', useinbandfec: '1', stereo: '1', maxaveragebitrate: '510000', cbr: '1',
    });
  });

  it('merges parameters into an existing fmtp line without touching RED', () => {
    const answer = [
      'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
      'a=rtpmap:111 opus/48000/2',
      'a=fmtp:111 minptime=10;useinbandfec=1',
      'a=rtpmap:63 red/48000/2',
      'a=fmtp:63 111/111',
    ].join('\r\n');
    const out = mungeOpusSdpParams(answer, { stereo: '1', maxaveragebitrate: '510000' });
    expect(out).toContain('a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;maxaveragebitrate=510000');
    expect(out).toContain('a=fmtp:63 111/111');
  });

  it('adds an fmtp line when the answer has none', () => {
    const answer = ['m=audio 9 UDP/TLS/RTP/SAVPF 111', 'a=rtpmap:111 opus/48000/2', 'a=ptime:20'].join('\r\n');
    const out = mungeOpusSdpParams(answer, { stereo: 1 });
    expect(out.split('\r\n')).toEqual([
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=rtpmap:111 opus/48000/2',
      'a=fmtp:111 stereo=1',
      'a=ptime:20',
    ]);
  });

  it('leaves SDP without Opus alone', () => {
    const sdp = 'm=audio 9 UDP/TLS/RTP/SAVPF 0\r\na=rtpmap:0 PCMU/8000';
    expect(mungeOpusSdpParams(sdp, { stereo: 1 })).toBe(sdp);
    expect(extractOpusFmtp(sdp)).toEqual({});
  });
});

describe('stepListenerTier', () => {
  const clean = { lossRate: 0, jitter: 5, rtt: 40 };
  const lossy = { lossRate: 6, jitter: 10, rtt: 60 };
  const fresh = () => ({ tier: 0, goodSeconds: 0, requiredGood: 15, lastChangeAt: 0, lastUpAt: 0 });

  it('steps down one tier on loss and then waits out the cooldown', () => {
    let s = stepListenerTier(fresh(), lossy, 20_000);
    expect(s.tier).toBe(1);
    // Still lossy one second later: cooldown holds the tier
    s = stepListenerTier(s, lossy, 21_000);
    expect(s.tier).toBe(1);
    // After the cooldown it can step again (RED is on now, so it takes heavier loss)
    s = stepListenerTier(s, { lossRate: 12, jitter: 10, rtt: 60 }, 31_000);
    expect(s.tier).toBe(2);
  });

  it('tolerates more raw loss once redundancy is on', () => {
    const onRed = { ...fresh(), tier: 1, lastChangeAt: 0 };
    // 5% would have downgraded plain Opus; with RED it is recovered audio
    const s = stepListenerTier(onRed, { lossRate: 5, jitter: 10, rtt: 60 }, 60_000);
    expect(s.tier).toBe(1);
    const s2 = stepListenerTier(onRed, { lossRate: 9, jitter: 10, rtt: 60 }, 60_000);
    expect(s2.tier).toBe(2);
  });

  it('needs a run of clean seconds before stepping back up, and never above high', () => {
    let s = { ...fresh(), tier: 2, lastChangeAt: 0 };
    for (let i = 0; i < 14; i++) s = stepListenerTier(s, clean, 100_000 + i * 1000);
    expect(s.tier).toBe(2);
    s = stepListenerTier(s, clean, 115_000);
    expect(s.tier).toBe(1);
    expect(s.goodSeconds).toBe(0);
    for (let i = 0; i < 40; i++) s = stepListenerTier(s, clean, 200_000 + i * 1000);
    expect(s.tier).toBe(0);
    for (let i = 0; i < 40; i++) s = stepListenerTier(s, clean, 300_000 + i * 1000);
    expect(s.tier).toBe(0);
  });

  it('resets the clean streak on a mediocre reading', () => {
    let s = { ...fresh(), tier: 1, lastChangeAt: 0, goodSeconds: 10 };
    s = stepListenerTier(s, { lossRate: 1, jitter: 10, rtt: 60 }, 50_000);
    expect(s.tier).toBe(1);
    expect(s.goodSeconds).toBe(0);
  });

  it('demands a longer clean run after an upgrade that did not hold', () => {
    let s = { ...fresh(), tier: 1, lastChangeAt: 0, goodSeconds: 15 };
    s = stepListenerTier(s, clean, 100_000);
    expect(s.tier).toBe(0);
    s = stepListenerTier(s, lossy, 120_000);
    expect(s.tier).toBe(1);
    expect(s.requiredGood).toBe(30);
  });
});
