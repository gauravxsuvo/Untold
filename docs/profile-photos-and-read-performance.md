# Profile photos and read performance

## Profile photos

The Profile page supports choosing, cropping, replacing, and removing a photo. The browser accepts
JPG, PNG, and WebP sources up to 8 MiB, checks file signatures and dimensions, and crops to a 512 px
square before upload. The native decoder never receives an unbounded source. The upload is at
most 1 MiB; the original is never uploaded.

The server checks signatures again, rejects animated and oversized images, and always re-encodes
to a static 256 px WebP. Stored output is at most 64 KiB and contains no source EXIF/GPS metadata.
ICC input profiles are ignored. Processing has a five-second native deadline and a two-job limit
per server process. Mutations require authentication, a trusted origin, bounded streaming reads,
and an account rate limit.

One compressed photo per account is stored in a separate table. Replacements and removals are
atomic and cannot leave a growing collection of old images. This modest, bounded storage avoids
introducing another infrastructure dependency. At much larger account counts, moving the same
canonical WebP bytes to private object storage can reduce database backup size.

Only the owner and signed-in users who share a conversation with them can retrieve a photo.
Permission checks run before conditional responses. Photos use private browser caching with
mandatory revalidation and ETags; they are never public/CDN-cacheable. Avatar components accept
only the app’s own profile photo URLs, so arbitrary external image URLs cannot track contacts.

Migration `010-profile-photos.sql` is required. The existing `npm start` migration runner picks
it up before serving requests. No production migration or deployment was performed here.

## Chat reads

The message endpoint checks authentication and membership on every request. It first reads the
latest 100 message metadata rows and outgoing receipt statuses, without fetching the encrypted
bodies. An account-scoped ETag includes message metadata and receipts. Unchanged snapshots return
304 without transferring message bodies or repeating decryption.

For changed snapshots, the client supplies up to 100 known message IDs. Only unknown encrypted
bodies are loaded and sent; current metadata and receipts still cover the entire snapshot.
This avoids timestamp cursors that could miss a transaction committed late. Existing clients
that do not supply known IDs still receive complete encrypted messages.

The active chat retains at most 100 opened messages in hook-local memory. There is no plaintext
message cache in local storage, Redis, service workers, or HTTP caches. Cache identity includes
the account, conversation, local device public keys, and every contact device’s keys and trust
status. A changed trust state forces a fresh load and decryption. Switching conversations,
signing out, and unmounting discard that memory. Rejected access responses clear the snapshot.
Refreshes are serialized, and notifications during a refresh schedule another refresh. Incoming
receipt processing continues to use the complete snapshot and visibility checks.

The inbox’s latest-message lookup now uses one indexed lateral lookup per conversation instead
of collecting and sorting entire conversation histories. The existing index on
`(conversation_id, created_at, id)` already supports this query; no duplicate index was added.

These changes reduce repeat work by construction. Production latency and database load were
not benchmarked, so no numerical speedup is claimed.

## Redis or Valkey

A shared cache can help when several application servers repeatedly load the same data. Its value
should be judged from query timings, hit rates, p95 latency, and database saturation. It also needs
bounded TTLs, invalidation after committed writes, outage fallbacks, and explicit privacy rules.
It must not become the authority for membership, revoked devices, or decrypted messages.

The current changes need no cache service. If production measurements justify Redis/Valkey later,
start with non-sensitive, expensive aggregates and keep authorization outside the cache.

References: [Redis cache-aside](https://redis.io/docs/latest/develop/use-cases/cache-aside/),
[PostgreSQL indexes and ordering](https://www.postgresql.org/docs/15/indexes-ordering.html),
[Sharp input limits](https://sharp.pixelplumbing.com/api-constructor/).

## Validation scope

Lint and the production Webpack build cover these source changes. Upload and message flows have
not been exercised against production accounts or the production database. The development server
was left stopped.
