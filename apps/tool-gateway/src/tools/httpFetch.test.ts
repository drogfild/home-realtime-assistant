import { describe, expect, it } from 'vitest';
import nock from 'nock';
import { createHttpFetchTool } from './httpFetch';

const tool = createHttpFetchTool(['example.com']);

describe('http_fetch tool', () => {
  it('rejects non-allowlisted host', async () => {
    await expect(tool.handler({ host: 'not-allowed.com', path: '/' })).rejects.toThrow('host_not_allowed');
  });

  it('returns data for allowlisted host', async () => {
    const scope = nock('https://example.com').get('/').reply(200, { ok: true });
    const result = await tool.handler({ host: 'example.com', path: '/' });
    expect(result).toEqual({ status: 200, data: { ok: true } });
    scope.done();
  });
});
