import { describe, expect, it, vi } from 'vitest';
import { buildTools } from './index';
import { Env } from '../config';

const baseEnv: Env = {
  TOOL_GATEWAY_PORT: 4001,
  INTERNAL_HMAC_SECRET: 'x'.repeat(20),
  HOME_ASSISTANT_URL: undefined,
  HOME_ASSISTANT_TOKEN: undefined,
  ALLOWLIST_HTTP_HOSTS: '',
  LOG_LEVEL: 'info',
};

describe('buildTools', () => {
  it('skips home assistant tool when credentials are missing', () => {
    const onSkipTool = vi.fn();
    const tools = buildTools(baseEnv, { onSkipTool });
    expect(tools.some((tool) => tool.name === 'home_assistant_sensor')).toBe(false);
    expect(onSkipTool).toHaveBeenCalledWith('home_assistant_sensor', 'HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN are required');
  });

  it('includes home assistant tool when configured', () => {
    const tools = buildTools({
      ...baseEnv,
      HOME_ASSISTANT_URL: 'https://ha.local',
      HOME_ASSISTANT_TOKEN: 'token',
    });
    expect(tools.some((tool) => tool.name === 'home_assistant_sensor')).toBe(true);
  });
});
