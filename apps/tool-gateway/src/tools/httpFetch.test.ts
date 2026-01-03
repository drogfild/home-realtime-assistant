import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHttpFetchTool } from './httpFetch';

const mockClient = {
  get: vi.fn(),
};

const tool = createHttpFetchTool(['example.com'], mockClient);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('http_fetch tool', () => {
  it('rejects non-allowlisted host', async () => {
    await expect(tool.handler({ host: 'not-allowed.com', path: '/' })).rejects.toThrow('host_not_allowed');
  });

  it('returns data for allowlisted host', async () => {
    mockClient.get.mockResolvedValue({ status: 200, data: { ok: true } });
    const result = await tool.handler({ host: 'example.com', path: '/' });
    expect(result).toEqual({ status: 200, data: { ok: true } });
    expect(mockClient.get).toHaveBeenCalledWith('https://example.com/', { timeout: 3_000 });
  });
});
