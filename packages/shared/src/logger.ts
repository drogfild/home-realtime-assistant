import pino from 'pino';
import { redact } from './redaction';

export function createLogger(service: string) {
  return pino({
    name: service,
    level: process.env.LOG_LEVEL || 'info',
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    messageKey: 'message',
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    hooks: {
      logMethod(args, method) {
        const redactedArgs = args.map((arg) => (typeof arg === 'string' ? redact(arg) : arg)) as typeof args;
        // eslint-disable-next-line prefer-spread
        return method.apply(this, redactedArgs as Parameters<typeof method>);
      },
    },
  });
}
