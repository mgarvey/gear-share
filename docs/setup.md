# Gear Share setup

This guide establishes a local, community-neutral development environment. It
does not create hosted resources, configure providers, bootstrap a production
administrator, or authorize deployment.

## Requirements

- Node.js 24.x and npm 11.x
- Docker or a compatible local container runtime for Supabase
- The Supabase CLI version pinned by `package-lock.json`

## Install and verify

```sh
npm ci
cp .env.example .env.local
npm run verify
```

Before publishing or reviewing a release candidate, verify the public projection
from an isolated local clone with a frozen dependency install:

```bash
npm run verify:fresh-clone
```

Keep the loopback Supabase URL and public application origin from
`.env.example`. Add only the browser-safe local anonymous key printed by the
local Supabase CLI. Never put a service-role key or hosted credential in a
`VITE_` variable.

## Start the local application

```sh
npm run db:start
npm run db:reset
npm run dev
```

The application runs at `http://127.0.0.1:8080`. Local Auth uses the same site
and redirect origin and enforces the documented 12-character password minimum.
The reset creates one neutral `Community Gear Share` community with
approval-required membership and no member, catalog, loan, or invitation data.

The founding Administrator is deliberately not seeded. An authorized local
operator can inspect the guarded command without making a change:

```sh
npm run bootstrap-steward
```

Use only synthetic local identities. Creating a hosted administrator or
changing a deployed community is an operator action outside this setup guide.

## Stop without deleting data

```sh
npm run db:stop
```

The command preserves local volumes. Destructive local reset and cleanup remain
explicit actions.

## Deployment-specific configuration

A private deployment supplies its community name, authorized logo path,
privacy-contact route, isolated Supabase project, hosted application origin,
provider settings, and backup policy outside the public defaults. See
`.env.example` for browser configuration names. Secrets and hosted identifiers
must remain in the deployment's secret/configuration system and private
operational records.
