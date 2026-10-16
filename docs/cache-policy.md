# Cache policy

What the app keeps, where, for how long, and what happens when it is offline. The guiding rules:

1. **Public catalog data may be cached; anything user-scoped is either never cached or kept only in the user's own on-device records.**
2. **User actions are never lost.** Progress is written to disk before anything else and only forgotten once the server has resolved it.
3. **Stale is better than nothing offline, but never pretends to be fresh online.** Cached data renders immediately and is revalidated in the background when the network is there.

## What is cached

| Data                           | Where                                      | Fresh for (`staleTime`) | Kept for                            | Notes                                                                                                                                     |
| ------------------------------ | ------------------------------------------ | ----------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog lists (`/v1/items`)    | Memory + AsyncStorage (TanStack persister) | 5 min                   | 7 days (`maxAge`)                   | Only the first 3 pages of each list (per category) are written to disk. Deeper pages reload when online.                                  |
| Categories (`/v1/categories`)  | Memory + AsyncStorage                      | 1 h                     | 7 days                              |                                                                                                                                           |
| Item details (`/v1/items/:id`) | Memory + AsyncStorage                      | 5 min                   | 7 days                              | Also rendered instantly from any cached catalog list (placeholder), so items seen in the list open offline.                               |
| Thumbnails                     | expo-image disk cache                      | –                       | Managed by expo-image (LRU)         | `cachePolicy="disk"`.                                                                                                                     |
| Stream URLs (`/playback`)      | Memory only                                | 0                       | 0 (`gcTime: 0`)                     | Per user, sent with `Cache-Control: no-store`, never persisted, cleared on sign-out. In production they would be short-lived signed URLs. |
| Session (token, user)          | Keychain / Keystore (expo-secure-store)    | –                       | Until expiry or sign-out            | See ADR 0002.                                                                                                                             |
| Playback progress              | On-device SQLite (`progress` table)        | Re-read on every change | Kept on the device                  | Per user. Server state is merged in under the multi-device rule (ADR 0003).                                                               |
| Sync outbox                    | On-device SQLite (`outbox` table)          | –                       | Until the server resolves the event | One pending event per (user, item). Never dropped because of a transport failure.                                                         |

## How the persisted cache is controlled

- **Allow-list, not deny-list.** Only queries whose key starts with `catalog` and that succeeded are written to disk (`shouldPersistQuery`). Everything user-scoped lives under `['user', userId, …]` keys and can never be persisted by accident.
- **Versioned.** The cache carries a buster made of a cache schema version and the app version. After an update, or when the cached data shape changes (bump `CACHE_SCHEMA_VERSION`), the old cache is discarded on launch instead of being fed to new code.
- **Bounded.** Infinite lists are trimmed to their first pages before writing, and writes are throttled (1 s).
- **Corruption-safe.** An unreadable cache (truncated write, disk issue) is logged and discarded; the app starts from the network.
- **Garbage collection.** Inactive queries are kept in memory for 7 days (`gcTime`), so a list that is not on screen is not dropped from disk before it expires. User-scoped queries override this with short lifetimes.

## Offline behaviour

Connectivity comes from NetInfo and drives TanStack Query's online manager. A device that reports a connection but no internet reachability (captive portal) counts as offline; an undetermined state at launch counts as online, so the app never flashes a false "offline".

| Situation                                   | Behaviour                                                                                                                                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anywhere, offline                           | A banner says the app is offline and showing saved content. Requests pause instead of failing, and resume by themselves when connectivity returns.                                                       |
| Catalog, cached                             | Renders the saved lists. The list footer says more videos need a connection.                                                                                                                             |
| Catalog list never loaded (e.g. a category) | Shows the matching videos already saved by other lists (e.g. Animation items from "All") with a notice. With nothing saved at all: "You're offline"; it loads by itself on reconnect.                    |
| Item detail                                 | Renders from the item cache or any cached list, including the last position from local progress. If refreshing fails (offline or server down), the saved details stay on screen with a notice and Retry. |
| Player                                      | Explains that playback needs a connection (a playback grant comes from the server). Starts by itself when connectivity returns.                                                                          |
| Progress saved offline                      | Written to SQLite and queued. Delivered as soon as the network returns, skipping any retry backoff in progress; also on launch and on return to foreground.                                              |

## Revalidation

When online, cached data older than its `staleTime` is refetched in the background on mount; a pull-to-refresh refetches the catalog explicitly. Progress is pulled from the server on launch, on return to foreground, on reconnect, when an item's detail screen opens, and (with a 3 s cap) before playback starts.
