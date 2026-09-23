# Maintaining a private deployment

Gear Share's reusable application code lives in the public repository. A
deploying community can keep presentation settings, authorized community
artwork, provider configuration, operational procedures, and deployment
evidence in a private repository that retains the public Git history.

## Private overlay boundary

The supported private-only path families are:

- `config/private/**`
- `public/brand/private/**`
- `docs/operations/**`
- `docs/evidence/**`

Reusable application code, database migrations, Edge Functions, tests, and
generic documentation should be changed publicly. An urgent reusable-source
hotfix may remain private temporarily only when the downstream contract records
its paths, rationale, tests, owner, review date, and public reconciliation
link.

## Adopting a tagged public release

Authenticate and fetch the proposed public tag, then run the read-only planner:

```sh
npm run plan:downstream-release -- --new-tag gear-share-v1.1.0
```

The private update pull request should record:

- the old public tag and commit from `config/private/downstream-contract.json`;
- the authenticated new public tag and commit;
- the public release diff and resulting private integration diff;
- frozen installation plus `npm run verify` results;
- every temporary hotfix that was removed, reconciled, or remains explicitly
  time-bounded with its public reconciliation link; and
- confirmation that the contract changes only after verification passes.

`npm run verify` automatically detects the private contract, omits the
public-tree publication scan, and runs the downstream drift check. The public
publication scan remains mandatory in a public checkout.

Merging a private update changes source control only. Deployment, hosted
configuration, provider activation, and data changes require their own review
and authorization.
