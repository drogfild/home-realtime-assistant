import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

type EnvQuestion = {
  key: string;
  prompt: string;
  minLength?: number;
  allowRandom?: boolean;
  defaultValue?: string;
};

function needsInput(question: EnvQuestion) {
  const value = process.env[question.key];
  if (!value) return true;
  if (question.minLength && value.length < question.minLength) return true;
  return false;
}

export async function ensureEnvVars(questions: EnvQuestion[]) {
  for (const question of questions) {
    const value = process.env[question.key];
    if ((!value || value.length === 0) && question.defaultValue) {
      process.env[question.key] = question.defaultValue;
    }
  }

  const missing = questions.filter(needsInput);
  if (missing.length === 0) return;

  if (!input.isTTY || !output.isTTY) {
    const names = missing.map((q) => q.key).join(', ');
    throw new Error(
      `Missing required environment variables: ${names}. Provide them via a .env file or environment variables before starting the service.`,
    );
  }

  const rl = readline.createInterface({ input, output });
  try {
    for (const question of missing) {
      let value: string | undefined;
      const suffixParts = [];
      if (question.allowRandom) {
        suffixParts.push('leave empty to auto-generate a random secret');
      }
      if (question.defaultValue) {
        suffixParts.push(`default: ${question.defaultValue}`);
      }
      const suffix = suffixParts.length ? ` (${suffixParts.join(', ')})` : '';

      while (!value || (question.minLength && value.length < question.minLength)) {
        const answer = (await rl.question(`${question.prompt}${suffix}: `)).trim();
        if (!answer && question.allowRandom) {
          value = crypto.randomBytes(Math.max(16, question.minLength ?? 16)).toString('hex');
        } else if (!answer && question.defaultValue) {
          value = question.defaultValue;
        } else {
          value = answer;
        }

        if (!value || (question.minLength && value.length < question.minLength)) {
          rl.write(`Value for ${question.key} must be at least ${question.minLength ?? 1} characters.\n`);
          value = undefined;
        }
      }

      process.env[question.key] = value;
    }
  } finally {
    rl.close();
  }
}
