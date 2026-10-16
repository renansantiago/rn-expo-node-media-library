# ADR 0002: Authentication and entitlements

- **Status:** accepted
- **Context:** Write operations must require authentication; "a simple token is acceptable". The API must also enforce who can watch what. Secrets must not live in the code.

## Decision

- **Opaque bearer tokens, stored hashed.** `POST /v1/auth/login` returns a random 256-bit token (base64url) and its expiry. The server stores `sha256(token)` with `user_id` and `expires_at`, so a database leak does not expose usable tokens. Tokens are revocable (`/logout` deletes the row) and expired rows are purged on login.
  - JWTs were rejected: they cannot be revoked without a denylist, and they add key management for no benefit at this scale.
  - Refresh tokens are out of scope; re-login after expiry (7 days by default) is acceptable here.
- **Passwords:** salted scrypt (`N=16384, r=8, p=1`) with a constant-time comparison. Unknown usernames still go through a hash comparison and get the same generic 401, which avoids user enumeration through messages or timing.
- **Demo credentials** come from `DEMO_USER_PASSWORD`. When it is unset, the seed generates and prints a random password. Nothing sensitive is committed.
- **Entitlements:** each item has a `required_tier` and each user a `tier` (`free` < `premium`).
  - The rule lives in `packages/contracts` (`canWatch`), so the API enforces it and the app can tailor its UI with the same code.
  - The stream URL is never part of catalog responses. It is only returned by the authenticated `/v1/items/:id/playback`, with `Cache-Control: no-store`.
- **Client session:**
  - The session (token, expiry, user) is persisted with `expo-secure-store` (Keychain/Keystore, `AFTER_FIRST_UNLOCK`) and held in an in-memory store the API client reads synchronously.
  - A 401 on a request that carried the current token clears the session, and user-scoped query caches are removed on sign-out.
  - Profile refresh failures caused by connectivity keep the cached session usable offline.

## Consequences

- In production, stream URLs should be short-lived signed CDN URLs, so a leaked URL expires on its own. Today the playback endpoint returns a static URL.
- Brute-force protection is a rate limit on login per (client IP, username), with `Retry-After`. It slows guessing against one account without locking out everyone behind a shared IP. Counters are in memory; several API instances would share a Redis store, and an edge limit (gateway / WAF) would handle volumetric abuse.
