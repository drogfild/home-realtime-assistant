import { describe, expect, it, vi } from 'vitest';
import { signHmac, verifyHmac } from './security';

const secret = 'super-secret-value-123456';

describe('HMAC signing and verification', () => {
  it('verifies valid signature within tolerance', () => {
    const ts = Date.now();
    const body = JSON.stringify({ hello: 'world' });
    const { signature, timestamp } = signHmac({ secret, body, timestamp: ts });
    const valid = verifyHmac({ secret, body, header: { signature, timestamp }, toleranceMs: 1000 });
    expect(valid).toBe(true);
  });

  it('rejects tampered signature', () => {
    const ts = Date.now();
    const body = 'payload';
    const { timestamp } = signHmac({ secret, body, timestamp: ts });
    const valid = verifyHmac({ secret, body, header: { signature: 'bad', timestamp }, toleranceMs: 1000 });
    expect(valid).toBe(false);
  });

  it('rejects old timestamp', () => {
    const body = 'payload';
    const past = Date.now() - 10_000;
    const { signature, timestamp } = signHmac({ secret, body, timestamp: past });
    const valid = verifyHmac({ secret, body, header: { signature, timestamp }, toleranceMs: 1000 });
    expect(valid).toBe(false);
  });
});

describe('signHmac', () => {
  it('produces deterministic signature for same timestamp', () => {
    const body = 'payload';
    const ts = 1700000000000;
    const first = signHmac({ secret, body, timestamp: ts });
    const second = signHmac({ secret, body, timestamp: ts });
    expect(first.signature).toBe(second.signature);
    expect(first.timestamp).toBe(String(ts));
  });
});
