# Gear Share

Gear Share is an open-source foundation for a private, community-run lending library for
outdoor equipment. Approved members can list personal or group-owned gear,
browse availability for specific dates, request loans, coordinate handoffs,
track returns, and post wanted-gear requests.

This repository is a community-neutral GitHub fork of Community Supplies. It is
intended for groups to study and adapt, not as a hosted multi-community service
or a one-click deployment. Each deployment uses its own private data, provider
accounts, configuration, administrators, and operational review.

## Privacy and access model

- The catalog, gear photos, member details, and loan activity are private.
- New accounts remain pending until an Administrator approves them, unless an
  Administrator issued a matching preapproved invitation.
- Supabase Row Level Security and server-side operations enforce membership,
  community, role, ownership, and loan-state boundaries.
- Gear images are stored privately and are served only through authorized,
  time-limited access.
- The application has no fees, deposits, payment processing, or public member
  directory.

Do not use real member data, production credentials, or a production database
while evaluating or adapting this repository.

## What is included

- A React, TypeScript, and Vite frontend
- A Supabase/Postgres schema, migrations, Row Level Security policies, storage
  controls, and Edge Functions
- Membership review and role administration
- Date-aware catalog availability and formal loan workflows
- Individual-owned and group-owned inventory management
- Private gear photos, wanted requests, in-app notifications, and coordinator
  tools
- Optional, default-off AI listing assistance and transactional email paths
- Deterministic local verification and static-host deployment support

## Project status

This is production-adjacent community software. The public repository is the
canonical source for reusable application code, database behavior, tests,
generic documentation, and tooling. A deploying community must provide and review its own Supabase
project, identity-provider configuration, privacy contact, administrators,
backup policy, hosting, and operational controls. Optional AI and email features
remain unavailable unless their separate server-side activation requirements
are deliberately satisfied.

## Local development

### Prerequisites

- Node.js 24.x
- npm 11.x
- Docker, when running the local Supabase stack or database tests

The checked-in `.nvmrc` and `.node-version` identify the supported Node runtime.

### Install and verify

```sh
git clone https://github.com/mgarvey/gear-share.git
cd gear-share
npm ci
cp .env.example .env.local
npm run verify
```

`npm run verify` runs type-checking, linting, unit and configuration tests,
policy checks, a production build, and static-host routing checks. It uses
isolated verification settings and does not connect to a hosted Supabase
project.

### Start the local application

Start the local Supabase stack and copy the local anonymous key reported by the
CLI into `.env.local`:

```sh
npm run db:start
npm run db:reset
npm run dev
```

The local database starts from the repository's neutral community baseline.
Creating the first Administrator is intentionally an explicit operator action;
see [the setup guide](docs/setup.md). Running
`npm run bootstrap-steward` without arguments prints its required usage and
makes no database change.

Stop the local stack without deleting its volumes:

```sh
npm run db:stop
```

## Configuration

Copy `.env.example` to `.env.local`. Never commit the populated file.

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | URL for the community's isolated Supabase project |
| `VITE_SUPABASE_ANON_KEY` | Supabase browser-safe anonymous key |
| `VITE_PUBLIC_APP_ORIGIN` | Exact application origin used for auth callbacks |
| `VITE_PRIVACY_CONTACT_URL` | Public HTTPS privacy-inquiry route |
| `VITE_BACKUP_RETENTION_DAYS` | Reviewed encrypted-backup retention maximum |
| `VITE_COMMUNITY_NAME` | Community name used in initial public branding |
| `VITE_COMMUNITY_LOGO_URL` | Root-relative path to reviewed community artwork; defaults to the generic favicon |

The build fails closed when required configuration is missing or unsafe. It
also rejects the inherited Community Supplies backend outside an explicit
upstream-development mode.

## Adapting it for another group

At minimum, a new community should:

1. Create an isolated Supabase project and apply the reviewed migrations.
2. Supply a reviewed community name and authorized artwork through configuration;
   authenticated runtime presentation can later use the Administrator-controlled display name.
3. Configure the exact application origin, auth providers and redirects, a
   public privacy-contact route, and an encrypted backup policy.
4. Appoint and bootstrap a founding Administrator using the guarded operator
   command.
5. Run `npm run verify` and the Docker-backed database test suite before any
   hosted rollout.
6. Keep optional AI and transactional email disabled unless the corresponding
   operational and security controls have been independently reviewed.

This repository intentionally does not automate creation of hosted resources,
production credentials, DNS, OAuth applications, or the founding Administrator.

See [setup](docs/setup.md), [static hosting](docs/hosting.md), [contributing](CONTRIBUTING.md),
[security](SECURITY.md), and [private deployment maintenance](docs/private-deployments.md)
for the remaining boundaries.

## Verification commands

```sh
npm run verify       # deterministic checks without a hosted project
npm run db:start     # start the local Supabase stack
npm run db:reset     # apply the canonical local baseline
npm run test:db      # Docker-backed database and storage checks
npm run db:stop      # stop while preserving local volumes
```

## Origin and license

This project is based on
[Community Supplies](https://github.com/The-Relational-Technology-Project/community-supplies)
by the Relational Tech Project. This repository deliberately retains the GitHub
fork relationship, upstream history, MIT license, and attribution. Upstream
changes are evaluated individually rather than merged automatically. The Gear
Share adaptation is also distributed under the [MIT License](LICENSE); asset
sources and redistribution decisions are recorded in
[the asset provenance ledger](docs/asset-provenance.md).
