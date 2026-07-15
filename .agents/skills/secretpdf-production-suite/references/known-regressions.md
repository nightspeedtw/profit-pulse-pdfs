# Known SecretPDF Regression Classes

Use this list to recognize recurring defect classes quickly.

## Blank or title-only cover

Symptoms:

- title visible on empty background
- no canonical protagonist
- cover generator failed but PDF continued

Class: `asset_validation_bug` or `cover_gate_bug`.

## Duplicate page blocks

Symptoms:

- groups of pages repeat after retry
- page count exceeds product metadata
- same image and text hashes appear twice

Class: `idempotency_bug` or `chunk_merge_bug`.

## Character and style drift

Symptoms:

- face, proportions, clothes, props, or species change
- cover is hand-drawn while interior is 3D or painterly

Class: reference propagation or visual contract failure.

## Random AI text and watermark

Symptoms:

- gibberish inside illustrations
- artist signature, domain, label, or malformed speech bubble

Class: image-generation contract and artifact-gate failure.

## QC gate `n/a` after repair

Symptoms:

- producer reports success
- database has data in one field
- gate reads another field
- automatic repair repeats

Class: `persistence_contract_bug` or `gate_mapping_mismatch`.

## Valid PDF receives score zero

Symptoms:

- manually downloaded PDF opens
- QC reads stale URL, expired token, HTML error page, or old asset version

Class: `asset_identity_bug`. Technical failure must have score `null`.

## Internal copy on public sales page

Symptoms:

- Story rule, callbacks, buyer hook, HTML comments, or debug metadata are visible

Class: `public_copy_leak`.

## Phase 1 blocked by later phases

Symptoms:

- final PDF exists but run waits for Shopify, SEO, pricing, or publish

Class: feature-flag or state-machine scope bug.
