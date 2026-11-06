# ADR-0003: Sharing is an invite or a file, not a hosted viewer

- Status: accepted
- Date: 2026-11-06

## Context

The hosted canvas has `?share=<token>` links backed by a server-side projection room. Without a
Suite-operated server, that link has nowhere to resolve. A public web viewer would re-introduce the
hosting the project is removing.

## Decision

- **Collaboration** is an account-free invite to the user's `suite-sync` server: role, expiry, endpoint
  hint, fingerprint confirmation. The member needs the app.
- **Distribution** is a file: a self-contained `.canvas` (Loro snapshot + attachments) plus a SHA-256
  and an optional signature. The recipient opens it with the app or through a static landing page.
- **A static "Open in Suite" page** is allowed: one page, no server-side logic, no data. It shows the
  file name, size and a download/open action. It can be hosted on GitHub Pages/Cloudflare Pages.
- **No public live share in v1.** A read-only live session hosted by the user's server is a later
  option.
- **Keep `.canvas` for v1.** A `.suite` bundle for multi-file/attachment cases is decided later.
- The hosted `?share=<token>` link is removed, not redirected into a new hosted service.

## Consequences

- Two distinct flows to design and test: member invite vs snapshot distribution.
- Public reach is lower: a recipient who will not install the app cannot edit or view in a browser.
  Static publish is the later answer for public read-only.
- The file hash/signature is part of the share UI, not an afterthought.
- The 64 MB `.canvas` envelope limit becomes a real product limit; bundle/chunking is a later decision.
