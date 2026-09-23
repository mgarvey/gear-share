# Gear Share transactional email activation gate

This is an operator evidence template, not authorization to configure AWS,
Supabase, DNS, a scheduler, or production data. Delivery and feedback remain
disabled until the complete activation gate is satisfied.

## Fail-closed rule

`deliver-transactional-notifications` and `receive-ses-feedback` are one
inseparable rollout unit. Both server flags must be `true`; a partial function
inventory, partial flag state, missing secret, stale evidence, wrong project,
wrong account/region, unconfirmed subscription, unresolved dead-letter backlog,
or failed end-to-end fixture keeps both capabilities off. Private in-app
notifications remain usable while email is off.

Before a separately approved activation, capture non-secret read-only evidence
no older than 24 hours for all of the following:

- exact gear share Supabase project and exact function inventory;
- SES production rather than sandbox access, region, verified identity and one
  From address, Reply-To policy, current quotas, and configuration set;
- a purpose-specific IAM principal with no console login and only
  `ses:SendEmail`, secure transport, the configured `ses:FromAddress`
  condition, and exactly two Resource entries: the verified identity ARN and
  the selected configuration-set ARN. SES v2 authorizes both referenced
  resources when `ConfigurationSetName` is supplied; granting only the
  identity causes `SendEmail` to fail. Grant no SMTP, `ses:*`,
  `ses:SendRawEmail`, SNS, or SQS permission;
- documented access-key rotation and immediate revocation owners/procedure;
- exact same-region SNS TopicArn/account and a confirmed fixed HTTPS
  subscription to `receive-ses-feedback`; during the approved setup window the
  function confirms only a current signed message for that exact topic through
  the validated AWS URL with redirects denied and a two-second timeout;
- an exact platform-ingress rate/cost policy for the fixed feedback route; the
  120-request-per-minute per-isolate guard is defense in depth and is not
  accepted as the hosted ingress ceiling;
- bounded SNS retry policy plus encrypted dead-letter queue with at most 14
  days retention, SNS-service-only enqueue policy, no application read
  credential, non-secret backlog alarm, and an operator-reviewed redrive or
  discard procedure that does not expose payloads in evidence;
- empty/resolved dead-letter backlog, provider-real signed signature fixtures,
  and an end-to-end synthetic complaint and permanent-bounce test proving exact
  message/tag/recipient binding and suppression without real member data.

## Reviewed root function inventory

The checked-in root contains exactly these six Edge Functions:

<!-- reviewed-function-inventory:start -->
- `sanitize-gear-image`
- `draft-gear-listing`
- `deliver-transactional-notifications`
- `receive-ses-feedback`
- `invite-preapproved-member`
- `delete-deactivated-member`
<!-- reviewed-function-inventory:end -->

The exact permitted hosted inventory stages are: empty before rollout; the core
set `{sanitize-gear-image, invite-preapproved-member,
delete-deactivated-member}`; core plus `{draft-gear-listing}` only after
optional AI activation approval; core plus the inseparable pair
`{deliver-transactional-notifications, receive-ses-feedback}` only after SES
activation approval; or all six only after both optional capabilities are
approved. The personal invitation function uses provider-owned Supabase Auth
delivery and is not part of the application SES pair. Any partial SES pair,
unknown function, stale/wrong-project inventory, or unavailable authoritative
listing blocks rollout and authorizes no deployment, deletion, or configuration
change.

Server-side secrets are limited to the purpose-specific SES access key ID and
secret, region, From address, configuration set, exact feedback TopicArn/account,
the delivery worker token, and existing Supabase service configuration. Values
must never appear in source, commits, screenshots, logs, or review artifacts.

Subscription setup temporarily sets
`GEAR_SHARE_SES_FEEDBACK_CONFIRMATION_ENABLED=true` while both delivery flags
remain false. After AWS reports a confirmed subscription, set the confirmation
flag false before enabling the paired delivery and feedback flags together.

Keep the deployment's exact send-resource ARNs in the private operator record,
not in source control. At activation time, current evidence must show one
reviewed identity ARN and one reviewed configuration-set ARN in the same account
and region; placeholders or previously recorded values are not activation
evidence.

Before activation, verify the application signer against the SES mailbox
simulator after both resources are present. Keep exactly one confirmed HTTPS
subscription to `receive-ses-feedback`; duplicate subscriptions would duplicate
every bounce and complaint delivery.

## Emergency safe-off and recovery

Disable both authoritative email/feedback flags first and capture read-only
evidence that provider calls stop before changing any function, secret,
subscription, or queue. Authoritative application transitions and in-app
notifications continue. Do not retry ambiguous sends automatically.

If feedback delivery exhausts into the dead-letter queue, keep SES delivery off.
An authorized operator must review the bounded backlog, choose redrive or
discard under separate approval, and rerun the end-to-end suppression fixture
before paired reactivation. Key rotation, revocation, function deployment or
removal, subscription changes, redrive/discard, and hosted secret changes remain
separate approvals.
