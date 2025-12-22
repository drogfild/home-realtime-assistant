# TODO

## Security
- [ ] Review `/api/tools/dispatch` authentication: now relies on `x-shared-secret` for browser tool calls; consider tightening (e.g., per-session token or scoped auth) and document threat model.

- Simplify shared secret/passcode setup so users enter it once; avoid duplicating across multiple `.env` files.
- Review and update deprecated dependencies when ready.
- Make the input transcription model configurable via env (not hardcoded).
