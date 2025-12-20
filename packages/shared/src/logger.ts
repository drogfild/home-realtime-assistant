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
        if (args.length === 1 && typeof args[0] === 'string') {
          args[0] = redact(args[0]);
        } else if (args.length > 1 && typeof args[0] === 'string') {
          args[0] = redact(args[0]);
          args = args.map((arg) => (typeof arg === 'string' ? redact(arg) : arg));
        }
        // eslint-disable-next-line prefer-spread
        return method.apply(this, args as Parameters<typeof method>);
      },
    },
  });
}
