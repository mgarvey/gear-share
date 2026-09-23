# Gear Share static hosting

Gear Share builds as a static Vite single-page application. Run the verified
production build, then publish the contents of `dist/` through a hosting
provider that serves `index.html` for non-file routes and returns 404 for
missing immutable assets:

```sh
npm ci
npm run verify
npm run build
```

The checked-in `public/.htaccess` supplies the reviewed Apache routing behavior
and is copied into `dist/` by the build. `vercel.json` provides the equivalent
reviewed Vercel route rule. Other providers need an equivalent SPA fallback.

This public repository intentionally contains no provider account, SSH target,
deployment credential, private document root, or deployment/rollback script.
A deploying community should keep provider-specific automation and operational
evidence in its private downstream, validate an immutable release before
activation, preserve unrelated host content, and maintain a tested rollback.

Hosted browser configuration must provide the values documented in
`.env.example`. Server-only Supabase, OpenAI, and email-provider values belong
in the hosting or function secret store and must never use a `VITE_` prefix.
The application origin, Supabase Auth Site URL and redirect allowlist, Edge
Function `GEAR_SHARE_APP_ORIGIN`, and privacy-contact route must all describe
the same reviewed deployment. Hosted configuration changes, function
deployment, application deployment, and rollback remain separate approvals.
