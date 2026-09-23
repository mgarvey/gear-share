# Contributing

Thanks for helping improve Gear Share. This public repository is canonical for
reusable application code, database behavior, tests, generic documentation,
and tooling. Changes must preserve its private-data and operator-safety boundaries.

## Development setup

Use Node.js 24.x and npm 11.x, then run:

```sh
npm ci
cp .env.example .env.local
npm run verify
```

Docker is required for the complete database and storage suite:

```sh
npm run db:start
npm run db:reset
npm run test:db
npm run db:stop
```

## Pull requests

- Keep each change focused and explain the user or operator outcome.
- Add or update tests for changed behavior.
- Run `npm run verify` with Node 24 before requesting review.
- Call out database migrations, authorization changes, new network calls,
  hosted configuration, and deployment implications explicitly.
- Treat deployment, hosted configuration, data repair, and feature activation
  as separate approvals. Merging a change authorizes none of them.
- Keep deployment-specific names, artwork, operations, and evidence in the
  deploying community's private downstream rather than this public repository.
- Evaluate Community Supplies updates individually. Propose a broadly reusable
  improvement upstream only as a focused pull request without private history,
  deployment configuration, community data, or unrelated Gear Share changes.

## Privacy and secrets

Never commit or post:

- Member names, contact information, photos, catalog records, or loan history
- Hosted Supabase URLs or keys, service-role credentials, provider credentials,
  deploy keys, access tokens, or signed URLs
- Production account numbers, SSH usernames, provider resource identifiers, or
  screenshots and logs containing those values

Use the loopback and `.invalid` examples already present in the repository.
Keep populated environment files local; `.env.local` and `.env.*` are ignored.

## Security-sensitive changes

Changes to authentication, membership, Row Level Security, storage policies,
Edge Functions, role assignment, loan transitions, or deployment safeguards
need focused tests and an explanation of the boundary being preserved. Report
suspected vulnerabilities through the process in [SECURITY.md](SECURITY.md),
not through a public issue.
