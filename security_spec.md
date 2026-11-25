# YABBAI Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Strict Ownership Isolation**: Every private document under `/users/{userId}/(profile|pools|transactions|alertRules|triggeredAlerts)` MUST belong to `request.auth.uid == userId` AND have `ownerId == request.auth.uid`. Non-owners can never `get`, `list`, `create`, `update`, or `delete`.
2. **Verified Email Mandate**: Every client write across all collections MUST require `request.auth != null && request.auth.token.email_verified == true`.
3. **Immutable Audit Ledger**: `/users/{userId}/transactions/{txId}` documents are append-only (`status == 'Confirmed'`, `createdAt == request.time`). Client updates and deletes are unconditionally denied (`allow update, delete: if false;`).
4. **Terminal State Lock on Burned LP**: Once `/users/{userId}/pools/{poolId}` reaches `lpBurned == true`, NO further updates or deletions are allowed (`existing().lpBurned == false`).
5. **Strict Key & Size Enforcement (Anti-Shadow-Field & Anti-DoW)**: Every `create` checks both `keys().hasAll(...)` and `keys().hasOnly(...)`; every `update` uses Action-Based `affectedKeys().hasOnly(...)` wrapped by `isValid[Entity](incoming())`; every string field enforces explicit `.size()` bounds; every path ID enforces `isValidId()` (`^[a-zA-Z0-9_\-]+$`, `<= 128`).
6. **Temporal Integrity**: All `createdAt` on create and `updatedAt` on update MUST equal `request.time`. `createdAt` and `ownerId`/`authorUid` are strictly immutable on update.
7. **Query Enforcer**: Every `allow list` rule explicitly checks `resource.data` (`resource.data.visibility == 'public'` for public feeds, `resource.data.ownerId == request.auth.uid` for user subcollections) with zero `get()`/`exists()` inside `allow list`.
8. **Cross-Collection Consistency**: Creating a `triggeredAlert` MUST verify `exists(/databases/$(database)/documents/users/$(userId)/alertRules/$(incoming().ruleId))`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Shadow Field Injection on Token Create**: Token payload includes extra ghost key `"isFeatured": true`. Must be rejected by `keys().hasOnly(...)`.
2. **Identity Spoofing on Token Create**: Authenticated as `uidA`, payload sets `"ownerId": "uidB"`. Must be rejected by `data.ownerId == request.auth.uid`.
3. **Unverified Email Write**: Authenticated token with `email_verified: false` tries to create an announcement. Must be rejected by `isVerifiedUser()`.
4. **Cross-User Wallet Read (PII / Balance Leak)**: Authenticated as `uidB`, attempts `get /users/uidA/profile/wallet`. Must be rejected by `isOwner(userId)`.
5. **Cross-User Transaction List Scraping**: Authenticated as `uidB`, attempts `list /users/uidA/transactions`. Must be rejected by `isOwner(userId) && resource.data.ownerId == request.auth.uid`.
6. **Transaction Ledger Tampering**: Owner attempts `update` on `/users/uidA/transactions/tx-1` to inflate `toAmount`. Must be rejected by `allow update: if false;`.
7. **Transaction Ledger Deletion**: Owner attempts `delete` on `/users/uidA/transactions/tx-1`. Must be rejected by `allow delete: if false;`.
8. **Burned LP Unburn / Withdrawal Attack**: Owner attempts `update` or `delete` on a pool where `existing().lpBurned == true`. Must be rejected by terminal state lock.
9. **Client Timestamp Forgery**: Payload submits a backdated timestamp instead of `request.time` for `createdAt`. Must be rejected by `incoming().createdAt == request.time`.
10. **Path ID Poisoning (DoW)**: Client tries to create `/tokens/<200-char-junk-id!@#$>`. Must be rejected by `isValidId(tokenId)`.
11. **Announcement Upvote Inflation**: User updates announcement `upvotes` from `1` to `9999` or modifies `title` during an upvote action. Must be rejected by `incoming().upvotes == existing().upvotes + 1` and `affectedKeys().hasOnly(['upvotes', 'updatedAt'])`.
12. **Orphaned Triggered Alert**: Owner attempts to create a `triggeredAlert` referencing a non-existent `ruleId`. Must be rejected by `exists(.../alertRules/$(incoming().ruleId))`.
