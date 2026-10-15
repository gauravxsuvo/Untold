# Group chats and desktop typing

## Included

- Create a group from the **New group** button in Conversations. Choose a name and add approved Untold account emails. Groups support up to eight people, including the creator.
- In **Details**, the group owner can rename the group, add or remove people, transfer ownership, and upload, crop, replace, or remove a group photo. Photos use the same bounded decoding, metadata removal, WebP compression, and storage limits as profile photos. Only the selected crop is uploaded.
- Any member can leave. If the owner leaves, ownership passes to the earliest remaining member. A group with no remaining members is inaccessible; retained encrypted history follows the existing storage policy.
- Groups appear in the inbox, search, and conversation list with their name and photo. Incoming group messages show the sender's name.
- Safety codes remain account-to-account. Compare each group member once in Details. Existing account verifications carry over to groups and approved devices.
- Group messages, attachments, and voice recordings use the existing browser encryption protocol, with a new content key per message and wraps for the current approved devices. The envelope limit supports 64 devices, covering eight accounts with eight devices each. Migration 017 adds group voice/video calls and screen sharing; see [group calls and media](group-calls-and-media.md).

## Membership and history

Migration `016-groups.sql` adds group names/owners, compressed group photos, inactive membership records, and immutable per-message recipient snapshots. It backfills recipients for existing direct messages. Apply it after migration 015 using the normal migration runner. Do not edit a migration already applied to a database.

Refresh Untold on all participants' devices after deployment so they use the updated group interface and recipient limits. Local production webpack build, TypeScript, standalone crypto compilation, lint, and diff checks passed during implementation.

Current membership is required for reading messages, obtaining download links, reading group/profile photos through a shared group, delivery acknowledgments, push targets, and new real-time subscriptions. Former members are excluded from future encryption recipients. Adding/removing members and sending messages serialize on the conversation row; the server rejects a stale recipient set instead of sending to the previous membership.

New members receive messages sent after joining. The server does not return earlier message metadata, bodies, or file download links to accounts that were not recipients. A person who leaves and later rejoins can access messages they were already authorized to receive during an earlier membership; they receive no messages from their absence. Copies already decrypted or downloaded cannot be removed from another device. Previously issued encrypted-file links can remain valid for up to their existing five-minute lifetime.

Receipts use each message's original recipient snapshot. Received/read means all original recipients have acknowledged that state. Adding a member does not reset old receipts. Removing a person who never read an earlier message can leave that message below Read; this preserves what actually happened.

The server stores group names, membership, ownership, and group photos as app metadata; these are not encrypted group message contents. Group membership is server-authorized metadata. The existing custom encryption protocol still lacks forward secrecy and independent review. A previously authorized real-time token can receive ID-only events until its short expiry, while message/file APIs immediately check current membership.

## Desktop typing

Opening a chat on a desktop with a mouse/trackpad focuses the composer. Later printable typing on the chat/background also focuses the composer and continues with the original browser key event. It does not synthesize text or key events.

The handler preserves other inputs, editable areas, links, buttons, menus, open dialogs, document text selection, Ctrl/Command/Alt shortcuts, and ongoing IME composition. Touch-only devices keep their normal keyboard behavior. Desktop selection remains available, and typing resumes at the end of the current draft when the composer is refocused.

## Checks before live rollout

Local TypeScript, lint, and production compilation are the implementation checks. No automated tests, development server, live migration, or real-account group flow is run without a request.

Before deployment, check group creation, photo cropping, owner changes, member removal while a send is in flight, leaving and rejoining, attempts by a nonmember to read an old message/file/photo, all-recipient receipts, account verification in a group, and desktop first-keystroke behavior on Chrome, Edge, and Safari. Include typing after switching chats, search fields, text selection, keyboard shortcuts, IME input, open dialogs, and touch devices.
