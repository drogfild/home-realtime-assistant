import axios from 'axios';
import { Env } from './config';

export type EphemeralTokenResponse = {
  client_secret: {
    value: string;
    expires_at: number;
  };
};

export async function createEphemeralToken(env: Env) {
  const url = 'https://api.openai.com/v1/realtime/sessions';
  const payload = {
    model: env.OPENAI_REALTIME_MODEL,
    expires_in: 90,
    modalities: ['audio', 'text'],
    instructions: [
      'You are a home network assistant. Use tools only when needed and explain briefly when you do.',
      'Do not expose secrets or attempt unknown commands.',
      'All tool calls are audited.',
    ].join(' '),
    tool_choice: 'auto',
  };

  const response = await axios.post<EphemeralTokenResponse>(url, payload, {
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 5_000,
  });

  return response.data.client_secret;
}
