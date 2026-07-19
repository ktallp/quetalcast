import { describe, it, expect, beforeEach } from 'vitest';
import {
  INTEGRATIONS,
  DEFAULT_STREAM_QUALITY,
  getIntegration,
  loadIntegrationConfig,
  saveIntegrationConfig,
  clearIntegrationConfig,
  type IntegrationConfig,
} from '@/lib/integrations';

const STORAGE_PREFIX = 'quetalcast-integration-';

function makeConfig(overrides: Partial<IntegrationConfig> = {}): IntegrationConfig {
  return {
    integrationId: 'shoutcast',
    credentials: { host: 'host.example.com', port: '8001', password: 'secret' },
    rememberCredentials: true,
    ...overrides,
  };
}

describe('integrations registry', () => {
  it('registers the expected platforms', () => {
    expect(INTEGRATIONS.map((i) => i.id)).toEqual(['internet-radio', 'shoutcast', 'radio-co']);
  });

  it('getIntegration returns the matching integration by id', () => {
    const ir = getIntegration('internet-radio');
    expect(ir).toBeDefined();
    expect(ir!.name).toBe('internet-radio.com');
    expect(ir!.type).toBe('icecast');

    const sc = getIntegration('shoutcast');
    expect(sc!.type).toBe('shoutcast');

    const rc = getIntegration('radio-co');
    expect(rc!.type).toBe('radio-co');
  });

  it('getIntegration returns undefined for an unknown id', () => {
    expect(getIntegration('nope')).toBeUndefined();
    expect(getIntegration('')).toBeUndefined();
  });

  it('every integration declares required host, port, and password fields', () => {
    for (const integration of INTEGRATIONS) {
      const byKey = Object.fromEntries(integration.credentialFields.map((f) => [f.key, f]));
      expect(byKey.host?.required).toBe(true);
      expect(byKey.port?.required).toBe(true);
      expect(byKey.password?.required).toBe(true);
      expect(byKey.password?.type).toBe('password');
    }
  });

  it('default stream quality is 192 kbps stereo', () => {
    expect(DEFAULT_STREAM_QUALITY).toEqual({ bitrate: 192, channels: 2 });
  });
});

describe('integration config persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('save + load round-trips when rememberCredentials is true', () => {
    const config = makeConfig({ streamQuality: { bitrate: 320, channels: 1 } });
    saveIntegrationConfig(config);

    const loaded = loadIntegrationConfig('shoutcast');
    expect(loaded).toEqual(config);
    expect(localStorage.getItem(`${STORAGE_PREFIX}shoutcast`)).toBeTruthy();
  });

  it('save with rememberCredentials false removes any persisted config', () => {
    saveIntegrationConfig(makeConfig());
    expect(loadIntegrationConfig('shoutcast')).not.toBeNull();

    saveIntegrationConfig(makeConfig({ rememberCredentials: false }));
    expect(loadIntegrationConfig('shoutcast')).toBeNull();
    expect(localStorage.getItem(`${STORAGE_PREFIX}shoutcast`)).toBeNull();
  });

  it('load returns null when nothing is stored', () => {
    expect(loadIntegrationConfig('internet-radio')).toBeNull();
  });

  it('load returns null for corrupt stored JSON', () => {
    localStorage.setItem(`${STORAGE_PREFIX}radio-co`, '{broken');
    expect(loadIntegrationConfig('radio-co')).toBeNull();
  });

  it('clearIntegrationConfig removes only the targeted integration', () => {
    saveIntegrationConfig(makeConfig());
    saveIntegrationConfig(makeConfig({ integrationId: 'radio-co' }));

    clearIntegrationConfig('shoutcast');
    expect(loadIntegrationConfig('shoutcast')).toBeNull();
    expect(loadIntegrationConfig('radio-co')).not.toBeNull();
  });
});
