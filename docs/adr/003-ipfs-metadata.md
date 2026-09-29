# ADR-003: IPFS Metadata

## Status

Accepted. Amended for upload-first authoring (#308–#312). The earlier MVP
decision to accept a manually pasted IPFS URI is superseded.

## Context

SEP-0050 defines `token_uri` returning a URL to JSON metadata. Stolla NFTs and
communities need off-chain metadata for names, descriptions, images, and
links. Asking creators and members to host JSON elsewhere and paste its URI
was error-prone and blocked non-technical users.

## Decision

- Metadata follows the [SEP-0050 Non-Fungible Metadata JSON Schema](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0050.md).
- **Stolla pins metadata for the user.** The app exposes a server-only route,
  `POST /api/ipfs/pin`, that uploads files to Pinata using `PINATA_JWT`. Users
  upload images and fill form fields in-app; they never author or paste URIs
  in the primary path.
- **Community creation:** the wizard builds the community metadata document
  (see [community-metadata-governance-schema.md](../community-metadata-governance-schema.md))
  and a minimal NFT collection document, pins the optional logo, then both
  documents, and passes the generated `collection_uri`, `metadata_uri`, and
  `metadata_hash` (SHA-256 of the exact pinned bytes) to CommunityFactory.
- **Minting:** the mint form collects a display name, description, and optional
  image, pins them, and passes the generated `ipfs://` URI as `token_uri`.
- JSON documents are pinned as files, not through a provider JSON endpoint,
  so the bytes that are hashed are the bytes that are stored.
- On-chain storage is unchanged: contracts still store `ipfs://` URIs. Only how
  humans produce them has changed.
- The frontend resolves `ipfs://` URIs through `NEXT_PUBLIC_IPFS_GATEWAY_URL`.

## Token metadata shape

Pinned token JSON uses exactly these keys. Absent optionals are omitted, never
`null`. `image` is omitted when no image is uploaded. `attributes` is always
present and empty until an attribute editor exists.

```json
{
  "name": "Stolla Member #1",
  "description": "Community membership NFT",
  "image": "ipfs://bafy...",
  "attributes": []
}
```

## Configuration and failure modes

- `PINATA_JWT` is a server-only secret. Never expose it with a `NEXT_PUBLIC_`
  prefix. When it is missing, the pin route returns a configuration error and
  the UI keeps Simulate, Deploy, and Mint disabled; no transaction is built.
- Images must be PNG, JPEG, WebP, GIF, or SVG and at most 5 MB; metadata
  documents at most 256 KB. Oversized or disallowed files are rejected in the
  browser and again on the server, before any upload.
- Network or provider failures are retryable. Drafts are never cleared.
- #258 (deterministic preview and download) complements this: it lets users
  inspect or save the exact bytes that are committed.

## Consequences

- Creators and members are **not** responsible for pinning before create or
  mint in the primary path. Stolla pins, and the pinning account pays for
  storage.
- The on-chain `metadata_hash` always matches the pinned community document,
  because the same bytes are hashed and uploaded.
- Contract exposes `custom_token_uri(token_id)` for stored per-token URIs.
- Standard `token_uri` from OZ Base remains available as a fallback through the
  collection base URI.
- Operating Stolla requires a Pinata account and `PINATA_JWT` on the server.
