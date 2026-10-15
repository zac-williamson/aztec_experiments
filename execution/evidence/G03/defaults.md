# Proposed working defaults and reversal paths

Home ranks only operator-featured subboards plus the main board by integer score: 3*likes+2*replies+reposts, then publication order descending then post ID. Following sorts publication order descending. New subboards are directory/search-only until explicit moderator feature event. Ranking version and inputs are reproducible; change algorithm by versioned derived service, no chain history rewrite.

Slugs are lowercase ASCII a-z0-9 and internal hyphens,3–40bytes, unique within curated board. Display names remain readable. Local rules are immutable at launch; parent policy changes propagate. Parent moderator can reject with reason; rejection is permanent in first release. No local moderator delegation or appeal UI authority. These are conservative proposed defaults, not permissions granted to creators; future versioned policy can add explicit appeal/reversal without erasing history.

Full human names initially accept circuit-constrained ASCII letters, spaces, apostrophe and hyphen; each first/last component1–32bytes after trim/collapse, starts/ends with a letter, case-insensitive canonical comparison. Canonical first name bok is reserved. Unicode is rejected explicitly, never silently transliterated. This supersedes the earlier unverified Unicode proposal because JS NFC/casefold alone cannot establish circuit-enforced consensus uniqueness. See shared/rolling/PRIVACY_DESIGN.md for reversal path and adversarial acceptance.

One active like per private underlying account per post across names, unlike supported. Derive domain-separated per-post tag from account-owned private secret with no public account list. Cryptographic design and public effects need independent review; no assurance from the design alone.

Preferences are encrypted onchain records recovered with user keys; reads use public range batches and local filtering. In-app reply notifications and local read markers first. First Bok request grants no formal ownership; ordinary product copy does not explain implied thread rules. Public Bok identity is authenticated and visible; human invocation ownership stays private.

Each default is recorded as proposed. Product implementation may replace a default with a better reversible choice consistent with the specification; owner-reserved funding infeasibility decisions are not delegated defaults.
