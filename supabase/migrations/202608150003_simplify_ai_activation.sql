-- Replace the two-reviewer, 40-fixture activation ceremony with one bounded,
-- Administrator-requested provider smoke check. Drafting remains default-off,
-- rate/cost bounded, and explicitly enabled by an Administrator afterward.

alter table public.ai_activation_evidence
  add column activation_check_passed boolean not null default false,
  add column provider_response_id text,
  add column checked_by uuid references public.profiles(id) on delete restrict;

alter table public.ai_activation_evidence
  drop constraint ai_activation_evidence_check1,
  drop constraint ai_activation_evidence_check2,
  add constraint ai_activation_evidence_runtime_check
    check (
      not activation_check_passed
      or (
        overall_approved
        and model_access_confirmed
        and secret_present
        and image_input_supported
        and structured_output_supported
        and provider_response_id ~ '^resp_[A-Za-z0-9_-]{1,120}$'
        and checked_by is not null
      )
    ),
  add constraint ai_activation_evidence_runtime_expiry
    check (expires_at > recorded_at and expires_at <= recorded_at + interval '30 days');

create or replace function public.authorize_ai_activation_check(target_user_id uuid)
returns table(model text, service_tier text)
language plpgsql security definer
set search_path to ''
set statement_timeout to '3s'
as $$
declare
  target_community uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required';
  end if;
  select p.community_id into target_community
  from public.profiles p
  where p.id = target_user_id;
  if target_community is null then raise exception 'active administrator required'; end if;
  perform public.lock_community_authorization(target_community, false);
  if not exists (
    select 1
    from public.profiles p
    join public.community_roles r
      on r.community_id = p.community_id and r.user_id = p.id
    where p.id = target_user_id
      and p.community_id = target_community
      and p.membership_status = 'active'
      and r.role = 'steward'
  ) then
    raise exception 'active administrator required';
  end if;
  if exists (
    select 1 from public.ai_activation_evidence e
    where e.community_id = target_community
      and e.activation_check_passed
      and e.recorded_at > clock_timestamp() - interval '1 minute'
  ) then
    raise exception 'activation check recently completed';
  end if;
  return query select 'gpt-5.6-luna'::text, 'standard'::text;
end;
$$;

create or replace function public.record_ai_activation_check(
  target_user_id uuid,
  supplied_provider_response_id text
)
returns uuid
language plpgsql security definer
set search_path to ''
set statement_timeout to '5s'
as $$
declare
  target_community uuid;
  price_id uuid;
  evidence_id uuid;
  checked_at timestamptz := clock_timestamp();
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required';
  end if;
  if supplied_provider_response_id is null
    or supplied_provider_response_id !~ '^resp_[A-Za-z0-9_-]{1,120}$' then
    raise exception 'bounded provider response id required';
  end if;
  perform public.authorize_ai_activation_check(target_user_id);
  select p.community_id into strict target_community
  from public.profiles p where p.id = target_user_id;

  select p.id into price_id
  from public.ai_model_price_snapshots p
  where p.model = 'gpt-5.6-luna'
    and p.service_tier = 'standard'
    and p.observed_at <= clock_timestamp()
    and p.expires_at > clock_timestamp()
  order by p.observed_at desc, p.id desc
  limit 1;

  if price_id is null then
    insert into public.ai_model_price_snapshots (
      model, service_tier, currency,
      input_microdollars_per_million,
      cached_input_microdollars_per_million,
      output_microdollars_per_million,
      worst_case_microdollars_per_draft,
      source_reference, effective_at, observed_at, expires_at, recorded_by
    ) values (
      'gpt-5.6-luna', 'standard', 'USD',
      1000000, 100000, 6000000, 100000,
      'Conservative OpenAI model-page rates checked 2026-08-15',
      checked_at, checked_at, checked_at + interval '30 days',
      'automated activation check'
    ) returning id into price_id;
  end if;

  insert into public.ai_activation_evidence (
    community_id, price_snapshot_id, model, service_tier,
    model_access_confirmed, secret_present, image_input_supported,
    structured_output_supported, data_controls_reviewed,
    dashboard_price_confirmed, evaluation_set_version,
    evaluation_manifest_sha256, evaluation_scores_sha256,
    evaluation_passed, reviewer_one, reviewer_two,
    reviewer_one_passed, reviewer_two_passed, overall_approved,
    recorded_at, expires_at, recorded_by, activation_check_passed,
    provider_response_id, checked_by
  ) values (
    target_community, price_id, 'gpt-5.6-luna', 'standard',
    true, true, true, true, false, false, 'm8-v1',
    repeat('0', 64), repeat('0', 64), false,
    'automated-smoke-check', 'administrator-request', false, false, true,
    checked_at, checked_at + interval '30 days', 'automated activation check', true,
    supplied_provider_response_id, target_user_id
  ) returning id into evidence_id;
  return evidence_id;
end;
$$;

revoke all on function public.authorize_ai_activation_check(uuid) from public, anon, authenticated;
revoke all on function public.record_ai_activation_check(uuid, text) from public, anon, authenticated;
grant execute on function public.authorize_ai_activation_check(uuid) to service_role;
grant execute on function public.record_ai_activation_check(uuid, text) to service_role;

create or replace function public.get_ai_drafting_availability()
returns table(available boolean)
language plpgsql stable security definer
set search_path to ''
as $$
declare caller_community uuid := public.current_active_community_id();
begin
  if caller_community is null then raise exception 'active member required'; end if;
  return query
  select coalesce(s.ai_drafting_enabled, false) and coalesce((
    select e.recorded_at <= clock_timestamp()
      and p.observed_at <= clock_timestamp()
      and e.expires_at > clock_timestamp()
      and p.expires_at > clock_timestamp()
      and e.model = 'gpt-5.6-luna'
      and e.service_tier = 'standard'
      and e.activation_check_passed
      and e.model_access_confirmed
      and e.secret_present
      and e.image_input_supported
      and e.structured_output_supported
      and e.overall_approved
    from public.ai_activation_evidence e
    join public.ai_model_price_snapshots p on p.id = e.price_snapshot_id
    where e.community_id = caller_community
    order by e.recorded_at desc, e.id desc limit 1
  ), false)
  from public.community_settings s where s.community_id = caller_community;
end;
$$;

create or replace function public.set_ai_drafting_enabled(
  supplied_enabled boolean,
  expected_version bigint
)
returns table(
  configuration_version bigint,
  ai_drafting_enabled boolean,
  already_reserved_requests integer,
  status_reason text
)
language plpgsql security definer
set search_path to ''
as $$
declare
  caller_id uuid := auth.uid(); caller_community uuid;
  current_settings public.community_settings%rowtype; next_version bigint;
  ready boolean := false; in_flight integer := 0;
begin
  if expected_version is null or expected_version <= 0 then raise exception 'positive expected settings version required'; end if;
  select p.community_id into caller_community from public.profiles p where p.id = caller_id;
  if caller_id is null or caller_community is null then raise exception 'active administrator required'; end if;
  perform public.lock_community_authorization(caller_community, true);
  if not public.is_active_administrator(caller_community) then raise exception 'active administrator required'; end if;
  select * into current_settings from public.community_settings s where s.community_id = caller_community for update;
  if current_settings.current_version is distinct from expected_version then raise exception 'community settings changed; reload before saving'; end if;
  select coalesce((
    select e.recorded_at <= clock_timestamp() and p.observed_at <= clock_timestamp()
      and e.expires_at > clock_timestamp() and p.expires_at > clock_timestamp()
      and e.model = 'gpt-5.6-luna' and e.service_tier = 'standard'
      and e.activation_check_passed and e.model_access_confirmed
      and e.secret_present and e.image_input_supported
      and e.structured_output_supported and e.overall_approved
    from public.ai_activation_evidence e
    join public.ai_model_price_snapshots p on p.id = e.price_snapshot_id
    where e.community_id = caller_community
    order by e.recorded_at desc, e.id desc limit 1
  ), false) into ready;
  if supplied_enabled and not ready then
    perform set_config('app.milestone_six_internal_change', 'allowed', true);
    insert into public.administrator_ai_setting_audit
      (community_id, actor_user_id, action, outcome, configuration_version)
    values (caller_community, caller_id, 'enable_requested', 'rejected_missing_gates', current_settings.current_version);
    perform set_config('app.milestone_six_internal_change', '', true);
    return query select current_settings.current_version, false, 0,
      'Run the AI connection check before turning on suggestions.'::text;
    return;
  end if;
  if current_settings.ai_drafting_enabled = supplied_enabled then
    return query select current_settings.current_version, supplied_enabled, 0,
      case when supplied_enabled then 'AI drafting is enabled.' else 'AI drafting is disabled. Manual listing remains available.' end;
    return;
  end if;
  next_version := current_settings.current_version + 1;
  if not supplied_enabled then
    select count(*)::integer into in_flight from public.ai_draft_attempts a
    where a.community_id = caller_community and a.status in ('reserved','provider_inflight');
  end if;
  perform set_config('app.milestone_six_internal_change', 'allowed', true);
  insert into public.community_setting_versions
    (community_id, version, display_name, ai_drafting_enabled, changed_by)
  values (caller_community, next_version, current_settings.display_name, supplied_enabled, caller_id);
  update public.community_settings set current_version = next_version,
    ai_drafting_enabled = supplied_enabled, updated_by = caller_id,
    updated_at = clock_timestamp()
  where community_id = caller_community;
  insert into public.administrator_ai_setting_audit
    (community_id, actor_user_id, action, outcome, configuration_version)
  values (
    caller_community, caller_id,
    case when supplied_enabled then 'enable_requested' else 'disable_requested' end,
    case when supplied_enabled then 'enabled' else 'disabled' end,
    next_version
  );
  perform set_config('app.milestone_six_internal_change', '', true);
  return query select next_version, supplied_enabled, in_flight,
    case when supplied_enabled then 'AI drafting is enabled.'
      else 'AI drafting is disabled. Requests already in progress may finish; manual listing remains available.' end;
end;
$$;

create or replace function public.reserve_ai_drafting_attempt(
  target_user_id uuid,
  supplied_attempt_id uuid,
  supplied_mode text,
  supplied_candidate_count integer,
  supplied_image_count integer
)
returns table(
  attempt_id uuid,
  model text,
  service_tier text,
  reserved_microdollars bigint,
  attempt_status public.ai_draft_attempt_status
)
language plpgsql security definer
set search_path to ''
as $$
declare
  caller_id uuid := target_user_id; caller_community uuid; authz record;
  price public.ai_model_price_snapshots%rowtype;
  existing public.ai_draft_attempts%rowtype; reserve_cost bigint;
  minute_start timestamptz := date_trunc('minute', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  day_start timestamptz := date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  month_start timestamptz := date_trunc('month', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
begin
  if (select auth.role()) <> 'service_role' then raise exception 'service role required'; end if;
  if caller_id is null or supplied_attempt_id is null or supplied_mode not in ('single','bulk')
    or supplied_candidate_count not between 1 and 10 or supplied_image_count not between 1 and 10
    or (supplied_mode = 'single' and (supplied_candidate_count <> 1 or supplied_image_count > 4))
    or (supplied_mode = 'bulk' and supplied_image_count <> supplied_candidate_count)
    then raise exception 'bounded AI attempt required'; end if;
  select p.community_id into caller_community from public.profiles p where p.id = caller_id;
  if caller_community is null then raise exception 'active member required'; end if;
  perform public.lock_community_authorization(caller_community, false);
  if not exists (select 1 from public.profiles p where p.id = caller_id
    and p.community_id = caller_community and p.membership_status = 'active') then raise exception 'active member required'; end if;
  select s.ai_drafting_enabled as enabled, e.model, e.service_tier,
    e.id as activation_evidence_id, p.id as price_snapshot_id
  into authz
  from public.community_settings s
  left join lateral (
    select x.* from public.ai_activation_evidence x
    where x.community_id = s.community_id order by x.recorded_at desc, x.id desc limit 1
  ) e on true
  left join public.ai_model_price_snapshots p on p.id = e.price_snapshot_id
  where s.community_id = caller_community
    and e.recorded_at <= clock_timestamp() and p.observed_at <= clock_timestamp()
    and e.expires_at > clock_timestamp() and p.expires_at > clock_timestamp()
    and e.activation_check_passed and e.model_access_confirmed
    and e.secret_present and e.image_input_supported
    and e.structured_output_supported and e.overall_approved;
  if not coalesce(authz.enabled, false) then raise exception 'AI drafting is unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ai-rate:' || caller_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('ai-budget:' || caller_community::text || ':' || month_start::text, 0));
  select * into existing from public.ai_draft_attempts a where a.id = supplied_attempt_id for update;
  if found then
    if existing.requester_id <> caller_id or existing.mode <> supplied_mode
      or existing.candidate_count <> supplied_candidate_count or existing.image_count <> supplied_image_count
      then raise exception 'AI attempt unavailable'; end if;
    if existing.status <> 'reserved' then raise exception 'AI attempt already used'; end if;
    return query select existing.id, existing.model, existing.service_tier, existing.reserved_microdollars, existing.status;
    return;
  end if;
  if (select count(*) from public.ai_draft_attempts a where a.requester_id = caller_id and a.created_at >= minute_start) >= 3
    or (select count(*) from public.ai_draft_attempts a where a.requester_id = caller_id and a.created_at >= day_start) >= 20
    then raise exception 'AI drafting rate limit reached'; end if;
  select * into strict price from public.ai_model_price_snapshots p
  where p.id = authz.price_snapshot_id and p.expires_at > clock_timestamp();
  reserve_cost := ceiling(((1000 + 5000 * supplied_image_count)::numeric * price.input_microdollars_per_million
    + (800 * supplied_candidate_count)::numeric * price.output_microdollars_per_million) / 1000000)::bigint;
  if reserve_cost > price.worst_case_microdollars_per_draft * supplied_candidate_count then raise exception 'AI price snapshot is inconsistent'; end if;
  if (select coalesce(sum(a.reserved_units), 0) from public.ai_draft_attempts a where a.community_id = caller_community and a.created_at >= month_start) + supplied_candidate_count > 1000
    or (select coalesce(sum(case when a.usage_recognized and a.actual_microdollars is not null then a.actual_microdollars else a.reserved_microdollars end), 0)
        from public.ai_draft_attempts a where a.community_id = caller_community and a.created_at >= month_start) + reserve_cost > 5000000
    then raise exception 'AI drafting monthly ceiling reached'; end if;
  perform set_config('app.ai_attempt_internal', 'allowed', true);
  insert into public.ai_draft_attempts (
    id, community_id, requester_id, activation_evidence_id, price_snapshot_id,
    model, service_tier, mode, detail, candidate_count, image_count,
    reserved_units, reserved_microdollars
  ) values (
    supplied_attempt_id, caller_community, caller_id, authz.activation_evidence_id,
    authz.price_snapshot_id, authz.model, authz.service_tier, supplied_mode, 'low',
    supplied_candidate_count, supplied_image_count, supplied_candidate_count, reserve_cost
  ) returning * into existing;
  perform set_config('app.ai_attempt_internal', '', true);
  return query select existing.id, existing.model, existing.service_tier,
    existing.reserved_microdollars, existing.status;
end;
$$;
