import { RedactionRule } from './security';

const DEFAULT_RULES: RedactionRule[] = [
  { pattern: /(sk-[a-zA-Z0-9]{32,})/g, replacement: '[REDACTED_API_KEY]' },
  { pattern: /(pk-[a-zA-Z0-9]{24,})/g, replacement: '[REDACTED_PUBLISHABLE_KEY]' },
  { pattern: /([A-Za-z0-9_-]{20,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,})/g, replacement: '[REDACTED_JWT]' },
];

export function redact(text: string, extraRules: RedactionRule[] = []): string {
  const rules = [...DEFAULT_RULES, ...extraRules];
  return rules.reduce((acc, rule) => acc.replace(rule.pattern, rule.replacement), text);
}

export function redactObject<T>(input: T, extraRules: RedactionRule[] = []): T {
  try {
    const json = JSON.stringify(input);
    const redacted = redact(json, extraRules);
    return JSON.parse(redacted);
  } catch (error) {
    // If redaction fails, return a safe placeholder
    return { error: 'redaction_failed' } as unknown as T;
  }
}
