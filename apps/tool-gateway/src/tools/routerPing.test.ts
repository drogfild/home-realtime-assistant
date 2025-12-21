import { describe, expect, it } from 'vitest';
import { createRouterPingTool } from './routerPing';

describe('router_reachable tool', () => {
  it('returns reachable with parsed latency on success', async () => {
    const tool = createRouterPingTool(async () => ({
      code: 0,
      stdout: '64 bytes from 192.168.1.1: icmp_seq=0 ttl=64 time=2.34 ms',
      stderr: '',
    }));

    const result = await tool.handler({});
    expect(result).toEqual({ host: '192.168.1.1', reachable: true, latency_ms: 2.34 });
  });

  it('returns unreachable when ping fails', async () => {
    const tool = createRouterPingTool(async () => ({
      code: 1,
      stdout: '',
      stderr: 'Request timeout',
    }));

    const result = await tool.handler({});
    expect(result).toEqual({ host: '192.168.1.1', reachable: false, latency_ms: null });
  });
});
