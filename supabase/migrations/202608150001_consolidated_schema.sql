

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."ai_draft_attempt_status" AS ENUM (
    'reserved',
    'provider_inflight',
    'completed',
    'failed',
    'unknown_usage'
);


ALTER TYPE "public"."ai_draft_attempt_status" OWNER TO "postgres";


CREATE TYPE "public"."app_role" AS ENUM (
    'member',
    'steward',
    'custodian'
);


ALTER TYPE "public"."app_role" OWNER TO "postgres";


CREATE TYPE "public"."community_join_mode" AS ENUM (
    'approval_required'
);


ALTER TYPE "public"."community_join_mode" OWNER TO "postgres";


CREATE TYPE "public"."gear_loan_status" AS ENUM (
    'pending',
    'approved',
    'checked_out',
    'returned',
    'declined',
    'cancelled'
);


ALTER TYPE "public"."gear_loan_status" OWNER TO "postgres";


CREATE TYPE "public"."listing_status" AS ENUM (
    'listed',
    'unlisted',
    'retired'
);


ALTER TYPE "public"."listing_status" OWNER TO "postgres";


CREATE TYPE "public"."membership_status" AS ENUM (
    'pending',
    'active',
    'rejected',
    'deactivated'
);


ALTER TYPE "public"."membership_status" OWNER TO "postgres";


CREATE TYPE "public"."ownership_kind" AS ENUM (
    'individual',
    'group'
);


ALTER TYPE "public"."ownership_kind" OWNER TO "postgres";


CREATE TYPE "public"."wanted_offer_status" AS ENUM (
    'active',
    'selected',
    'invalidated'
);


ALTER TYPE "public"."wanted_offer_status" OWNER TO "postgres";


CREATE TYPE "public"."wanted_request_status" AS ENUM (
    'open',
    'fulfilled',
    'closed',
    'moderated'
);


ALTER TYPE "public"."wanted_request_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."active_member_introduction"("target_profile_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select s.introduction from public.member_profile_settings s
  join public.profiles target on target.id = s.profile_id and target.community_id = s.community_id
  where target.id = target_profile_id and target.membership_status = 'active'
    and target.community_id = public.current_active_community_id()
$$;


ALTER FUNCTION "public"."active_member_introduction"("target_profile_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_verified_ses_feedback"("supplied_topic_arn" "text", "supplied_sns_message_id" "text", "supplied_feedback_kind" "text", "supplied_ses_message_id" "text", "supplied_recipient_email" "text", "supplied_delivery_tag" "uuid", "supplied_occurred_at" timestamp with time zone) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "lock_timeout" TO '3s'
    SET "statement_timeout" TO '10s'
    AS $$
declare item public.transactional_email_outbox%rowtype; normalized_recipient_email text := lower(btrim(supplied_recipient_email)); now_at timestamptz := clock_timestamp(); inserted_id uuid;
begin
  if supplied_topic_arn is null or length(supplied_topic_arn) not between 20 and 300
    or supplied_sns_message_id is null or length(supplied_sns_message_id) not between 1 and 200
    or supplied_feedback_kind not in ('complaint', 'permanent_bounce', 'transient_bounce')
    or supplied_ses_message_id is null or length(supplied_ses_message_id) not between 1 and 200
    or supplied_recipient_email is distinct from normalized_recipient_email
    or length(normalized_recipient_email) not between 3 and 254
    or supplied_delivery_tag is null or supplied_occurred_at is null
    or supplied_occurred_at < now_at - interval '24 hours'
    or supplied_occurred_at > now_at + interval '1 minute' then
    raise exception 'bounded verified SES feedback required';
  end if;
  select * into item from public.transactional_email_outbox o
  where o.provider_message_id = supplied_ses_message_id
    and o.delivery_tag = supplied_delivery_tag
    and o.email_snapshot = normalized_recipient_email
    and o.status = 'delivered'
  for update;
  if not found then raise exception 'matching delivered notification required'; end if;

  insert into public.ses_feedback_events
    (topic_arn, sns_message_id, outbox_id, feedback_kind, occurred_at)
  values
    (supplied_topic_arn, supplied_sns_message_id, item.id,
     supplied_feedback_kind, supplied_occurred_at)
  on conflict (topic_arn, sns_message_id) do nothing
  returning id into inserted_id;
  if inserted_id is null then return 'duplicate'; end if;
  if supplied_feedback_kind = 'transient_bounce' then return 'processed'; end if;

  perform set_config('app.notification_internal_change', 'allowed', true);
  insert into public.transactional_email_suppressions
    (community_id, recipient_user_id, normalized_email, reason, source_outbox_id)
  values
    (item.community_id, item.recipient_user_id, normalized_recipient_email,
     case supplied_feedback_kind when 'complaint' then 'complaint' else 'permanent_bounce' end,
     item.id)
  on conflict (recipient_user_id, normalized_email) do update
    set reason = case
        when excluded.reason = 'complaint' then 'complaint'
        when public.transactional_email_suppressions.reason = 'complaint' then 'complaint'
        else 'permanent_bounce'
      end,
      source_outbox_id = excluded.source_outbox_id,
      updated_at = now_at, cleared_at = null, cleared_by = null;
  update public.transactional_email_outbox o
  set status = 'address_suppressed', terminal_at = now_at,
      next_attempt_at = null, updated_at = now_at
  where o.recipient_user_id = item.recipient_user_id
    and o.email_snapshot = normalized_recipient_email and o.status in ('pending', 'retry');
  perform public.emit_private_notification(
    'email_delivery_suppressed', item.id::text, txid_current(),
    item.community_id, item.recipient_user_id,
    '{"schema_version":1}'::jsonb, now_at
  );
  perform set_config('app.notification_internal_change', '', true);
  return 'processed';
end;
$$;


ALTER FUNCTION "public"."apply_verified_ses_feedback"("supplied_topic_arn" "text", "supplied_sns_message_id" "text", "supplied_feedback_kind" "text", "supplied_ses_message_id" "text", "supplied_recipient_email" "text", "supplied_delivery_tag" "uuid", "supplied_occurred_at" timestamp with time zone) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."gear_loans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "community_id" "uuid" NOT NULL,
    "supply_id" "uuid" NOT NULL,
    "borrower_id" "uuid" NOT NULL,
    "custodian_at_request_id" "uuid" NOT NULL,
    "quantity" integer NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "status" "public"."gear_loan_status" DEFAULT 'pending'::"public"."gear_loan_status" NOT NULL,
    "borrower_note" "text",
    "decided_by" "uuid",
    "decided_at" timestamp with time zone,
    "checked_out_by" "uuid",
    "checked_out_at" timestamp with time zone,
    "returned_by" "uuid",
    "returned_at" timestamp with time zone,
    "cancelled_by" "uuid",
    "cancelled_at" timestamp with time zone,
    "cancellation_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "handoff_contact_id" "uuid",
    CONSTRAINT "gear_loans_borrower_note_check" CHECK ((("borrower_note" IS NULL) OR ("length"("borrower_note") <= 2000))),
    CONSTRAINT "gear_loans_cancellation_audit" CHECK (((("cancelled_at" IS NULL) AND ("cancelled_by" IS NULL) AND ("cancellation_reason" IS NULL)) OR (("cancelled_at" IS NOT NULL) AND ("cancelled_by" IS NOT NULL) AND ("length"("btrim"("cancellation_reason")) > 0)))),
    CONSTRAINT "gear_loans_checkout_audit" CHECK (((("checked_out_at" IS NULL) AND ("checked_out_by" IS NULL)) OR (("checked_out_at" IS NOT NULL) AND ("checked_out_by" IS NOT NULL)))),
    CONSTRAINT "gear_loans_date_order" CHECK (("end_date" >= "start_date")),
    CONSTRAINT "gear_loans_decision_audit" CHECK (((("decided_at" IS NULL) AND ("decided_by" IS NULL)) OR (("decided_at" IS NOT NULL) AND ("decided_by" IS NOT NULL)))),
    CONSTRAINT "gear_loans_quantity_check" CHECK (("quantity" > 0)),
    CONSTRAINT "gear_loans_return_audit" CHECK (((("returned_at" IS NULL) AND ("returned_by" IS NULL)) OR (("returned_at" IS NOT NULL) AND ("returned_by" IS NOT NULL))))
);


ALTER TABLE "public"."gear_loans" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_gear_loan"("target_loan_id" "uuid") RETURNS "public"."gear_loans"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select public.approve_gear_loan(target_loan_id, null)
$$;


ALTER FUNCTION "public"."approve_gear_loan"("target_loan_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_gear_loan"("target_loan_id" "uuid", "supplied_handoff_contact_id" "uuid") RETURNS "public"."gear_loans"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  relation_community uuid;
  relation_supply uuid;
  request public.gear_loans%rowtype;
  item public.supplies%rowtype;
  updated public.gear_loans;
  peak integer;
begin
  select gl.community_id, gl.supply_id into relation_community, relation_supply
  from public.gear_loans gl where gl.id = target_loan_id;
  if not found then raise exception 'pending request not found'; end if;
  perform public.lock_community_authorization(relation_community, false);
  perform public.lock_listing(relation_supply);
  select * into request from public.gear_loans where id = target_loan_id for update;
  select * into item from public.supplies where id = relation_supply for update;
  if request.status <> 'pending' then raise exception 'request is no longer pending'; end if;
  if item.id is null or item.community_id <> relation_community or request.supply_id <> item.id
      or item.listing_status = 'retired' or not public.loan_manager_authorized(item, 'approve') then
    raise exception 'current authorized manager required';
  end if;
  if item.condition is null then raise exception 'canonical listing condition required before approval'; end if;
  if item.needs_attention then raise exception 'Needs Attention must be cleared before approval'; end if;
  if item.ownership_kind = 'individual' and supplied_handoff_contact_id is not null
      and supplied_handoff_contact_id is distinct from item.owner_id then
    raise exception 'individual loan handoff must be the active owner';
  end if;
  if item.ownership_kind = 'group' and supplied_handoff_contact_id is not null
      and not public.valid_group_handoff(item.community_id, supplied_handoff_contact_id) then
    raise exception 'active Custodian or Administrator handoff contact required';
  end if;
  peak := public.max_committed_quantity(item.id, request.start_date, request.end_date, request.id);
  if peak + request.quantity > item.quantity_total then raise exception 'insufficient date-sensitive availability'; end if;
  update public.gear_loans
  set status = 'approved', decided_by = auth.uid(), decided_at = now(),
      handoff_contact_id = case
        when item.ownership_kind = 'individual' then item.owner_id
        else coalesce(supplied_handoff_contact_id, auth.uid())
      end
  where id = request.id and status = 'pending'
  returning * into updated;
  if not found then raise exception 'request changed concurrently'; end if;
  return updated;
end;
$$;


ALTER FUNCTION "public"."approve_gear_loan"("target_loan_id" "uuid", "supplied_handoff_contact_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."available_quantity"("target_supply_id" "uuid", "range_start" "date", "range_end" "date") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select greatest(0, s.quantity_total - public.max_committed_quantity(s.id, range_start, range_end))
  from public.supplies s
  where s.id = target_supply_id
    and range_start is not null
    and range_end >= range_start
    and public.is_active_member(s.community_id)
$$;


ALTER FUNCTION "public"."available_quantity"("target_supply_id" "uuid", "range_start" "date", "range_end" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."batch_stage_gear_drafts"("supplied_candidates" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  candidate jsonb;
  candidate_index integer := 0;
  result jsonb := '[]'::jsonb;
  item public.supplies%rowtype;
  media_attempt public.gear_media_upload_attempts%rowtype;
  attempt_id uuid;
  ownership text;
  allowed_keys constant text[] := array[
    'attemptId','title','description','category','condition','quantity',
    'ownershipKind','custodianId','expectedImages','sourceDigest','guidelines'
  ];
begin
  if auth.uid() is null or jsonb_typeof(supplied_candidates) <> 'array'
    or jsonb_array_length(supplied_candidates) not between 1 and 10 then
    raise exception 'one to ten bulk candidates are required';
  end if;
  if public.current_active_community_id() is null then raise exception 'active member required'; end if;
  if exists (
      select 1 from jsonb_array_elements(supplied_candidates) value
      where jsonb_typeof(value) <> 'object'
        or coalesce(value->>'attemptId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) or (
      select count(distinct value->>'attemptId')
      from jsonb_array_elements(supplied_candidates) value
    ) <> jsonb_array_length(supplied_candidates) then
    raise exception 'bulk candidate attempt identifiers must be unique';
  end if;
  for candidate in select value from jsonb_array_elements(supplied_candidates) loop
    candidate_index := candidate_index + 1;
    attempt_id := null;
    begin
      if jsonb_typeof(candidate) <> 'object'
        or exists (select 1 from jsonb_object_keys(candidate) k where not k = any(allowed_keys))
        or exists (select 1 from unnest(allowed_keys) k where not candidate ? k) then
        raise exception 'candidate fields do not match the reviewed contract';
      end if;
      attempt_id := (candidate->>'attemptId')::uuid;
      ownership := candidate->>'ownershipKind';
      if not public.valid_plain_text(candidate->>'title', 120)
        or btrim(candidate->>'title') = ''
        or (coalesce(candidate->>'description', '') <> '' and not public.valid_plain_text(candidate->>'description', 1000))
        or coalesce(candidate->>'quantity', '') !~ '^[1-9][0-9]?$'
        or (candidate->>'quantity')::integer not between 1 and 99
        or coalesce(candidate->>'expectedImages', '') !~ '^[1-4]$'
        or (candidate->>'expectedImages')::integer not between 1 and 4
        or candidate->>'sourceDigest' !~ '^[0-9a-f]{64}$'
        or jsonb_typeof(candidate->'guidelines') <> 'array' then
        raise exception 'one to four photos are required';
      end if;
      if ownership = 'individual' then
        if nullif(candidate->>'custodianId', '') is not null then raise exception 'individual item cannot select a pickup contact'; end if;
        item := public.create_or_resume_individual_draft_with_guidelines(
          attempt_id, candidate->>'title', candidate->>'description', candidate->>'category',
          (candidate->>'quantity')::integer, candidate->>'condition',
          (candidate->>'expectedImages')::integer,
          array(select jsonb_array_elements_text(candidate->'guidelines'))
        );
      elsif ownership = 'group' then
        item := public.create_or_resume_group_draft_with_guidelines(
          attempt_id, candidate->>'title', candidate->>'description', candidate->>'category',
          (candidate->>'quantity')::integer, (candidate->>'custodianId')::uuid,
          candidate->>'condition', (candidate->>'expectedImages')::integer,
          array(select jsonb_array_elements_text(candidate->'guidelines'))
        );
      else
        raise exception 'item ownership is required';
      end if;
      media_attempt := public.begin_gear_media_upload(item.id, 0, candidate->>'sourceDigest');
      result := result || jsonb_build_array(jsonb_build_object(
        'index', candidate_index - 1, 'attemptId', attempt_id, 'status', 'staged',
        'supplyId', item.id, 'communityId', item.community_id,
        'guidelineVersion', item.guideline_version,
        'mediaAttemptId', media_attempt.id
      ));
    exception when others then
      result := result || jsonb_build_array(jsonb_build_object(
        'index', candidate_index - 1, 'attemptId', attempt_id,
        'status', 'failed', 'error', 'item_rejected'
      ));
    end;
  end loop;
  return result;
end;
$_$;


ALTER FUNCTION "public"."batch_stage_gear_drafts"("supplied_candidates" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gear_media_upload_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "community_id" "uuid" NOT NULL,
    "supply_id" "uuid" NOT NULL,
    "uploader_id" "uuid" NOT NULL,
    "slot_index" smallint NOT NULL,
    "source_digest" "text" NOT NULL,
    "staging_path" "text" NOT NULL,
    "final_path" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "failure_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "gear_media_attempt_completion" CHECK (((("status" = 'complete'::"text") AND ("final_path" IS NOT NULL) AND ("completed_at" IS NOT NULL) AND ("failure_reason" IS NULL)) OR (("status" = 'failed'::"text") AND ("final_path" IS NULL) AND ("completed_at" IS NOT NULL) AND ("failure_reason" IS NOT NULL)) OR (("status" = 'pending'::"text") AND ("final_path" IS NULL) AND ("completed_at" IS NULL) AND ("failure_reason" IS NULL)))),
    CONSTRAINT "gear_media_upload_attempts_failure_reason_check" CHECK ((("failure_reason" IS NULL) OR ("length"("failure_reason") <= 300))),
    CONSTRAINT "gear_media_upload_attempts_slot_index_check" CHECK ((("slot_index" >= 0) AND ("slot_index" <= 3))),
    CONSTRAINT "gear_media_upload_attempts_source_digest_check" CHECK (("source_digest" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "gear_media_upload_attempts_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'complete'::"text", 'failed'::"text"])))
);

ALTER TABLE ONLY "public"."gear_media_upload_attempts" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."gear_media_upload_attempts" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."begin_gear_media_upload"("target_supply_id" "uuid", "supplied_slot" integer, "supplied_source_digest" "text") RETURNS "public"."gear_media_upload_attempts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  caller_id uuid := auth.uid();
  item public.supplies%rowtype;
  attempt public.gear_media_upload_attempts%rowtype;
  owner_is_active boolean;
begin
  if supplied_slot is null or supplied_slot not between 0 and 3 then raise exception 'media slot must be between zero and three'; end if;
  if supplied_source_digest !~ '^[0-9a-f]{64}$' then raise exception 'valid source digest required'; end if;
  perform public.lock_listing(target_supply_id);
  select * into item from public.supplies where id = target_supply_id for update;
  if not found or item.listing_status = 'retired' or not public.is_active_member(item.community_id) then raise exception 'listing unavailable'; end if;
  if item.ownership_kind = 'individual' then
    select p.membership_status = 'active' into owner_is_active from public.profiles p where p.id = item.owner_id;
    if not coalesce(owner_is_active, false) or (item.owner_id <> caller_id and not public.is_active_inventory_manager(item.community_id)) then
      raise exception 'individual owner or inventory manager required';
    end if;
  elsif not public.is_active_inventory_manager(item.community_id) then
    raise exception 'inventory manager required for group media';
  end if;
  select * into attempt from public.gear_media_upload_attempts a
  where a.supply_id = item.id and a.slot_index = supplied_slot and a.source_digest = supplied_source_digest
  for update;
  if found then return attempt; end if;
  attempt.id := gen_random_uuid();
  insert into public.gear_media_upload_attempts (id, community_id, supply_id, uploader_id, slot_index, source_digest, staging_path)
  values (attempt.id, item.community_id, item.id, caller_id, supplied_slot, supplied_source_digest,
    item.community_id::text || '/' || item.id::text || '/' || attempt.id::text || '.jpg')
  returning * into attempt;
  return attempt;
end;
$_$;


ALTER FUNCTION "public"."begin_gear_media_upload"("target_supply_id" "uuid", "supplied_slot" integer, "supplied_source_digest" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bootstrap_founding_steward"("target_user_id" "uuid", "supplied_operator_identifier" "text", "supplied_reason" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  target_profile public.profiles%rowtype;
begin
  if nullif(btrim(supplied_operator_identifier), '') is null
     or nullif(btrim(supplied_reason), '') is null then
    raise exception 'operator identifier and reason are required';
  end if;

  select p.* into target_profile
  from public.profiles p
  join auth.users u on u.id = p.id
  join public.communities c
    on c.id = p.community_id
   and c.id = '7b000000-0000-4000-8000-000000000001'::uuid
  where p.id = target_user_id
    and p.membership_status = 'pending'
    and u.email_confirmed_at is not null
  for update of p;

  if not found then
    raise exception 'target must be a confirmed pending community member';
  end if;

  perform 1 from public.communities c where c.id = target_profile.community_id for update;
  if exists (select 1 from public.founding_steward_bootstrap) then
    raise exception 'founding steward already bootstrapped';
  end if;

  update public.profiles
  set membership_status = 'active', approved_at = now(), approved_by = target_user_id
  where id = target_user_id;

  insert into public.community_roles (community_id, user_id, role, granted_by)
  values
    (target_profile.community_id, target_user_id, 'member', target_user_id),
    (target_profile.community_id, target_user_id, 'steward', target_user_id);

  insert into public.founding_steward_bootstrap
    (community_id, user_id, operator_identifier, reason)
  values
    (target_profile.community_id, target_user_id, btrim(supplied_operator_identifier), btrim(supplied_reason));

  insert into public.role_audit
    (community_id, target_user_id, role, action, operator_identifier, reason)
  values
    (target_profile.community_id, target_user_id, 'steward', 'bootstrap',
     btrim(supplied_operator_identifier), btrim(supplied_reason));
end;
$$;


ALTER FUNCTION "public"."bootstrap_founding_steward"("target_user_id" "uuid", "supplied_operator_identifier" "text", "supplied_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_gear_object"("object_name" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  community_part text;
  supply_part text;
  item public.supplies%rowtype;
  owner_is_active boolean;
begin
  community_part := split_part(object_name, '/', 1);
  supply_part := split_part(object_name, '/', 2);
  if community_part !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or supply_part !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;
  perform public.lock_community_authorization(community_part::uuid, false);
  select * into item from public.supplies s
  where s.id = supply_part::uuid and s.community_id = community_part::uuid;
  if not found or item.listing_status = 'retired' or not public.is_active_member(item.community_id) then return false; end if;
  if item.ownership_kind = 'group' then return public.is_active_inventory_manager(item.community_id); end if;
  select p.membership_status = 'active' into owner_is_active from public.profiles p where p.id = item.owner_id;
  return coalesce(owner_is_active, false)
    and (item.owner_id = auth.uid() or public.is_active_inventory_manager(item.community_id));
exception when invalid_text_representation then return false;
end;
$_$;


ALTER FUNCTION "public"."can_manage_gear_object"("object_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_canonical_gear_category"("value" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO ''
    AS $$
  select value in (
    'tents-shelters', 'sleep-systems', 'packs-storage', 'camp-kitchen',
    'water-hydration', 'tools-repair', 'safety-first-aid',
    'program-activity', 'uniforms-apparel', 'books-guides', 'other-gear'
  )
$$;


ALTER FUNCTION "public"."is_canonical_gear_category"("value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_canonical_gear_condition"("value" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO ''
    AS $$
  select value in ('excellent', 'good', 'fair', 'needs_repair')
$$;


ALTER FUNCTION "public"."is_canonical_gear_condition"("value" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supplies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "community_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "category" "text",
    "ownership_kind" "public"."ownership_kind" NOT NULL,
    "owner_id" "uuid",
    "custodian_id" "uuid" NOT NULL,
    "quantity_total" integer NOT NULL,
    "listing_status" "public"."listing_status" DEFAULT 'unlisted'::"public"."listing_status" NOT NULL,
    "image_paths" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "retired_at" timestamp with time zone,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "condition" "text",
    "publication_attempt_id" "uuid",
    "publication_expected_images" smallint DEFAULT 0 NOT NULL,
    "needs_attention" boolean DEFAULT false NOT NULL,
    "needs_attention_reason" "text",
    "needs_attention_version" bigint DEFAULT 0 NOT NULL,
    "guideline_version" bigint DEFAULT 0 NOT NULL,
    CONSTRAINT "supplies_canonical_category" CHECK ((("category" IS NOT NULL) AND "public"."is_canonical_gear_category"("category"))),
    CONSTRAINT "supplies_canonical_condition" CHECK ((("condition" IS NULL) OR "public"."is_canonical_gear_condition"("condition"))),
    CONSTRAINT "supplies_description_bounded" CHECK (("char_length"("description") <= 1000)),
    CONSTRAINT "supplies_guideline_version_check" CHECK (("guideline_version" >= 0)),
    CONSTRAINT "supplies_needs_attention_state" CHECK ((("needs_attention" AND ("needs_attention_reason" IS NOT NULL) AND ("needs_attention_version" > 0)) OR ((NOT "needs_attention") AND ("needs_attention_reason" IS NULL)))),
    CONSTRAINT "supplies_owner_kind" CHECK (((("ownership_kind" = 'individual'::"public"."ownership_kind") AND ("owner_id" IS NOT NULL)) OR (("ownership_kind" = 'group'::"public"."ownership_kind") AND ("owner_id" IS NULL)))),
    CONSTRAINT "supplies_publication_expected_images_check" CHECK ((("publication_expected_images" >= 0) AND ("publication_expected_images" <= 4))),
    CONSTRAINT "supplies_quantity_total_check" CHECK (("quantity_total" > 0)),
    CONSTRAINT "supplies_retirement" CHECK (((("listing_status" = 'retired'::"public"."listing_status") AND ("retired_at" IS NOT NULL)) OR (("listing_status" <> 'retired'::"public"."listing_status") AND ("retired_at" IS NULL)))),
    CONSTRAINT "supplies_title_check" CHECK ((("length"("btrim"("title")) >= 1) AND ("length"("btrim"("title")) <= 160)))
);


ALTER TABLE "public"."supplies" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_supply_attention"("item" "public"."supplies") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select public.is_active_member(item.community_id)
    and (
      (item.ownership_kind = 'individual' and item.owner_id = auth.uid()
        and exists (
          select 1 from public.profiles p
          where p.id = item.owner_id and p.community_id = item.community_id
            and p.membership_status = 'active'
        ))
      or public.is_active_inventory_manager(item.community_id)
    )
$$;


ALTER FUNCTION "public"."can_manage_supply_attention"("item" "public"."supplies") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_stage_gear_object"("object_name" "text") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.gear_media_upload_attempts a
    where a.staging_path = object_name
      and a.uploader_id = auth.uid()
      and a.status = 'pending'
      and public.is_active_member(a.community_id)
  );
$$;


ALTER FUNCTION "public"."can_stage_gear_object"("object_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_view_gear_object"("object_name" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare community_part text; supply_part text;
begin
  community_part := split_part(object_name, '/', 1);
  supply_part := split_part(object_name, '/', 2);
  if community_part !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or supply_part !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (
    select 1 from public.supplies s
    where s.id = supply_part::uuid and s.community_id = community_part::uuid
      and public.is_active_member(s.community_id)
  );
exception when invalid_text_representation then return false;
end;
$_$;


ALTER FUNCTION "public"."can_view_gear_object"("object_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_gear_loan"("target_loan_id" "uuid", "supplied_reason" "text" DEFAULT 'cancelled'::"text") RETURNS "public"."gear_loans"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare relation_community uuid; relation_supply uuid; request public.gear_loans%rowtype; item public.supplies%rowtype; updated public.gear_loans;
begin
  select gl.community_id, gl.supply_id into relation_community, relation_supply from public.gear_loans gl where gl.id = target_loan_id;
  if not found then raise exception 'only pending or approved requests can be cancelled'; end if;
  perform public.lock_community_authorization(relation_community, false);
  perform public.lock_listing(relation_supply);
  select * into request from public.gear_loans where id = target_loan_id for update;
  select * into item from public.supplies where id = relation_supply for update;
  if request.status not in ('pending', 'approved') or item.id is null or request.supply_id <> item.id then
    raise exception 'only pending or approved requests can be cancelled';
  end if;
  if not public.is_active_member(request.community_id) then raise exception 'active same-community member required'; end if;
  if auth.uid() <> request.borrower_id and not public.loan_manager_authorized(item, 'cancel') then
    raise exception 'borrower or current authorized manager required';
  end if;
  update public.gear_loans
  set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
      cancellation_reason = coalesce(nullif(btrim(supplied_reason), ''), 'cancelled')
  where id = request.id returning * into updated;
  return updated;
end;
$$;


ALTER FUNCTION "public"."cancel_gear_loan"("target_loan_id" "uuid", "supplied_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."capture_loan_handoff_contact"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare item public.supplies%rowtype; candidate uuid;
begin
  if new.status = 'approved' and old.status = 'pending' then
    select * into item from public.supplies s where s.id = new.supply_id;
    if item.ownership_kind = 'individual' then
      if new.handoff_contact_id is not null and new.handoff_contact_id is distinct from item.owner_id then
        raise exception 'individual loan handoff must be the active owner';
      end if;
      candidate := item.owner_id;
      if not exists (
        select 1 from public.profiles p where p.id = candidate
          and p.community_id = new.community_id and p.membership_status = 'active'
      ) then raise exception 'active handoff contact required'; end if;
    else
      candidate := coalesce(new.handoff_contact_id, auth.uid());
      if not public.valid_group_handoff(new.community_id, candidate) then
        raise exception 'active Custodian or Administrator handoff contact required';
      end if;
    end if;
    new.handoff_contact_id := candidate;
  elsif new.handoff_contact_id is distinct from old.handoff_contact_id
    and (
      coalesce(current_setting('app.loan_handoff_change', true), '') <> 'allowed'
      or current_user <> pg_catalog.pg_get_userbyid(
        (
          select p.proowner
          from pg_catalog.pg_proc p
          where p.oid = 'public.reassign_loan_handoff(uuid,uuid)'::regprocedure
        )
      )
    ) then
    raise exception 'handoff contact is immutable outside the authorized loan workflow';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."capture_loan_handoff_contact"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."checkout_gear_loan"("target_loan_id" "uuid") RETURNS "public"."gear_loans"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare relation_community uuid; relation_supply uuid; request public.gear_loans%rowtype;
  item public.supplies%rowtype; updated public.gear_loans;
begin
  select gl.community_id, gl.supply_id into relation_community, relation_supply
  from public.gear_loans gl where gl.id = target_loan_id;
  if not found then raise exception 'approved request and current authorized manager required'; end if;
  perform public.lock_community_authorization(relation_community, false);
  perform public.lock_listing(relation_supply);
  select * into request from public.gear_loans where id = target_loan_id for update;
  select * into item from public.supplies where id = relation_supply for update;
  if request.status <> 'approved' or item.id is null or request.supply_id <> item.id
      or not public.loan_manager_authorized(item, 'checkout') then
    raise exception 'approved request and current authorized manager required';
  end if;
  if item.condition is null then raise exception 'canonical listing condition required before checkout'; end if;
  if item.needs_attention then raise exception 'Needs Attention must be cleared before checkout'; end if;
  update public.gear_loans set status = 'checked_out', checked_out_by = auth.uid(), checked_out_at = now()
  where id = request.id and status = 'approved' returning * into updated;
  if not found then raise exception 'request changed concurrently'; end if;
  return updated;
end;
$$;


ALTER FUNCTION "public"."checkout_gear_loan"("target_loan_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_transactional_notifications"("supplied_worker_id" "uuid", "batch_limit" integer DEFAULT 25) RETURNS TABLE("outbox_id" "uuid", "claim_token" "uuid", "delivery_tag" "uuid", "recipient_email" "text", "email_subject" "text", "email_body" "text", "app_route" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "lock_timeout" TO '3s'
    SET "statement_timeout" TO '15s'
    AS $$
declare
  candidate record;
  current_email text;
  preference_enabled boolean;
  reminder_valid boolean;
  reminder_community uuid;
  reminder_supply uuid;
  reminder_loan uuid;
  now_at timestamptz := clock_timestamp();
  eligible_ids uuid[] := '{}'::uuid[];
begin
  if supplied_worker_id is null or batch_limit is null or batch_limit not between 1 and 25 then
    raise exception 'bounded delivery claim required';
  end if;
  perform set_config('app.notification_internal_change', 'allowed', true);

  for candidate in
    select o.* from public.transactional_email_outbox o
    where o.status = 'claimed' and o.claimed_at < now_at - interval '10 minutes'
    order by o.claimed_at, o.id limit 100 for update skip locked
  loop
    update public.transactional_email_outbox o
    set status = 'ambiguous', terminal_at = now_at, updated_at = now_at,
        claimed_at = null, claimed_by = null, claim_token = null, next_attempt_at = null
    where o.id = candidate.id;
    insert into public.notification_delivery_attempts
      (outbox_id, attempt_number, outcome, error_code, occurred_at)
    values
      (candidate.id, candidate.attempt_count, 'ambiguous', 'network_ambiguous', now_at)
    on conflict on constraint notification_delivery_attempts_outbox_id_attempt_number_key do nothing;
  end loop;

  for candidate in
    select o.id, o.recipient_user_id, o.community_id, o.event_type,
      o.email_snapshot, o.authoritative_record_id, o.created_at,
      o.attempt_count, r.category, r.email_required
    from public.transactional_email_outbox o
    join public.notification_event_registry r on r.event_type = o.event_type
    where o.status in ('pending', 'retry')
      and coalesce(o.next_attempt_at, o.created_at) <= now_at
    order by coalesce(o.next_attempt_at, o.created_at), o.created_at, o.id
    limit batch_limit
    for update of o skip locked
  loop
    perform public.lock_community_authorization(candidate.community_id, false);
    perform 1 from public.profiles p where p.id = candidate.recipient_user_id and p.community_id = candidate.community_id for update;
    select lower(btrim(u.email::text)) into current_email
    from auth.users u
    where u.id = candidate.recipient_user_id and u.email_confirmed_at is not null
      and u.email is not null and length(btrim(u.email::text)) between 3 and 254;
    preference_enabled := true;
    if candidate.category = 'loan_activity' then
      select coalesce(p.loan_activity, true) into preference_enabled
      from public.transactional_email_preferences p where p.profile_id = candidate.recipient_user_id;
      preference_enabled := coalesce(preference_enabled, true);
    elsif candidate.category = 'loan_reminders' then
      select coalesce(p.loan_reminders, true) into preference_enabled
      from public.transactional_email_preferences p where p.profile_id = candidate.recipient_user_id;
      preference_enabled := coalesce(preference_enabled, true);
    elsif candidate.category = 'wanted_activity' then
      select coalesce(p.wanted_activity, true) into preference_enabled
      from public.transactional_email_preferences p where p.profile_id = candidate.recipient_user_id;
      preference_enabled := coalesce(preference_enabled, true);
    end if;

    reminder_valid := true;
    if candidate.category = 'loan_reminders' then
      select gl.community_id, gl.supply_id, gl.id
      into reminder_community, reminder_supply, reminder_loan
      from public.loan_reminder_events e
      join public.gear_loans gl on gl.id = e.loan_id and gl.community_id = e.community_id
      where e.id::text = candidate.authoritative_record_id;
      if not found then
        reminder_valid := false;
      else
        perform public.lock_community_authorization(reminder_community, false);
        perform public.lock_listing(reminder_supply);
        select gl.status = 'checked_out' into reminder_valid
        from public.gear_loans gl where gl.id = reminder_loan for update;
        reminder_valid := coalesce(reminder_valid, false);
      end if;
    end if;

    if candidate.created_at < now_at - interval '24 hours' or candidate.attempt_count >= 5 then
      update public.transactional_email_outbox set status = 'permanent_failure',
        terminal_at = now_at, next_attempt_at = null, updated_at = now_at
      where id = candidate.id;
    elsif current_email is null then
      update public.transactional_email_outbox set status = 'permanent_failure',
        terminal_at = now_at, next_attempt_at = null, updated_at = now_at
      where id = candidate.id;
    elsif not candidate.email_required and not exists (
      select 1 from public.profiles p where p.id = candidate.recipient_user_id
        and p.community_id = candidate.community_id and p.membership_status = 'active'
    ) then
      update public.transactional_email_outbox set status = 'invalidated',
        terminal_at = now_at, next_attempt_at = null, updated_at = now_at
      where id = candidate.id;
    elsif candidate.category = 'loan_reminders' and not reminder_valid then
      update public.transactional_email_outbox set status = 'invalidated',
        terminal_at = now_at, next_attempt_at = null, updated_at = now_at
      where id = candidate.id;
    elsif exists (
      select 1 from public.transactional_email_suppressions s
      where s.recipient_user_id = candidate.recipient_user_id
        and s.normalized_email = current_email and s.cleared_at is null
    ) then
      update public.transactional_email_outbox set status = 'address_suppressed',
        email_snapshot = current_email, terminal_at = now_at,
        next_attempt_at = null, updated_at = now_at
      where id = candidate.id;
    elsif not candidate.email_required and not preference_enabled then
      update public.transactional_email_outbox set status = 'preference_suppressed',
        email_snapshot = current_email, terminal_at = now_at,
        next_attempt_at = null, updated_at = now_at
      where id = candidate.id;
    else
      update public.transactional_email_outbox set email_snapshot = current_email,
        updated_at = now_at where id = candidate.id;
      eligible_ids := array_append(eligible_ids, candidate.id);
    end if;
  end loop;

  return query
  with candidates as (
    select o.id
    from public.transactional_email_outbox o
    where o.id = any(eligible_ids)
      and o.status in ('pending', 'retry')
      and coalesce(o.next_attempt_at, o.created_at) <= now_at
      and o.attempt_count < 5
      and o.created_at >= now_at - interval '24 hours'
    order by coalesce(o.next_attempt_at, o.created_at), o.created_at, o.id
    limit batch_limit
    for update skip locked
  ), claimed as (
    update public.transactional_email_outbox o
    set status = 'claimed', attempt_count = o.attempt_count + 1,
        claimed_at = now_at, claimed_by = supplied_worker_id,
        claim_token = gen_random_uuid(),
        first_attempt_at = coalesce(o.first_attempt_at, now_at),
        last_attempt_at = now_at, next_attempt_at = null, updated_at = now_at
    where o.id in (select c.id from candidates c)
    returning o.*
  )
  select c.id, c.claim_token, c.delivery_tag, c.email_snapshot,
    left(com.name || ': ' || r.email_subject, 100), r.email_body, r.app_route
  from claimed c
  join public.notification_event_registry r on r.event_type = c.event_type
  join public.communities com on com.id = c.community_id
  order by c.created_at, c.id;
  perform set_config('app.notification_internal_change', '', true);
end;
$$;


ALTER FUNCTION "public"."claim_transactional_notifications"("supplied_worker_id" "uuid", "batch_limit" integer) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wanted_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "community_id" "uuid" NOT NULL,
    "requester_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "category" "text",
    "desired_quantity" integer NOT NULL,
    "desired_start" "date",
    "desired_end" "date",
    "note" "text",
    "status" "public"."wanted_request_status" DEFAULT 'open'::"public"."wanted_request_status" NOT NULL,
    "closure_kind" "text",
    "selected_offer_id" "uuid",
    "transition_version" bigint DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "wanted_requests_check" CHECK ((("desired_start" IS NULL) = ("desired_end" IS NULL))),
    CONSTRAINT "wanted_requests_check1" CHECK ((("desired_start" IS NULL) OR (("desired_end" >= "desired_start") AND (("desired_end" - "desired_start") <= 366)))),
    CONSTRAINT "wanted_requests_check2" CHECK ((("status" = 'closed'::"public"."wanted_request_status") = ("closure_kind" IS NOT NULL))),
    CONSTRAINT "wanted_requests_check3" CHECK ((("status" = 'fulfilled'::"public"."wanted_request_status") = ("selected_offer_id" IS NOT NULL))),
    CONSTRAINT "wanted_requests_closure_kind_check" CHECK ((("closure_kind" IS NULL) OR ("closure_kind" = ANY (ARRAY['voluntary'::"text", 'moderation_restore'::"text"])))),
    CONSTRAINT "wanted_requests_desired_quantity_check" CHECK ((("desired_quantity" >= 1) AND ("desired_quantity" <= 99))),
    CONSTRAINT "wanted_requests_transition_version_check" CHECK (("transition_version" > 0))
);

ALTER TABLE ONLY "public"."wanted_requests" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."wanted_requests" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."close_wanted_request"("target_request_id" "uuid", "supplied_expected_version" bigint) RETURNS "public"."wanted_requests"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare item public.wanted_requests%rowtype;
begin
  select * into item from public.wanted_requests r where r.id = target_request_id;
  if not found then raise exception 'wanted request unavailable'; end if;
  perform public.lock_community_authorization(item.community_id, false);
  select * into item from public.wanted_requests r where r.id = target_request_id for update;
  if not found or not public.is_active_member(item.community_id) or item.requester_id <> auth.uid()
    or item.status <> 'open' or item.transition_version is distinct from supplied_expected_version then
    raise exception 'closable current wanted request required';
  end if;
  update public.wanted_requests set status = 'closed', closure_kind = 'voluntary',
    transition_version = transition_version + 1, updated_at = clock_timestamp()
  where id = item.id returning * into item;
  return item;
end;
$$;


ALTER FUNCTION "public"."close_wanted_request"("target_request_id" "uuid", "supplied_expected_version" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."commit_sanitized_gear_image"("supplied_attempt_id" "uuid", "supplied_source_digest" "text", "supplied_final_path" "text") RETURNS "public"."gear_media_upload_attempts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  locked_supply_id uuid;
  attempt public.gear_media_upload_attempts%rowtype;
  item public.supplies%rowtype;
  expected_path text;
  ordered_paths text[];
begin
  select a.supply_id into locked_supply_id from public.gear_media_upload_attempts a where a.id = supplied_attempt_id;
  if locked_supply_id is null then raise exception 'upload attempt unavailable'; end if;
  perform public.lock_listing(locked_supply_id);
  select * into attempt from public.gear_media_upload_attempts a where a.id = supplied_attempt_id for update;
  if not found or attempt.uploader_id <> caller_id or not public.is_active_member(attempt.community_id) then raise exception 'upload attempt unavailable'; end if;
  if attempt.source_digest <> supplied_source_digest then raise exception 'upload digest mismatch'; end if;
  if attempt.status = 'complete' then
    if attempt.final_path <> supplied_final_path then raise exception 'upload attempt already committed'; end if;
    return attempt;
  end if;
  if attempt.status <> 'pending' then raise exception 'upload attempt unavailable'; end if;
  expected_path := attempt.community_id::text || '/' || attempt.supply_id::text || '/' || attempt.id::text || '.jpg';
  if supplied_final_path <> expected_path then raise exception 'invalid final media path'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'gear-images' and o.name = expected_path) then
    raise exception 'sanitized object receipt missing';
  end if;
  select * into item from public.supplies s where s.id = attempt.supply_id for update;
  if not found or item.community_id <> attempt.community_id or item.listing_status = 'retired' then raise exception 'listing unavailable'; end if;
  ordered_paths := coalesce(item.image_paths, '{}');
  if attempt.slot_index > cardinality(ordered_paths) then raise exception 'media slots must be committed sequentially'; end if;
  if attempt.slot_index = cardinality(ordered_paths) then
    ordered_paths := array_append(ordered_paths, expected_path);
  else
    ordered_paths[attempt.slot_index + 1] := expected_path;
  end if;
  update public.gear_media_upload_attempts
  set status = 'complete', final_path = expected_path, completed_at = now()
  where id = attempt.id returning * into attempt;
  perform public.set_supply_image_paths(attempt.supply_id, ordered_paths);
  return attempt;
end;
$$;


ALTER FUNCTION "public"."commit_sanitized_gear_image"("supplied_attempt_id" "uuid", "supplied_source_digest" "text", "supplied_final_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_ai_drafting_attempt"("supplied_attempt_id" "uuid", "supplied_status" "public"."ai_draft_attempt_status", "supplied_input_tokens" integer, "supplied_cached_input_tokens" integer, "supplied_output_tokens" integer, "supplied_reasoning_output_tokens" integer, "supplied_failure_kind" "text", "supplied_provider_response_id" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  item public.ai_draft_attempts%rowtype;
  price public.ai_model_price_snapshots%rowtype;
  actual bigint;
  recognized boolean;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'service role required'; end if;
  if supplied_status not in ('completed','failed','unknown_usage') then raise exception 'terminal AI status required'; end if;
  select * into item from public.ai_draft_attempts a where a.id = supplied_attempt_id for update;
  if not found then raise exception 'AI attempt unavailable'; end if;
  if item.status not in ('reserved','provider_inflight') then return; end if;
  if supplied_provider_response_id is not null and supplied_provider_response_id !~ '^resp_[A-Za-z0-9_-]{1,120}$' then raise exception 'bounded provider response id required'; end if;
  select * into strict price from public.ai_model_price_snapshots p where p.id = item.price_snapshot_id;
  recognized := supplied_input_tokens is not null
    and supplied_cached_input_tokens is not null
    and supplied_output_tokens is not null
    and supplied_reasoning_output_tokens is not null;
  if recognized then
    if supplied_input_tokens not between 0 and 100000
      or supplied_cached_input_tokens not between 0 and 100000
      or supplied_output_tokens not between 0 and 2400
      or supplied_reasoning_output_tokens not between 0 and 2400
      or supplied_cached_input_tokens > supplied_input_tokens
      or supplied_reasoning_output_tokens > supplied_output_tokens then
      raise exception 'recognized bounded usage is required';
    end if;
    actual := ceiling((supplied_input_tokens::numeric * price.input_microdollars_per_million
      - supplied_cached_input_tokens::numeric * price.input_microdollars_per_million
      + supplied_cached_input_tokens::numeric * price.cached_input_microdollars_per_million
      + supplied_output_tokens::numeric * price.output_microdollars_per_million) / 1000000)::bigint;
  elsif supplied_input_tokens is not null or supplied_cached_input_tokens is not null
    or supplied_output_tokens is not null or supplied_reasoning_output_tokens is not null then
    raise exception 'partial provider usage is not accepted';
  else
    actual := null;
  end if;
  if supplied_status = 'completed' and (not recognized or supplied_failure_kind is not null or supplied_provider_response_id is null) then
    raise exception 'completed attempts require recognized usage and provider evidence';
  elsif supplied_status = 'failed' and supplied_failure_kind is null then
    raise exception 'failed attempts require a bounded reason';
  elsif supplied_status = 'unknown_usage' and (recognized or supplied_failure_kind is null) then
    raise exception 'unknown usage requires conservative failure evidence';
  end if;
  perform set_config('app.ai_attempt_internal', 'allowed', true);
  update public.ai_draft_attempts set status = supplied_status,
    input_tokens = supplied_input_tokens,
    cached_input_tokens = supplied_cached_input_tokens,
    output_tokens = supplied_output_tokens,
    reasoning_output_tokens = supplied_reasoning_output_tokens,
    usage_recognized = recognized,
    actual_microdollars = actual,
    failure_kind = supplied_failure_kind,
    provider_response_id = supplied_provider_response_id,
    completed_at = clock_timestamp()
  where id = supplied_attempt_id;
  perform set_config('app.ai_attempt_internal', '', true);
end;
$_$;


ALTER FUNCTION "public"."complete_ai_drafting_attempt"("supplied_attempt_id" "uuid", "supplied_status" "public"."ai_draft_attempt_status", "supplied_input_tokens" integer, "supplied_cached_input_tokens" integer, "supplied_output_tokens" integer, "supplied_reasoning_output_tokens" integer, "supplied_failure_kind" "text", "supplied_provider_response_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_transactional_notification_delivery"("target_outbox_id" "uuid", "supplied_claim_token" "uuid", "supplied_outcome" "text", "supplied_provider_message_id" "text" DEFAULT NULL::"text", "supplied_error_code" "text" DEFAULT NULL::"text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "lock_timeout" TO '3s'
    SET "statement_timeout" TO '10s'
    AS $_$
declare item public.transactional_email_outbox%rowtype; final_status text; retry_at timestamptz; now_at timestamptz := clock_timestamp();
begin
  if supplied_outcome not in ('delivered', 'retryable', 'permanent', 'permanent_address', 'ambiguous') then
    raise exception 'registered delivery outcome required';
  end if;
  if supplied_error_code is not null and supplied_error_code not in (
    'provider_4xx', 'provider_5xx', 'throttled', 'network_ambiguous',
    'invalid_provider_response', 'address_rejected', 'attempts_exhausted'
  ) then raise exception 'registered delivery error code required'; end if;
  select * into item from public.transactional_email_outbox o
  where o.id = target_outbox_id for update;
  if not found or item.status <> 'claimed' or item.claim_token is distinct from supplied_claim_token then
    raise exception 'active delivery claim required';
  end if;
  if supplied_outcome = 'delivered' and (
    supplied_provider_message_id is null
    or length(supplied_provider_message_id) not between 1 and 200
    or supplied_provider_message_id !~ '^[A-Za-z0-9._:/=-]+$'
  ) then raise exception 'bounded SES message identifier required'; end if;
  if supplied_outcome <> 'delivered' and supplied_provider_message_id is not null then
    raise exception 'provider message identifier requires delivered outcome';
  end if;

  if supplied_outcome = 'delivered' then
    final_status := 'delivered';
  elsif supplied_outcome = 'retryable'
    and item.attempt_count < 5 and item.created_at >= now_at - interval '24 hours' then
    final_status := 'retry';
    retry_at := now_at + case item.attempt_count
      when 1 then interval '1 minute'
      when 2 then interval '5 minutes'
      when 3 then interval '30 minutes'
      else interval '2 hours'
    end + ((get_byte(decode(md5(item.id::text || item.attempt_count::text), 'hex'), 0) % 60) * interval '1 second');
    if retry_at > item.created_at + interval '24 hours' then
      final_status := 'permanent_failure'; retry_at := null;
      supplied_error_code := 'attempts_exhausted';
    end if;
  elsif supplied_outcome = 'ambiguous' then
    final_status := 'ambiguous';
  else
    final_status := 'permanent_failure';
    if supplied_outcome = 'retryable' then supplied_error_code := 'attempts_exhausted'; end if;
  end if;

  perform set_config('app.notification_internal_change', 'allowed', true);
  update public.transactional_email_outbox
  set status = final_status, next_attempt_at = retry_at,
      provider_message_id = supplied_provider_message_id,
      terminal_at = case when final_status = 'retry' then null else now_at end,
      claimed_at = null, claimed_by = null, claim_token = null, updated_at = now_at
  where id = item.id;
  insert into public.notification_delivery_attempts
    (outbox_id, attempt_number, outcome, error_code, provider_message_id, occurred_at)
  values
    (item.id, item.attempt_count, supplied_outcome,
     supplied_error_code, supplied_provider_message_id, now_at);

  if supplied_outcome = 'permanent_address' and item.email_snapshot is not null then
    insert into public.transactional_email_suppressions
      (community_id, recipient_user_id, normalized_email, reason, source_outbox_id)
    values
      (item.community_id, item.recipient_user_id, item.email_snapshot,
       'immediate_permanent', item.id)
    on conflict (recipient_user_id, normalized_email) do update
      set reason = case
          when public.transactional_email_suppressions.reason in ('complaint', 'permanent_bounce')
            then public.transactional_email_suppressions.reason
          else 'immediate_permanent'
        end,
        source_outbox_id = excluded.source_outbox_id,
        updated_at = now_at, cleared_at = null, cleared_by = null;
    update public.transactional_email_outbox o
    set status = 'address_suppressed', terminal_at = now_at,
        next_attempt_at = null, updated_at = now_at
    where o.recipient_user_id = item.recipient_user_id
      and o.email_snapshot = item.email_snapshot and o.status in ('pending', 'retry');
    perform public.emit_private_notification(
      'email_delivery_suppressed', item.id::text, txid_current(),
      item.community_id, item.recipient_user_id,
      '{"schema_version":1}'::jsonb, now_at
    );
  end if;
  perform set_config('app.notification_internal_change', '', true);
  return final_status;
end;
$_$;


ALTER FUNCTION "public"."complete_transactional_notification_delivery"("target_outbox_id" "uuid", "supplied_claim_token" "uuid", "supplied_outcome" "text", "supplied_provider_message_id" "text", "supplied_error_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."convert_individual_donation"("target_supply_id" "uuid", "new_custodian_id" "uuid") RETURNS "public"."supplies"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  listing_community uuid;
  item public.supplies%rowtype;
  updated public.supplies;
begin
  select s.community_id into listing_community from public.supplies s where s.id = target_supply_id;
  if not found then raise exception 'administrator and individual listing required'; end if;
  perform public.lock_community_authorization(listing_community, false);
  if not public.is_active_administrator(listing_community) then
    raise exception 'administrator and individual listing required';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = new_custodian_id and p.community_id = listing_community and p.membership_status = 'active'
    for update
  ) then raise exception 'active same-community contact required'; end if;
  perform public.lock_listing(target_supply_id);
  select * into item from public.supplies where id = target_supply_id for update;
  if not found or item.community_id <> listing_community or item.ownership_kind <> 'individual'
      or item.listing_status = 'retired' then
    raise exception 'administrator and individual listing required';
  end if;
  insert into public.supply_donation_audit (supply_id, community_id, prior_owner_id, converted_by)
  values (item.id, item.community_id, item.owner_id, caller_id);
  update public.supplies
  set ownership_kind = 'group', owner_id = null, custodian_id = new_custodian_id
  where id = item.id returning * into updated;
  return updated;
end;
$$;


ALTER FUNCTION "public"."convert_individual_donation"("target_supply_id" "uuid", "new_custodian_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_group_supply"("supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_custodian_id" "uuid", "supplied_status" "public"."listing_status", "supplied_condition" "text") RETURNS "public"."supplies"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  caller_community uuid;
  created public.supplies;
begin
  select p.community_id into caller_community from public.profiles p where p.id = caller_id;
  if caller_id is null or caller_community is null then raise exception 'active inventory manager required'; end if;
  perform public.lock_community_authorization(caller_community, false);
  if not public.is_active_inventory_manager(caller_community) then raise exception 'active inventory manager required'; end if;
  if nullif(btrim(supplied_title), '') is null then raise exception 'title is required'; end if;
  if char_length(coalesce(supplied_description, '')) > 1000 then raise exception 'description is limited to 1000 characters'; end if;
  if not public.is_canonical_gear_category(supplied_category) then raise exception 'canonical category required'; end if;
  if not public.is_canonical_gear_condition(supplied_condition) then raise exception 'canonical condition required'; end if;
  if supplied_quantity is null or supplied_quantity <= 0 or supplied_status is null or supplied_status = 'retired' then
    raise exception 'invalid initial listing state';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = supplied_custodian_id
      and p.community_id = caller_community
      and p.membership_status = 'active'
    for update
  ) then raise exception 'active same-community contact required'; end if;

  insert into public.supplies (
    community_id, title, description, category, condition, ownership_kind,
    owner_id, custodian_id, quantity_total, listing_status, created_by
  ) values (
    caller_community, btrim(supplied_title), coalesce(supplied_description, ''),
    supplied_category, supplied_condition, 'group', null, supplied_custodian_id,
    supplied_quantity, supplied_status, caller_id
  ) returning * into created;

  insert into public.supply_condition_history
    (community_id, supply_id, prior_condition, next_condition, changed_by)
  values (created.community_id, created.id, null, created.condition, caller_id);
  return created;
end;
$$;


ALTER FUNCTION "public"."create_group_supply"("supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_custodian_id" "uuid", "supplied_status" "public"."listing_status", "supplied_condition" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_individual_supply"("supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_status" "public"."listing_status", "supplied_condition" "text") RETURNS "public"."supplies"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  caller_community uuid;
  created public.supplies;
begin
  select p.community_id into caller_community from public.profiles p where p.id = caller_id;
  if caller_id is null or caller_community is null then raise exception 'active member required'; end if;
  perform public.lock_community_authorization(caller_community, false);
  if not public.is_active_member(caller_community) then raise exception 'active member required'; end if;
  if nullif(btrim(supplied_title), '') is null then raise exception 'title is required'; end if;
  if char_length(coalesce(supplied_description, '')) > 1000 then raise exception 'description is limited to 1000 characters'; end if;
  if not public.is_canonical_gear_category(supplied_category) then raise exception 'canonical category required'; end if;
  if not public.is_canonical_gear_condition(supplied_condition) then raise exception 'canonical condition required'; end if;
  if supplied_quantity is null or supplied_quantity <= 0 or supplied_status is null or supplied_status = 'retired' then
    raise exception 'invalid initial listing state';
  end if;

  insert into public.supplies (
    community_id, title, description, category, condition, ownership_kind,
    owner_id, custodian_id, quantity_total, listing_status, created_by
  ) values (
    caller_community, btrim(supplied_title), coalesce(supplied_description, ''),
    supplied_category, supplied_condition, 'individual', caller_id, caller_id,
    supplied_quantity, supplied_status, caller_id
  ) returning * into created;

  insert into public.supply_condition_history
    (community_id, supply_id, prior_condition, next_condition, changed_by)
  values (created.community_id, created.id, null, created.condition, caller_id);
  return created;
end;
$$;


ALTER FUNCTION "public"."create_individual_supply"("supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_status" "public"."listing_status", "supplied_condition" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_or_resume_group_draft"("supplied_attempt_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_custodian_id" "uuid", "supplied_condition" "text", "supplied_expected_images" integer) RETURNS "public"."supplies"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  caller_community uuid;
  item public.supplies%rowtype;
begin
  if supplied_attempt_id is null then raise exception 'publication attempt is required'; end if;
  if supplied_expected_images not between 0 and 4 then raise exception 'zero to four photos are allowed'; end if;
  select p.community_id into caller_community from public.profiles p where p.id = caller_id;
  if caller_id is null or caller_community is null or not public.is_active_inventory_manager(caller_community) then
    raise exception 'active inventory manager required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(caller_community::text || ':' || caller_id::text || ':' || supplied_attempt_id::text, 0));
  select * into item from public.supplies s
  where s.community_id = caller_community and s.created_by = caller_id and s.publication_attempt_id = supplied_attempt_id
  for update;
  if found then
    if item.ownership_kind <> 'group' or item.listing_status <> 'unlisted' then raise exception 'publication attempt unavailable'; end if;
    perform public.update_supply(item.id, supplied_title, supplied_description, supplied_category, supplied_quantity, 'unlisted', supplied_condition);
    if supplied_custodian_id is distinct from item.custodian_id then perform public.set_supply_contact(item.id, supplied_custodian_id); end if;
    update public.supplies set publication_expected_images = supplied_expected_images where id = item.id returning * into item;
    return item;
  end if;
  item := public.create_group_supply(supplied_title, supplied_description, supplied_category, supplied_quantity, supplied_custodian_id, 'unlisted', supplied_condition);
  update public.supplies
  set publication_attempt_id = supplied_attempt_id, publication_expected_images = supplied_expected_images
  where id = item.id returning * into item;
  return item;
end;
$$;


ALTER FUNCTION "public"."create_or_resume_group_draft"("supplied_attempt_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_custodian_id" "uuid", "supplied_condition" "text", "supplied_expected_images" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_or_resume_group_draft_with_guidelines"("supplied_attempt_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_custodian_id" "uuid", "supplied_condition" "text", "supplied_expected_images" integer, "supplied_guidelines" "text"[]) RETURNS "public"."supplies"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare item public.supplies; current_rules text[] := '{}'::text[];
begin
  item := public.create_or_resume_group_draft(
    supplied_attempt_id, supplied_title, supplied_description, supplied_category,
    supplied_quantity, supplied_custodian_id, supplied_condition, supplied_expected_images
  );
  if item.guideline_version > 0 then
    select v.rules into strict current_rules from public.supply_guideline_versions v
      where v.supply_id = item.id and v.version = item.guideline_version;
  end if;
  if current_rules <> public.normalize_guideline_rules(supplied_guidelines) then
    perform public.set_supply_guidelines(item.id, item.guideline_version, supplied_guidelines);
  end if;
  select * into strict item from public.supplies s where s.id = item.id;
  return item;
end;
$$;


ALTER FUNCTION "public"."create_or_resume_group_draft_with_guidelines"("supplied_attempt_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_custodian_id" "uuid", "supplied_condition" "text", "supplied_expected_images" integer, "supplied_guidelines" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_or_resume_individual_draft"("supplied_attempt_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_condition" "text", "supplied_expected_images" integer) RETURNS "public"."supplies"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  caller_community uuid;
  item public.supplies%rowtype;
begin
  if supplied_attempt_id is null then raise exception 'publication attempt is required'; end if;
  if supplied_expected_images not between 0 and 4 then raise exception 'zero to four photos are allowed'; end if;
  select p.community_id into caller_community from public.profiles p where p.id = caller_id;
  if caller_id is null or caller_community is null or not public.is_active_member(caller_community) then
    raise exception 'active member required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(caller_community::text || ':' || caller_id::text || ':' || supplied_attempt_id::text, 0));
  select * into item from public.supplies s
  where s.community_id = caller_community and s.created_by = caller_id and s.publication_attempt_id = supplied_attempt_id
  for update;
  if found then
    if item.ownership_kind <> 'individual' or item.owner_id <> caller_id or item.listing_status <> 'unlisted' then
      raise exception 'publication attempt unavailable';
    end if;
    perform public.update_supply(item.id, supplied_title, supplied_description, supplied_category, supplied_quantity, 'unlisted', supplied_condition);
    update public.supplies set publication_expected_images = supplied_expected_images where id = item.id returning * into item;
    return item;
  end if;
  item := public.create_individual_supply(supplied_title, supplied_description, supplied_category, supplied_quantity, 'unlisted', supplied_condition);
  update public.supplies
  set publication_attempt_id = supplied_attempt_id, publication_expected_images = supplied_expected_images
  where id = item.id returning * into item;
  return item;
end;
$$;


ALTER FUNCTION "public"."create_or_resume_individual_draft"("supplied_attempt_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_condition" "text", "supplied_expected_images" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_or_resume_individual_draft_with_guidelines"("supplied_attempt_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_condition" "text", "supplied_expected_images" integer, "supplied_guidelines" "text"[]) RETURNS "public"."supplies"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare item public.supplies; current_rules text[] := '{}'::text[];
begin
  item := public.create_or_resume_individual_draft(
    supplied_attempt_id, supplied_title, supplied_description, supplied_category,
    supplied_quantity, supplied_condition, supplied_expected_images
  );
  if item.guideline_version > 0 then
    select v.rules into strict current_rules from public.supply_guideline_versions v
      where v.supply_id = item.id and v.version = item.guideline_version;
  end if;
  if current_rules <> public.normalize_guideline_rules(supplied_guidelines) then
    perform public.set_supply_guidelines(item.id, item.guideline_version, supplied_guidelines);
  end if;
  select * into strict item from public.supplies s where s.id = item.id;
  return item;
end;
$$;


ALTER FUNCTION "public"."create_or_resume_individual_draft_with_guidelines"("supplied_attempt_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_condition" "text", "supplied_expected_images" integer, "supplied_guidelines" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_wanted_request"("supplied_title" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_start" "date" DEFAULT NULL::"date", "supplied_end" "date" DEFAULT NULL::"date", "supplied_note" "text" DEFAULT NULL::"text") RETURNS "public"."wanted_requests"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  caller_community uuid;
  created public.wanted_requests;
  normalized_title text;
begin
  select p.community_id into caller_community from public.profiles p where p.id = caller_id;
  if caller_id is null or caller_community is null then raise exception 'active member required'; end if;
  perform public.lock_community_authorization(caller_community, false);
  if not public.is_active_member(caller_community) then raise exception 'active member required'; end if;
  normalized_title := regexp_replace(btrim(supplied_title), '[[:space:]]+', ' ', 'g');
  if not public.validate_wanted_fields(
    normalized_title, supplied_category, supplied_quantity,
    supplied_start, supplied_end, nullif(btrim(supplied_note), '')
  ) then raise exception 'invalid wanted request'; end if;
  perform pg_advisory_xact_lock(hashtextextended('wanted-limit:' || caller_community::text || ':' || caller_id::text, 0));
  if (select count(*) from public.wanted_requests r
      where r.community_id = caller_community and r.requester_id = caller_id and r.status = 'open') >= 10 then
    raise exception 'at most ten open wanted requests are allowed';
  end if;
  insert into public.wanted_requests
    (community_id, requester_id, title, category, desired_quantity, desired_start, desired_end, note)
  values (
    caller_community, caller_id, normalized_title, supplied_category,
    supplied_quantity, supplied_start, supplied_end, nullif(btrim(supplied_note), '')
  ) returning * into created;
  perform public.emit_wanted_notification(
    'wanted_request_created', created.id, created.transition_version,
    created.community_id, array[created.requester_id], true
  );
  return created;
end;
$$;


ALTER FUNCTION "public"."create_wanted_request"("supplied_title" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_start" "date", "supplied_end" "date", "supplied_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_access_level"("target_community_id" "uuid") RETURNS "public"."app_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select case
    when not public.is_active_member(target_community_id) then null
    when public.is_active_administrator(target_community_id) then 'steward'::public.app_role
    when public.is_active_custodian(target_community_id) then 'custodian'::public.app_role
    else 'member'::public.app_role
  end
$$;


ALTER FUNCTION "public"."current_access_level"("target_community_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_active_community_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select p.community_id
  from public.profiles p
  where p.id = (select auth.uid())
    and p.membership_status = 'active'
$$;


ALTER FUNCTION "public"."current_active_community_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_join_questions"() RETURNS TABLE("community_name" "text", "version_id" "uuid", "questions" "jsonb")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select c.name, q.id, q.questions
  from public.communities c
  join public.join_question_versions q on q.community_id = c.id and q.is_current
  where c.id = '7b000000-0000-4000-8000-000000000001'::uuid
    and c.join_mode = 'approval_required'::public.community_join_mode
$$;


ALTER FUNCTION "public"."current_join_questions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deactivate_member"("target_user_id" "uuid", "successor_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "lock_timeout" TO '3s'
    SET "statement_timeout" TO '8s'
    AS $$
declare
  caller_id uuid := auth.uid();
  caller_community uuid;
  listing_id uuid;
  prior_access text;
  affected_count bigint;
  cancelled_count bigint;
  checked_out_count bigint;
  next_deactivation_sequence bigint;
begin
  select p.community_id into caller_community from public.profiles p where p.id = caller_id;
  if caller_id is null or caller_community is null then raise exception 'active administrator required'; end if;
  if target_user_id = successor_user_id then raise exception 'replacement contact must be distinct from target'; end if;
  perform public.lock_community_authorization(caller_community, true);
  if not public.is_active_administrator(caller_community) then raise exception 'active administrator required'; end if;
  if not exists (select 1 from public.profiles p where p.id = successor_user_id and p.community_id = caller_community and p.membership_status = 'active' for update)
    then raise exception 'replacement contact must be an active same-community member'; end if;
  if not exists (select 1 from public.profiles p where p.id = target_user_id and p.community_id = caller_community and p.membership_status = 'active' for update)
    then raise exception 'target must be an active same-community member'; end if;
  if exists (select 1 from public.community_roles r where r.community_id = caller_community and r.user_id = target_user_id and r.role = 'steward')
     and (select count(*) from public.community_roles r join public.profiles p on p.id = r.user_id and p.community_id = r.community_id where r.community_id = caller_community and r.role = 'steward' and p.membership_status = 'active') <= 1
    then raise exception 'cannot deactivate the last active administrator'; end if;

  for listing_id in select s.id from public.supplies s where s.community_id = caller_community and (s.custodian_id = target_user_id or (s.ownership_kind = 'individual' and s.owner_id = target_user_id)) order by s.id loop
    perform public.lock_listing(listing_id);
  end loop;
  select case when exists (select 1 from public.community_roles r where r.community_id = caller_community and r.user_id = target_user_id and r.role = 'steward') then 'administrator'
              when exists (select 1 from public.community_roles r where r.community_id = caller_community and r.user_id = target_user_id and r.role = 'custodian') then 'custodian'
              else 'regular' end into prior_access;
  select count(*) into affected_count from public.supplies s where s.community_id = caller_community and (s.custodian_id = target_user_id or (s.ownership_kind = 'individual' and s.owner_id = target_user_id));
  select count(*) filter (where gl.status in ('pending','approved')), count(*) filter (where gl.status = 'checked_out')
  into cancelled_count, checked_out_count
  from public.gear_loans gl join public.supplies s on s.id = gl.supply_id
  where s.community_id = caller_community and s.ownership_kind = 'individual' and s.owner_id = target_user_id;
  select coalesce(max(c.deactivation_sequence), 0) + 1 into next_deactivation_sequence
  from public.membership_deactivation_consequences c where c.profile_id = target_user_id;

  perform set_config('app.milestone_six_internal_change', 'allowed', true);
  insert into public.membership_deactivation_consequences
    (community_id, profile_id, deactivated_by, successor_user_id, prior_access_level,
     affected_listings, cancelled_loans, checked_out_loans, deactivation_sequence)
  values (caller_community, target_user_id, caller_id, successor_user_id, prior_access,
          affected_count, cancelled_count, checked_out_count, next_deactivation_sequence);
  perform set_config('app.milestone_six_internal_change', '', true);

  update public.profiles set membership_status = 'deactivated', deactivated_by = caller_id, deactivated_at = now() where id = target_user_id;
  update public.supplies
  set custodian_id = successor_user_id,
      listing_status = case when ownership_kind = 'individual' and listing_status <> 'retired' then 'unlisted'::public.listing_status else listing_status end
  where community_id = caller_community and (custodian_id = target_user_id or (ownership_kind = 'individual' and owner_id = target_user_id));
  update public.gear_loans gl
  set status = 'cancelled', cancelled_by = caller_id, cancelled_at = now(), cancellation_reason = 'owner membership deactivated'
  from public.supplies s
  where gl.supply_id = s.id and s.community_id = caller_community and s.ownership_kind = 'individual'
    and s.owner_id = target_user_id and gl.status in ('pending', 'approved');
  delete from public.community_roles where community_id = caller_community and user_id = target_user_id;
end;
$$;


ALTER FUNCTION "public"."deactivate_member"("target_user_id" "uuid", "successor_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deactivation_impact"("target_user_id" "uuid", "successor_user_id" "uuid") RETURNS TABLE("affected_listings" bigint, "requests_to_cancel" bigint, "checked_out_loans" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    count(distinct s.id),
    count(distinct gl.id) filter (where s.ownership_kind = 'individual' and gl.status in ('pending', 'approved')),
    count(distinct gl.id) filter (where s.ownership_kind = 'individual' and gl.status = 'checked_out')
  from public.profiles target
  join public.profiles successor on successor.id = successor_user_id
  left join public.supplies s on s.community_id = target.community_id
    and (s.custodian_id = target.id or (s.ownership_kind = 'individual' and s.owner_id = target.id))
  left join public.gear_loans gl on gl.supply_id = s.id
  where target.id = target_user_id
    and target.id <> successor.id
    and target.community_id = public.current_active_community_id()
    and target.membership_status = 'active'
    and successor.community_id = target.community_id
    and successor.membership_status = 'active'
    and public.is_active_administrator(target.community_id)
$$;


ALTER FUNCTION "public"."deactivation_impact"("target_user_id" "uuid", "successor_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decide_membership"("target_user_id" "uuid", "approve" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller_id uuid := auth.uid(); caller_community uuid;
begin
  select p.community_id into caller_community from public.profiles p where p.id = caller_id;
  if caller_community is null then raise exception 'active administrator required'; end if;
  perform public.lock_community_authorization(caller_community, true);
  if not public.is_active_administrator(caller_community) then raise exception 'active administrator required'; end if;
  if approve is null then raise exception 'membership decision is required'; end if;
  if not exists (
    select 1 from public.membership_applications a
    join public.profiles p on p.id = a.applicant_id and p.community_id = a.community_id
    where a.applicant_id = target_user_id and a.community_id = caller_community
      and a.decided_at is null and a.redacted_at is null and p.membership_status = 'pending'
      and a.submitted_at >= now() - interval '90 days'
    for update of a, p
  ) then raise exception 'current pending membership application required'; end if;
  if approve then
    update public.profiles set membership_status = 'active', approved_by = caller_id, approved_at = now()
    where id = target_user_id and community_id = caller_community and membership_status = 'pending';
    insert into public.community_roles (community_id, user_id, role, granted_by)
    values (caller_community, target_user_id, 'member', caller_id) on conflict do nothing;
  else
    update public.profiles set membership_status = 'rejected', rejected_by = caller_id, rejected_at = now()
    where id = target_user_id and community_id = caller_community and membership_status = 'pending';
  end if;
  update public.membership_applications set decided_at = now()
  where applicant_id = target_user_id and decided_at is null;
end;
$$;


ALTER FUNCTION "public"."decide_membership"("target_user_id" "uuid", "approve" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decline_gear_loan"("target_loan_id" "uuid") RETURNS "public"."gear_loans"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare relation_community uuid; relation_supply uuid; request public.gear_loans%rowtype; item public.supplies%rowtype; updated public.gear_loans;
begin
  select gl.community_id, gl.supply_id into relation_community, relation_supply from public.gear_loans gl where gl.id = target_loan_id;
  if not found then raise exception 'pending request and current authorized manager required'; end if;
  perform public.lock_community_authorization(relation_community, false);
  perform public.lock_listing(relation_supply);
  select * into request from public.gear_loans where id = target_loan_id for update;
  select * into item from public.supplies where id = relation_supply for update;
  if request.status <> 'pending' or item.id is null or request.supply_id <> item.id
      or not public.loan_manager_authorized(item, 'decline') then raise exception 'pending request and current authorized manager required'; end if;
  update public.gear_loans set status = 'declined', decided_by = auth.uid(), decided_at = now()
  where id = request.id returning * into updated;
  return updated;
end;
$$;


ALTER FUNCTION "public"."decline_gear_loan"("target_loan_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dismiss_my_notification"("target_notification_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller_id uuid := auth.uid(); caller_community uuid := public.current_active_community_id();
begin
  if caller_id is null or caller_community is null then raise exception 'active member required'; end if;
  perform set_config('app.notification_internal_change', 'allowed', true);
  update public.private_notifications n
  set dismissed_at = coalesce(n.dismissed_at, clock_timestamp()),
      read_at = coalesce(n.read_at, clock_timestamp())
  where n.id = target_notification_id and n.recipient_user_id = caller_id
    and n.community_id = caller_community;
  if not found then
    perform set_config('app.notification_internal_change', '', true);
    raise exception 'notification unavailable';
  end if;
  perform set_config('app.notification_internal_change', '', true);
end;
$$;


ALTER FUNCTION "public"."dismiss_my_notification"("target_notification_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."emit_notification_to_active_administrators"("supplied_event_type" "text", "supplied_authoritative_record_id" "text", "supplied_transition_version" bigint, "supplied_community_id" "uuid", "supplied_payload" "jsonb" DEFAULT '{"schema_version": 1}'::"jsonb", "supplied_occurred_at" timestamp with time zone DEFAULT "clock_timestamp"()) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare recipient uuid; emitted integer := 0;
begin
  for recipient in
    select distinct p.id
    from public.profiles p
    join public.community_roles r
      on r.community_id = p.community_id and r.user_id = p.id and r.role = 'steward'
    where p.community_id = supplied_community_id and p.membership_status = 'active'
    order by p.id
  loop
    perform public.emit_private_notification(
      supplied_event_type, supplied_authoritative_record_id,
      supplied_transition_version, supplied_community_id, recipient,
      supplied_payload, supplied_occurred_at
    );
    emitted := emitted + 1;
  end loop;
  return emitted;
end;
$$;


ALTER FUNCTION "public"."emit_notification_to_active_administrators"("supplied_event_type" "text", "supplied_authoritative_record_id" "text", "supplied_transition_version" bigint, "supplied_community_id" "uuid", "supplied_payload" "jsonb", "supplied_occurred_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."emit_private_notification"("supplied_event_type" "text", "supplied_authoritative_record_id" "text", "supplied_transition_version" bigint, "supplied_community_id" "uuid", "supplied_recipient_user_id" "uuid", "supplied_payload" "jsonb" DEFAULT '{"schema_version": 1}'::"jsonb", "supplied_occurred_at" timestamp with time zone DEFAULT "clock_timestamp"()) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  registry public.notification_event_registry%rowtype;
  notification_id uuid;
  recipient_email text;
  initial_status text;
  preference_enabled boolean := true;
begin
  select * into registry from public.notification_event_registry r
  where r.event_type = supplied_event_type;
  if not found then raise exception 'registered notification event required'; end if;
  if supplied_authoritative_record_id is null
    or length(supplied_authoritative_record_id) not between 1 and 80
    or supplied_transition_version is null or supplied_transition_version <= 0
    or supplied_occurred_at is null
    or not public.valid_notification_payload(supplied_event_type, supplied_payload) then
    raise exception 'bounded registered notification payload required';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = supplied_recipient_user_id and p.community_id = supplied_community_id
  ) then raise exception 'same-community notification recipient required'; end if;

  insert into public.private_notifications (
    community_id, recipient_user_id, event_type, authoritative_record_id,
    transition_version, title, body, app_route, occurred_at
  ) values (
    supplied_community_id, supplied_recipient_user_id, supplied_event_type,
    supplied_authoritative_record_id, supplied_transition_version,
    registry.in_app_title, registry.in_app_body, registry.app_route, supplied_occurred_at
  ) on conflict (event_type, authoritative_record_id, transition_version, recipient_user_id)
    do nothing
  returning id into notification_id;
  if notification_id is null then
    select n.id into notification_id from public.private_notifications n
    where n.event_type = supplied_event_type
      and n.authoritative_record_id = supplied_authoritative_record_id
      and n.transition_version = supplied_transition_version
      and n.recipient_user_id = supplied_recipient_user_id;
    return notification_id;
  end if;

  if not registry.email_enabled then return notification_id; end if;

  select lower(btrim(u.email::text)) into recipient_email
  from auth.users u
  where u.id = supplied_recipient_user_id and u.email_confirmed_at is not null
    and u.email is not null and length(btrim(u.email::text)) between 3 and 254;

  if registry.category = 'loan_activity' then
    select coalesce(p.loan_activity, true) into preference_enabled
    from public.transactional_email_preferences p
    where p.profile_id = supplied_recipient_user_id and p.community_id = supplied_community_id;
    preference_enabled := coalesce(preference_enabled, true);
  elsif registry.category = 'loan_reminders' then
    select coalesce(p.loan_reminders, true) into preference_enabled
    from public.transactional_email_preferences p
    where p.profile_id = supplied_recipient_user_id and p.community_id = supplied_community_id;
    preference_enabled := coalesce(preference_enabled, true);
  elsif registry.category = 'wanted_activity' then
    select coalesce(p.wanted_activity, true) into preference_enabled
    from public.transactional_email_preferences p
    where p.profile_id = supplied_recipient_user_id and p.community_id = supplied_community_id;
    preference_enabled := coalesce(preference_enabled, true);
  end if;

  if recipient_email is null then
    initial_status := 'permanent_failure';
  elsif exists (
    select 1 from public.transactional_email_suppressions s
    where s.recipient_user_id = supplied_recipient_user_id
      and s.normalized_email = recipient_email and s.cleared_at is null
  ) then
    initial_status := 'address_suppressed';
  elsif not registry.email_required and not preference_enabled then
    initial_status := 'preference_suppressed';
  else
    initial_status := 'pending';
  end if;

  insert into public.transactional_email_outbox (
    notification_id, community_id, recipient_user_id, event_type,
    authoritative_record_id, transition_version, payload, email_snapshot,
    delivery_tag, status, next_attempt_at, terminal_at
  ) values (
    notification_id, supplied_community_id, supplied_recipient_user_id,
    supplied_event_type, supplied_authoritative_record_id,
    supplied_transition_version, supplied_payload, recipient_email,
    gen_random_uuid(), initial_status,
    case when initial_status = 'pending' then clock_timestamp() else null end,
    case when initial_status = 'pending' then null else clock_timestamp() end
  ) on conflict (event_type, authoritative_record_id, transition_version, recipient_user_id)
    do nothing;
  return notification_id;
end;
$$;


ALTER FUNCTION "public"."emit_private_notification"("supplied_event_type" "text", "supplied_authoritative_record_id" "text", "supplied_transition_version" bigint, "supplied_community_id" "uuid", "supplied_recipient_user_id" "uuid", "supplied_payload" "jsonb", "supplied_occurred_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."emit_wanted_notification"("supplied_event" "text", "supplied_record_id" "uuid", "supplied_version" bigint, "supplied_community_id" "uuid", "supplied_participants" "uuid"[], "supplied_include_administrators" boolean DEFAULT false) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare recipient uuid;
begin
  for recipient in
    select distinct candidate from (
      select unnest(coalesce(supplied_participants, '{}'::uuid[])) candidate
      union all
      select r.user_id from public.community_roles r
      join public.profiles p on p.id = r.user_id and p.community_id = r.community_id
      where supplied_include_administrators and r.community_id = supplied_community_id
        and r.role = 'steward' and p.membership_status = 'active'
    ) recipients
    where candidate is not null
    order by candidate
  loop
    perform public.emit_private_notification(
      supplied_event, supplied_record_id::text, supplied_version,
      supplied_community_id, recipient, '{"schema_version":1}'::jsonb
    );
  end loop;
end;
$$;


ALTER FUNCTION "public"."emit_wanted_notification"("supplied_event" "text", "supplied_record_id" "uuid", "supplied_version" bigint, "supplied_community_id" "uuid", "supplied_participants" "uuid"[], "supplied_include_administrators" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_recoverable_draft_publication"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if old.publication_attempt_id is not null
     and old.listing_status = 'unlisted'
     and new.listing_status = 'listed'
     and current_setting('app.authorized_draft_publication', true) is distinct from 'on' then
    raise exception 'recoverable draft must use publication finalization';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_recoverable_draft_publication"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_due_loan_reminders"("supplied_run_at" timestamp with time zone DEFAULT "clock_timestamp"(), "batch_limit" integer DEFAULT 100) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "lock_timeout" TO '5s'
    SET "statement_timeout" TO '45s'
    AS $$
declare
  candidate record;
  loan public.gear_loans%rowtype;
  policy public.loan_reminder_policies%rowtype;
  due_instant timestamptz;
  selected_kind text;
  selected_ordinal smallint;
  last_overdue_at timestamptz;
  prior_first boolean;
  prior_weekly smallint;
  recipient uuid;
  inserted integer := 0;
  changed integer;
begin
  if supplied_run_at is null or batch_limit is null or batch_limit not between 1 and 500 then
    raise exception 'bounded reminder run required';
  end if;
  for candidate in
    select gl.id, gl.community_id, gl.supply_id
    from public.gear_loans gl
    join public.loan_reminder_policies p on p.community_id = gl.community_id and p.enabled
    join pg_catalog.pg_timezone_names z on z.name = p.time_zone
    cross join lateral (
      select
        ((gl.end_date + 1)::timestamp at time zone p.time_zone) as due_at,
        coalesce(bool_or(e.reminder_kind = 'due_soon'), false) as due_soon_sent,
        coalesce(bool_or(e.reminder_kind = 'first_overdue'), false) as first_overdue_sent,
        coalesce(max(e.ordinal) filter (where e.reminder_kind = 'weekly_overdue'), 0)::smallint
          as weekly_overdue_sent,
        max(e.occurred_at) filter (
          where e.reminder_kind in ('first_overdue', 'weekly_overdue')
        ) as last_overdue_at
      from public.loan_reminder_events e
      where e.loan_id = gl.id
        and e.end_date = gl.end_date
        and e.time_zone = p.time_zone
        and e.policy_version = p.policy_version
    ) reminder_state
    where gl.status = 'checked_out'
      and p.reviewed_at <= supplied_run_at
      and (
        (
          supplied_run_at < reminder_state.due_at
          and supplied_run_at >= reminder_state.due_at - interval '48 hours'
          and not reminder_state.due_soon_sent
        )
        or (
          supplied_run_at >= reminder_state.due_at
          and (
            not reminder_state.first_overdue_sent
            or (
              reminder_state.weekly_overdue_sent < 3
              and supplied_run_at >= reminder_state.due_at
                + ((reminder_state.weekly_overdue_sent + 1) * interval '7 days')
              and supplied_run_at >= reminder_state.last_overdue_at + interval '7 days'
            )
          )
        )
      )
    order by reminder_state.due_at, gl.id
    limit batch_limit
  loop
    perform public.lock_community_authorization(candidate.community_id, false);
    perform public.lock_listing(candidate.supply_id);
    select * into loan from public.gear_loans gl where gl.id = candidate.id for update;
    select * into policy from public.loan_reminder_policies p where p.community_id = candidate.community_id;
    if loan.status <> 'checked_out' or not policy.enabled
      or policy.reviewed_at > supplied_run_at
      or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = policy.time_zone) then
      continue;
    end if;
    due_instant := ((loan.end_date + 1)::timestamp at time zone policy.time_zone);
    selected_kind := null;
    selected_ordinal := 0;
    if supplied_run_at < due_instant and supplied_run_at >= due_instant - interval '48 hours'
      and not exists (
        select 1 from public.loan_reminder_events e
        where e.loan_id = loan.id and e.end_date = loan.end_date
          and e.time_zone = policy.time_zone and e.policy_version = policy.policy_version
          and e.reminder_kind = 'due_soon'
      ) then
      selected_kind := 'due_soon';
    elsif supplied_run_at >= due_instant then
      select exists (
        select 1 from public.loan_reminder_events e
        where e.loan_id = loan.id and e.end_date = loan.end_date
          and e.time_zone = policy.time_zone and e.policy_version = policy.policy_version
          and e.reminder_kind = 'first_overdue'
      ), coalesce(max(e.ordinal) filter (where e.reminder_kind = 'weekly_overdue'), 0)::smallint,
         max(e.occurred_at) filter (where e.reminder_kind in ('first_overdue', 'weekly_overdue'))
      into prior_first, prior_weekly, last_overdue_at
      from public.loan_reminder_events e
      where e.loan_id = loan.id and e.end_date = loan.end_date
        and e.time_zone = policy.time_zone and e.policy_version = policy.policy_version;
      if not prior_first then
        selected_kind := 'first_overdue';
      elsif prior_weekly < 3
        and supplied_run_at >= due_instant + ((prior_weekly + 1) * interval '7 days')
        and supplied_run_at >= last_overdue_at + interval '7 days' then
        selected_kind := 'weekly_overdue';
        selected_ordinal := prior_weekly + 1;
      end if;
    end if;
    if selected_kind is null then continue; end if;
    for recipient in
      select distinct recipients.id
      from (
        select p.id from public.profiles p
        where p.id = loan.borrower_id and p.community_id = loan.community_id
          and p.membership_status = 'active'
        union all
        select p.id from public.profiles p
        join public.supplies s on s.id = loan.supply_id and s.community_id = loan.community_id
        where p.id = loan.handoff_contact_id and p.community_id = loan.community_id
          and p.membership_status = 'active'
          and (
            (s.ownership_kind = 'individual' and p.id = s.owner_id)
            or (s.ownership_kind = 'group' and public.valid_group_handoff(loan.community_id, p.id))
          )
      ) recipients
    loop
      insert into public.loan_reminder_events
        (community_id, loan_id, recipient_user_id, reminder_kind, ordinal,
         end_date, time_zone, policy_version, due_at, occurred_at)
      values
        (loan.community_id, loan.id, recipient, selected_kind, selected_ordinal,
         loan.end_date, policy.time_zone, policy.policy_version, due_instant, supplied_run_at)
      on conflict do nothing;
      get diagnostics changed = row_count;
      inserted := inserted + changed;
    end loop;
  end loop;
  return inserted;
end;
$$;


ALTER FUNCTION "public"."enqueue_due_loan_reminders"("supplied_run_at" timestamp with time zone, "batch_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_stale_ai_draft_attempts"("supplied_limit" integer DEFAULT 100) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare changed integer;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'service role required'; end if;
  if supplied_limit is null or supplied_limit not between 1 and 100 then
    raise exception 'bounded reconciliation batch required';
  end if;
  perform set_config('app.ai_attempt_internal', 'allowed', true);
  with stale as (
    select a.id
    from public.ai_draft_attempts a
    where a.status in ('reserved','provider_inflight')
      and a.created_at <= clock_timestamp() - interval '15 minutes'
    order by a.created_at, a.id
    for update skip locked
    limit supplied_limit
  )
  update public.ai_draft_attempts a
  set status = case when a.status = 'provider_inflight'
      then 'unknown_usage'::public.ai_draft_attempt_status
      else 'failed'::public.ai_draft_attempt_status end,
    usage_recognized = false,
    failure_kind = 'reconciliation',
    completed_at = clock_timestamp()
  from stale where a.id = stale.id;
  get diagnostics changed = row_count;
  perform set_config('app.ai_attempt_internal', '', true);
  return changed;
end;
$$;


ALTER FUNCTION "public"."expire_stale_ai_draft_attempts"("supplied_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_ai_drafting_availability"() RETURNS TABLE("available" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare caller_community uuid := public.current_active_community_id();
begin
  if caller_community is null then raise exception 'active member required'; end if;
  return query
  select coalesce(s.ai_drafting_enabled, false) and coalesce((
    select e.recorded_at <= clock_timestamp() and p.observed_at <= clock_timestamp()
      and e.expires_at > clock_timestamp() and p.expires_at > clock_timestamp()
      and e.model = 'gpt-5.6-luna' and e.service_tier = 'standard'
      and e.model_access_confirmed and e.secret_present
      and e.image_input_supported and e.structured_output_supported
      and e.data_controls_reviewed and e.dashboard_price_confirmed
      and e.evaluation_set_version = 'm8-v1' and e.evaluation_passed
      and e.evaluation_manifest_sha256 ~ '^[0-9a-f]{64}$'
      and e.evaluation_scores_sha256 ~ '^[0-9a-f]{64}$'
      and e.reviewer_one_passed and e.reviewer_two_passed and e.overall_approved
    from public.ai_activation_evidence e
    join public.ai_model_price_snapshots p on p.id = e.price_snapshot_id
    where e.community_id = caller_community
    order by e.recorded_at desc, e.id desc limit 1
  ), false)
  from public.community_settings s where s.community_id = caller_community;
end;
$_$;


ALTER FUNCTION "public"."get_ai_drafting_availability"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_administrator_orientation"() RETURNS TABLE("registry_version" integer, "item_id" "text", "label" "text", "help_text" "text", "route_id" "text", "display_order" smallint, "required" boolean, "applicable_role" "text", "status" "text", "changed_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    SET "statement_timeout" TO '3s'
    AS $$
declare
  caller_id uuid := auth.uid();
  caller_community uuid := public.current_active_community_id();
  current_registry integer;
begin
  if caller_id is null or caller_community is null or not public.is_active_administrator(caller_community) then raise exception 'active administrator required'; end if;
  select max(r.registry_version) into current_registry from public.administrator_orientation_registry r;
  return query select r.registry_version, r.item_id, r.label, r.help_text, r.route_id,
    r.display_order, r.required, r.applicable_role, p.status, p.changed_at
  from public.administrator_orientation_registry r
  left join public.administrator_orientation_progress p
    on p.community_id = caller_community and p.administrator_id = caller_id
   and p.registry_version = r.registry_version and p.item_id = r.item_id
  where r.registry_version = current_registry order by r.display_order;
end;
$$;


ALTER FUNCTION "public"."get_my_administrator_orientation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_community_settings"() RETURNS TABLE("community_id" "uuid", "display_name" "text", "configuration_version" bigint, "ai_drafting_enabled" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    SET "statement_timeout" TO '3s'
    AS $$
declare
  caller_community uuid := public.current_active_community_id();
begin
  if caller_community is null then raise exception 'active member required'; end if;
  return query select s.community_id, s.display_name, s.current_version, coalesce(s.ai_drafting_enabled, false)
  from public.community_settings s where s.community_id = caller_community;
end;
$$;


ALTER FUNCTION "public"."get_my_community_settings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_postal_code"() RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  caller_community uuid := public.current_active_community_id();
  result text;
begin
  if caller_id is null or caller_community is null then
    raise exception 'active member required';
  end if;
  select postal.postal_code into result
  from public.member_postal_codes postal
  where postal.community_id = caller_community
    and postal.profile_id = caller_id;
  return result;
end;
$$;


ALTER FUNCTION "public"."get_my_postal_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_profile_settings"() RETURNS TABLE("display_name" "text", "introduction" "text", "phone_e164" "text", "coordination_note" "text", "confirmed_email" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller_id uuid := auth.uid(); caller_community uuid := public.current_active_community_id();
begin
  if caller_id is null or caller_community is null then raise exception 'active member required'; end if;
  return query select p.display_name, s.introduction, s.phone_e164, s.coordination_note,
    case when u.email_confirmed_at is not null then u.email::text else null end
  from public.profiles p join auth.users u on u.id = p.id
  left join public.member_profile_settings s on s.profile_id = p.id and s.community_id = p.community_id
  where p.id = caller_id and p.community_id = caller_community;
end;
$$;


ALTER FUNCTION "public"."get_my_profile_settings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_transactional_email_preferences"() RETURNS TABLE("loan_activity" boolean, "loan_reminders" boolean, "wanted_activity" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller_id uuid := auth.uid(); caller_community uuid := public.current_active_community_id();
begin
  if caller_id is null or caller_community is null then raise exception 'active member required'; end if;
  return query
  select coalesce(p.loan_activity, true), coalesce(p.loan_reminders, true), coalesce(p.wanted_activity, true)
  from (select 1) seed
  left join public.transactional_email_preferences p
    on p.profile_id = caller_id and p.community_id = caller_community;
end;
$$;


ALTER FUNCTION "public"."get_my_transactional_email_preferences"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  target_community uuid;
  supplied_name text;
begin
  select c.id into target_community from public.communities c
  where c.id = '7b000000-0000-4000-8000-000000000001'::uuid;
  if target_community is null then raise exception 'target community has not been seeded'; end if;
  supplied_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  if supplied_name is null then supplied_name := 'Pending member'; end if;
  if supplied_name ~ '[[:cntrl:]]' then raise exception 'invalid display name'; end if;
  supplied_name := regexp_replace(supplied_name, '[[:space:]]+', ' ', 'g');
  if not public.valid_plain_text(supplied_name, 80) then raise exception 'invalid display name'; end if;
  insert into public.profiles (id, community_id, display_name)
  values (new.id, target_community, supplied_name);

  insert into public.join_question_versions (community_id, version, questions, published_by)
  values (target_community, 1, '[]'::jsonb, null)
  on conflict (community_id, version) do nothing;

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."invalidate_wanted_offers_for_supply"("target_supply_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare offered public.wanted_offers%rowtype; req public.wanted_requests%rowtype;
begin
  for offered in
    update public.wanted_offers set status = 'invalidated', transition_version = transition_version + 1,
      updated_at = clock_timestamp()
    where supply_id = target_supply_id and status in ('active','selected')
    returning *
  loop
    select * into req from public.wanted_requests r where r.id = offered.request_id for update;
    if req.status = 'fulfilled' and req.selected_offer_id = offered.id then
      update public.wanted_requests set status = 'open', selected_offer_id = null,
        transition_version = transition_version + 1, updated_at = clock_timestamp()
      where id = req.id returning * into req;
    end if;
    perform public.emit_wanted_notification('wanted_offer_invalidated', offered.id, offered.transition_version,
      offered.community_id, array[req.requester_id, offered.offerer_id], false);
  end loop;
end;
$$;


ALTER FUNCTION "public"."invalidate_wanted_offers_for_supply"("target_supply_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_active_administrator"("target_community_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.profiles p
    join public.community_roles r
      on r.community_id = p.community_id and r.user_id = p.id
    where p.id = (select auth.uid())
      and p.community_id = target_community_id
      and p.membership_status = 'active'
      and r.role = 'steward'
  )
$$;


ALTER FUNCTION "public"."is_active_administrator"("target_community_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_active_custodian"("target_community_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.profiles p
    join public.community_roles r
      on r.community_id = p.community_id and r.user_id = p.id
    where p.id = (select auth.uid())
      and p.community_id = target_community_id
      and p.membership_status = 'active'
      and r.role = 'custodian'
  )
$$;


ALTER FUNCTION "public"."is_active_custodian"("target_community_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_active_inventory_manager"("target_community_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select public.is_active_administrator(target_community_id)
      or public.is_active_custodian(target_community_id)
$$;


ALTER FUNCTION "public"."is_active_inventory_manager"("target_community_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_active_member"("target_community_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.community_id = target_community_id
      and p.membership_status = 'active'
  )
$$;


ALTER FUNCTION "public"."is_active_member"("target_community_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_active_steward"("target_community_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select public.is_active_administrator(target_community_id)
$$;


ALTER FUNCTION "public"."is_active_steward"("target_community_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loan_contact_details"("target_loan_id" "uuid") RETURNS TABLE("display_name" "text", "email" "text", "phone_e164" "text", "coordination_note" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller_id uuid := auth.uid(); loan public.gear_loans%rowtype; counterpart uuid;
  item public.supplies%rowtype;
begin
  select * into loan from public.gear_loans gl where gl.id = target_loan_id;
  if caller_id is null or loan.id is null or loan.status not in ('approved', 'checked_out')
    or not public.is_active_member(loan.community_id) then return; end if;
  if caller_id = loan.borrower_id then counterpart := loan.handoff_contact_id;
  elsif caller_id = loan.handoff_contact_id then counterpart := loan.borrower_id;
  else return; end if;
  select * into item from public.supplies s where s.id = loan.supply_id and s.community_id = loan.community_id;
  if item.id is null or loan.handoff_contact_id is null then return; end if;
  if item.ownership_kind = 'individual' and loan.handoff_contact_id is distinct from item.owner_id then return; end if;
  if item.ownership_kind = 'group' and not exists (
    select 1 from public.profiles p join public.community_roles r
      on r.community_id = p.community_id and r.user_id = p.id
    where p.id = loan.handoff_contact_id and p.community_id = loan.community_id
      and p.membership_status = 'active' and r.role in ('custodian', 'steward')
  ) then return; end if;
  if not exists (select 1 from public.profiles p where p.id = counterpart
    and p.community_id = loan.community_id and p.membership_status = 'active') then return; end if;
  return query select p.display_name,
    case when u.email_confirmed_at is not null then u.email::text else null end,
    s.phone_e164, s.coordination_note
  from public.profiles p join auth.users u on u.id = p.id
  left join public.member_profile_settings s on s.profile_id = p.id
  where p.id = counterpart;
end;
$$;


ALTER FUNCTION "public"."loan_contact_details"("target_loan_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."loan_manager_authorized"("item" "public"."supplies", "operation" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  owner_is_active boolean;
begin
  if auth.uid() is null or not public.is_active_member(item.community_id) then return false; end if;
  if item.ownership_kind = 'group' then
    return public.is_active_inventory_manager(item.community_id);
  end if;
  select p.membership_status = 'active' into owner_is_active from public.profiles p where p.id = item.owner_id;
  if coalesce(owner_is_active, false) then
    return item.owner_id = auth.uid();
  end if;
  return operation = 'return' and public.is_active_administrator(item.community_id);
end;
$$;


ALTER FUNCTION "public"."loan_manager_authorized"("item" "public"."supplies", "operation" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lock_community_authorization"("target_community_id" "uuid", "exclusive_lock" boolean DEFAULT false) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if exclusive_lock then
    perform 1 from public.communities c where c.id = target_community_id for update;
  else
    perform 1 from public.communities c where c.id = target_community_id for key share;
  end if;
  if not found then raise exception 'community not found'; end if;
end;
$$;


ALTER FUNCTION "public"."lock_community_authorization"("target_community_id" "uuid", "exclusive_lock" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lock_listing"("target_supply_id" "uuid") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select pg_advisory_xact_lock(hashtextextended(target_supply_id::text, 7342))
$$;


ALTER FUNCTION "public"."lock_listing"("target_supply_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_ai_drafting_provider_started"("supplied_attempt_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare item public.ai_draft_attempts%rowtype;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'service role required'; end if;
  select * into item from public.ai_draft_attempts a where a.id = supplied_attempt_id for update;
  if not found or item.status <> 'reserved' then raise exception 'reserved AI attempt required'; end if;
  perform set_config('app.ai_attempt_internal','allowed',true);
  update public.ai_draft_attempts set status='provider_inflight' where id=supplied_attempt_id;
  perform set_config('app.ai_attempt_internal','',true);
end;
$$;


ALTER FUNCTION "public"."mark_ai_drafting_provider_started"("supplied_attempt_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."max_committed_quantity"("target_supply_id" "uuid", "range_start" "date", "range_end" "date", "excluded_loan_id" "uuid" DEFAULT NULL::"uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with commitments as (
    select
      greatest(gl.start_date, range_start) as event_date,
      gl.quantity as delta
    from public.gear_loans gl
    where gl.supply_id = target_supply_id
      and gl.status in ('approved', 'checked_out')
      and gl.start_date <= range_end
      and gl.end_date >= range_start
      and (excluded_loan_id is null or gl.id <> excluded_loan_id)
    union all
    select
      gl.end_date + 1 as event_date,
      -gl.quantity as delta
    from public.gear_loans gl
    where gl.supply_id = target_supply_id
      and gl.status in ('approved', 'checked_out')
      and gl.start_date <= range_end
      and gl.end_date >= range_start
      and gl.end_date < range_end
      and (excluded_loan_id is null or gl.id <> excluded_loan_id)
  ), grouped as (
    select event_date, sum(delta)::integer as delta
    from commitments
    group by event_date
  ), running as (
    select sum(delta) over (order by event_date rows unbounded preceding)::integer as committed
    from grouped
  )
  select coalesce(max(committed), 0) from running
$$;


ALTER FUNCTION "public"."max_committed_quantity"("target_supply_id" "uuid", "range_start" "date", "range_end" "date", "excluded_loan_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."moderate_wanted_request"("target_request_id" "uuid", "supplied_expected_version" bigint, "supplied_reason" "text") RETURNS "public"."wanted_requests"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare req public.wanted_requests%rowtype; prior public.wanted_request_status;
  invalidated public.wanted_offers%rowtype;
begin
  select * into req from public.wanted_requests r where r.id = target_request_id;
  if not found then raise exception 'wanted request unavailable'; end if;
  perform public.lock_community_authorization(req.community_id, true);
  select * into req from public.wanted_requests r where r.id = target_request_id for update;
  if not public.is_active_administrator(req.community_id) or req.status = 'moderated'
    or req.transition_version is distinct from supplied_expected_version
    or not public.valid_plain_text(btrim(supplied_reason), 500, false) then
    raise exception 'moderatable request and reason required';
  end if;
  prior := req.status;
  for invalidated in
    update public.wanted_offers set status = 'invalidated', transition_version = transition_version + 1,
      updated_at = clock_timestamp()
    where request_id = req.id and status in ('active','selected')
    returning *
  loop
    perform public.emit_wanted_notification('wanted_offer_invalidated', invalidated.id, invalidated.transition_version,
      invalidated.community_id, array[req.requester_id, invalidated.offerer_id], false);
  end loop;
  update public.wanted_requests set status = 'moderated', closure_kind = null, selected_offer_id = null,
    transition_version = transition_version + 1, updated_at = clock_timestamp()
    where id = req.id returning * into req;
  insert into public.wanted_request_moderation_audit
    (community_id, request_id, prior_status, next_status, reason, actor_user_id)
  values (req.community_id, req.id, prior, 'moderated', btrim(supplied_reason), auth.uid());
  perform public.emit_wanted_notification('wanted_request_moderated', req.id, req.transition_version,
    req.community_id, array[req.requester_id], true);
  return req;
end;
$$;


ALTER FUNCTION "public"."moderate_wanted_request"("target_request_id" "uuid", "supplied_expected_version" bigint, "supplied_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_loan_reminders"() RETURNS TABLE("id" "uuid", "loan_id" "uuid", "supply_title" "text", "reminder_kind" "text", "ordinal" smallint, "end_date" "date", "due_at" timestamp with time zone, "occurred_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select e.id, e.loan_id, s.title, e.reminder_kind, e.ordinal,
    e.end_date, e.due_at, e.occurred_at
  from public.loan_reminder_events e
  join public.gear_loans gl on gl.id = e.loan_id and gl.community_id = e.community_id
  join public.supplies s on s.id = gl.supply_id and s.community_id = gl.community_id
  where e.recipient_user_id = auth.uid()
    and e.community_id = public.current_active_community_id()
  order by e.occurred_at desc, e.id desc
  limit 30
$$;


ALTER FUNCTION "public"."my_loan_reminders"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_membership_application"() RETURNS TABLE("submitted_at" timestamp with time zone, "answer_snapshot" "jsonb")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select a.submitted_at, a.answer_snapshot
  from public.membership_applications a
  join public.profiles p on p.id = a.applicant_id and p.community_id = a.community_id
  where a.applicant_id = auth.uid() and p.membership_status = 'pending'
    and a.decided_at is null and a.redacted_at is null
    and a.submitted_at >= now() - interval '90 days'
$$;


ALTER FUNCTION "public"."my_membership_application"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_private_notifications"("before_occurred_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "before_notification_id" "uuid" DEFAULT NULL::"uuid", "page_limit" integer DEFAULT 30) RETURNS TABLE("id" "uuid", "event_type" "text", "title" "text", "body" "text", "app_route" "text", "occurred_at" timestamp with time zone, "read_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller_id uuid := auth.uid(); caller_community uuid := public.current_active_community_id();
begin
  if caller_id is null or caller_community is null then raise exception 'active member required'; end if;
  if page_limit is null or page_limit not between 1 and 30
    or ((before_occurred_at is null) <> (before_notification_id is null)) then
    raise exception 'bounded notification cursor required';
  end if;
  return query
  select n.id, n.event_type, n.title, n.body, n.app_route, n.occurred_at, n.read_at
  from public.private_notifications n
  where n.recipient_user_id = caller_id and n.community_id = caller_community
    and n.dismissed_at is null
    and (before_occurred_at is null or (n.occurred_at, n.id) < (before_occurred_at, before_notification_id))
  order by n.occurred_at desc, n.id desc
  limit page_limit;
end;
$$;


ALTER FUNCTION "public"."my_private_notifications"("before_occurred_at" timestamp with time zone, "before_notification_id" "uuid", "page_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_guideline_rules"("supplied_rules" "text"[]) RETURNS "text"[]
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare
  normalized text[] := '{}'::text[];
  item text;
  total_length integer := 0;
begin
  if supplied_rules is null or cardinality(supplied_rules) > 8 then
    raise exception 'zero to eight borrowing guidelines are required';
  end if;
  foreach item in array supplied_rules loop
    item := regexp_replace(btrim(item), '[[:space:]]+', ' ', 'g');
    if not public.valid_plain_text(item, 200, false) then
      raise exception 'invalid borrowing guideline';
    end if;
    if exists (select 1 from unnest(normalized) prior where lower(prior) = lower(item)) then
      raise exception 'borrowing guidelines must be unique';
    end if;
    normalized := array_append(normalized, item);
    total_length := total_length + length(item);
  end loop;
  if total_length > 1200 then raise exception 'borrowing guidelines exceed total length'; end if;
  return normalized;
end;
$$;


ALTER FUNCTION "public"."normalize_guideline_rules"("supplied_rules" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_postal_code"("value" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO ''
    AS $$
  select case
    when value is null or btrim(value) = '' then null
    else regexp_replace(upper(btrim(value)), '[[:space:]]+', ' ', 'g')
  end
$$;


ALTER FUNCTION "public"."normalize_postal_code"("value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_loan_reminder_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare event_name text; payload jsonb := '{"schema_version":1}'::jsonb;
begin
  event_name := case new.reminder_kind
    when 'due_soon' then 'loan_due_soon'
    when 'first_overdue' then 'loan_first_overdue'
    when 'weekly_overdue' then 'loan_weekly_overdue'
    else null
  end;
  if event_name is null then raise exception 'registered reminder kind required'; end if;
  if new.reminder_kind = 'weekly_overdue' then
    payload := jsonb_build_object('schema_version', 1, 'reminder_ordinal', new.ordinal);
  end if;
  perform public.emit_private_notification(
    event_name, new.id::text, 1, new.community_id, new.recipient_user_id,
    payload, new.occurred_at
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."notify_loan_reminder_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_loan_transition"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  event_name text;
  occurred timestamptz := clock_timestamp();
  version bigint := txid_current();
  recipient uuid;
  item public.supplies%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then return new; end if;
    event_name := 'loan_requested';
    occurred := new.created_at;
  else
    if new.status is not distinct from old.status then return new; end if;
    event_name := case new.status
      when 'approved' then 'loan_approved'
      when 'declined' then 'loan_declined'
      when 'checked_out' then 'loan_checked_out'
      when 'cancelled' then 'loan_cancelled'
      when 'returned' then 'loan_returned'
      else null
    end;
    if event_name is null then return new; end if;
    occurred := case new.status
      when 'approved' then coalesce(new.decided_at, occurred)
      when 'declined' then coalesce(new.decided_at, occurred)
      when 'checked_out' then coalesce(new.checked_out_at, occurred)
      when 'cancelled' then coalesce(new.cancelled_at, occurred)
      when 'returned' then coalesce(new.returned_at, occurred)
      else occurred
    end;
  end if;

  perform public.emit_private_notification(
    event_name, new.id::text, version, new.community_id, new.borrower_id,
    '{"schema_version":1}'::jsonb, occurred
  );

  select * into item from public.supplies s
  where s.id = new.supply_id and s.community_id = new.community_id;
  if item.id is null then raise exception 'notification source listing unavailable'; end if;

  if new.handoff_contact_id is not null then
    perform public.emit_private_notification(
      event_name, new.id::text, version, new.community_id, new.handoff_contact_id,
      '{"schema_version":1}'::jsonb, occurred
    );
  elsif new.status = 'declined' then
    recipient := coalesce(new.decided_by, new.cancelled_by);
    if recipient is not null then
      perform public.emit_private_notification(
        event_name, new.id::text, version, new.community_id, recipient,
        '{"schema_version":1}'::jsonb, occurred
      );
    end if;
  elsif new.status = 'cancelled' then
    if new.cancelled_by is not null then
      perform public.emit_private_notification(
        event_name, new.id::text, version, new.community_id, new.cancelled_by,
        '{"schema_version":1}'::jsonb, occurred
      );
    end if;
    if item.ownership_kind = 'individual' then
      perform public.emit_private_notification(
        event_name, new.id::text, version, new.community_id, item.owner_id,
        '{"schema_version":1}'::jsonb, occurred
      );
    else
      for recipient in
        select distinct p.id from public.profiles p
        join public.community_roles r on r.community_id = p.community_id and r.user_id = p.id
        where p.community_id = new.community_id and p.membership_status = 'active'
          and r.role in ('custodian', 'steward') order by p.id
      loop
        perform public.emit_private_notification(
          event_name, new.id::text, version, new.community_id, recipient,
          '{"schema_version":1}'::jsonb, occurred
        );
      end loop;
    end if;
  elsif item.ownership_kind = 'individual' then
    perform public.emit_private_notification(
      event_name, new.id::text, version, new.community_id, item.owner_id,
      '{"schema_version":1}'::jsonb, occurred
    );
  else
    for recipient in
      select distinct p.id
      from public.profiles p
      join public.community_roles r
        on r.community_id = p.community_id and r.user_id = p.id
      where p.community_id = new.community_id and p.membership_status = 'active'
        and r.role in ('custodian', 'steward')
      order by p.id
    loop
      perform public.emit_private_notification(
        event_name, new.id::text, version, new.community_id, recipient,
        '{"schema_version":1}'::jsonb, occurred
      );
    end loop;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."notify_loan_transition"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_membership_application_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform public.emit_notification_to_active_administrators(
    'membership_application_pending', new.id::text, 1, new.community_id,
    '{"schema_version":1}'::jsonb, new.submitted_at
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."notify_membership_application_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_membership_status_transition"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  event_name text;
  occurred timestamptz := clock_timestamp();
  version bigint := txid_current();
begin
  if new.membership_status is not distinct from old.membership_status then return new; end if;
  event_name := case
    when old.membership_status = 'pending' and new.membership_status = 'active' then 'membership_approved'
    when old.membership_status = 'pending' and new.membership_status = 'rejected' then 'membership_rejected'
    when old.membership_status = 'active' and new.membership_status = 'deactivated' then 'membership_deactivated'
    when old.membership_status = 'deactivated' and new.membership_status = 'active' then 'membership_reactivated'
    else null
  end;
  if event_name is null then return new; end if;
  occurred := case event_name
    when 'membership_approved' then coalesce(new.approved_at, occurred)
    when 'membership_rejected' then coalesce(new.rejected_at, occurred)
    when 'membership_deactivated' then coalesce(new.deactivated_at, occurred)
    else occurred
  end;
  if event_name in ('membership_deactivated', 'membership_reactivated') then
    select coalesce((
      select c.deactivation_sequence
      from public.membership_deactivation_consequences c
      where c.profile_id = new.id and c.community_id = new.community_id
      order by c.deactivation_sequence desc limit 1
    ), version) into version;
  end if;
  perform public.emit_private_notification(
    event_name, new.id::text, version, new.community_id, new.id,
    '{"schema_version":1}'::jsonb, occurred
  );
  if event_name in ('membership_deactivated', 'membership_reactivated') then
    perform public.emit_notification_to_active_administrators(
      event_name, new.id::text, version, new.community_id,
      '{"schema_version":1}'::jsonb, occurred
    );
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."notify_membership_status_transition"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_role_audit_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare event_name text;
begin
  event_name := case new.action
    when 'promote' then 'role_promoted'
    when 'demote' then 'role_demoted'
    else null
  end;
  if event_name is null then return new; end if;
  perform public.emit_private_notification(
    event_name, new.id::text, 1, new.community_id, new.target_user_id,
    '{"schema_version":1}'::jsonb, new.occurred_at
  );
  perform public.emit_notification_to_active_administrators(
    event_name, new.id::text, 1, new.community_id,
    '{"schema_version":1}'::jsonb, new.occurred_at
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."notify_role_audit_insert"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wanted_offers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "community_id" "uuid" NOT NULL,
    "request_id" "uuid" NOT NULL,
    "supply_id" "uuid" NOT NULL,
    "offerer_id" "uuid" NOT NULL,
    "note" "text",
    "status" "public"."wanted_offer_status" DEFAULT 'active'::"public"."wanted_offer_status" NOT NULL,
    "transition_version" bigint DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "wanted_offers_transition_version_check" CHECK (("transition_version" > 0))
);

ALTER TABLE ONLY "public"."wanted_offers" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."wanted_offers" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."offer_wanted_listing"("target_request_id" "uuid", "target_supply_id" "uuid", "supplied_note" "text" DEFAULT NULL::"text") RETURNS "public"."wanted_offers"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare req public.wanted_requests%rowtype; item public.supplies%rowtype; created public.wanted_offers;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into req from public.wanted_requests r where r.id = target_request_id;
  select * into item from public.supplies s where s.id = target_supply_id;
  if req.id is null or item.id is null or req.community_id <> item.community_id then
    raise exception 'same-community request and listed gear required';
  end if;
  perform public.lock_community_authorization(req.community_id, false);
  perform public.lock_listing(item.id);
  select * into req from public.wanted_requests r where r.id = target_request_id for update;
  select * into item from public.supplies s where s.id = target_supply_id for update;
  if not public.is_active_member(req.community_id) or req.status <> 'open' or item.listing_status <> 'listed'
    or not public.user_has_listing_descriptive_authority(item.community_id, item.id, auth.uid()) then
    raise exception 'offerable request and listing authority required';
  end if;
  if nullif(btrim(supplied_note), '') is not null
    and not public.valid_plain_text(btrim(supplied_note), 500, false) then
    raise exception 'invalid offer note';
  end if;
  insert into public.wanted_offers (community_id, request_id, supply_id, offerer_id, note)
    values (req.community_id, req.id, item.id, auth.uid(), nullif(btrim(supplied_note), ''))
    returning * into created;
  perform public.emit_wanted_notification('wanted_offer_created', created.id, created.transition_version,
    created.community_id, array[req.requester_id, created.offerer_id], false);
  return created;
end;
$$;


ALTER FUNCTION "public"."offer_wanted_listing"("target_request_id" "uuid", "target_supply_id" "uuid", "supplied_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_loan_audit_rewrite"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.community_id <> old.community_id
     or new.supply_id <> old.supply_id
     or new.borrower_id <> old.borrower_id
     or new.custodian_at_request_id <> old.custodian_at_request_id
     or new.quantity <> old.quantity
     or new.start_date <> old.start_date
     or new.end_date <> old.end_date
     or new.created_at <> old.created_at then
    raise exception 'loan relationship and request fields are immutable';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_loan_audit_rewrite"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_notification_registry_rewrite"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  raise exception 'notification event registry is immutable';
end;
$$;


ALTER FUNCTION "public"."prevent_notification_registry_rewrite"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_operational_audit_rewrite"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  raise exception 'operational audit is immutable';
end;
$$;


ALTER FUNCTION "public"."prevent_operational_audit_rewrite"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_supply_condition_history_rewrite"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  raise exception 'condition history is immutable';
end;
$$;


ALTER FUNCTION "public"."prevent_supply_condition_history_rewrite"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_terminal_membership_reactivation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if old.membership_status = 'deactivated' and new.membership_status <> 'deactivated'
     and coalesce(current_setting('app.membership_reactivation', true), '') <> 'allowed' then
    raise exception 'deactivated membership requires the reviewed Administrator reactivation workflow';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_terminal_membership_reactivation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."private_bulk_draft_attempt_status"("supplied_attempt_ids" "uuid"[]) RETURNS TABLE("attempt_id" "uuid", "supply_id" "uuid", "community_id" "uuid", "listing_status" "public"."listing_status", "guideline_version" bigint, "expected_images" integer, "committed_images" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if auth.uid() is null or supplied_attempt_ids is null
    or cardinality(supplied_attempt_ids) not between 1 and 10
    or cardinality(supplied_attempt_ids) <> (
      select count(distinct value)::integer from unnest(supplied_attempt_ids) value
    ) then
    raise exception 'one to ten unique bulk attempts are required';
  end if;
  return query
  select s.publication_attempt_id, s.id, s.community_id, s.listing_status,
    s.guideline_version,
    s.publication_expected_images::integer, cardinality(s.image_paths)
  from public.supplies s
  where s.publication_attempt_id = any(supplied_attempt_ids)
    and s.created_by = auth.uid()
    and s.community_id = public.current_active_community_id()
  order by array_position(supplied_attempt_ids, s.publication_attempt_id);
end;
$$;


ALTER FUNCTION "public"."private_bulk_draft_attempt_status"("supplied_attempt_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."private_gear_catalog"("supplied_search" "text" DEFAULT ''::"text", "supplied_category" "text" DEFAULT 'all'::"text", "supplied_ownership" "text" DEFAULT 'all'::"text", "supplied_condition" "text" DEFAULT 'all'::"text", "supplied_postal" "text" DEFAULT 'all'::"text", "supplied_page" integer DEFAULT 1) RETURNS TABLE("id" "uuid", "community_id" "uuid", "title" "text", "description" "text", "category" "text", "condition" "text", "ownership_kind" "public"."ownership_kind", "owner_id" "uuid", "owner_is_active" boolean, "custodian_id" "uuid", "custodian_name" "text", "custodian_postal_code" "text", "quantity_total" integer, "listing_status" "public"."listing_status", "image_paths" "text"[], "total_count" bigint, "resolved_page" integer)
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
declare
  caller_community uuid := public.current_active_community_id();
  normalized_search text;
  normalized_postal text;
  matching_count bigint;
  effective_page integer;
begin
  if octet_length(coalesce(supplied_search, '')) > 400 then raise exception 'search input is too large'; end if;
  if octet_length(coalesce(supplied_category, '')) > 64 then raise exception 'unsupported category filter'; end if;
  if octet_length(coalesce(supplied_ownership, '')) > 32 then raise exception 'unsupported ownership filter'; end if;
  if octet_length(coalesce(supplied_condition, '')) > 32 then raise exception 'unsupported condition filter'; end if;
  if octet_length(coalesce(supplied_postal, '')) > 40 then raise exception 'unsupported postal filter'; end if;
  normalized_search := btrim(coalesce(supplied_search, ''));
  if length(normalized_search) > 100 then raise exception 'search is limited to 100 characters'; end if;
  if supplied_category <> 'all' and not public.is_canonical_gear_category(supplied_category) then raise exception 'unsupported category filter'; end if;
  if supplied_ownership not in ('all', 'individual', 'group') then raise exception 'unsupported ownership filter'; end if;
  if supplied_condition <> 'all' and not public.is_canonical_gear_condition(supplied_condition) then raise exception 'unsupported condition filter'; end if;
  if supplied_page is null or supplied_page < 1 or supplied_page > 1000 then raise exception 'page must be between 1 and 1000'; end if;

  if supplied_postal = 'all' then
    normalized_postal := 'all';
  else
    normalized_postal := public.normalize_postal_code(supplied_postal);
    if normalized_postal is null
      or length(normalized_postal) not between 3 and 10
      or normalized_postal !~ '^[A-Z0-9]+(?:[ -][A-Z0-9]+)?$'
      or normalized_postal <> supplied_postal then
      raise exception 'unsupported postal filter';
    end if;
  end if;

  if caller_community is null then return; end if;
  perform set_config('statement_timeout', '2000', true);

  select count(*) into matching_count
  from public.supplies s
  where s.community_id = caller_community
    and s.listing_status = 'listed'
    and (normalized_search = '' or position(lower(normalized_search) in lower(s.title || ' ' || s.description)) > 0)
    and (supplied_category = 'all' or s.category = supplied_category)
    and (supplied_ownership = 'all' or s.ownership_kind::text = supplied_ownership)
    and (supplied_condition = 'all' or s.condition = supplied_condition)
    and (normalized_postal = 'all' or public.private_listing_postal_code(s.id) = normalized_postal);
  effective_page := case
    when matching_count = 0 then 1
    else least(supplied_page, ceil(matching_count / 24.0)::integer)
  end;

  return query
  select
    s.id, s.community_id, s.title, s.description, s.category, s.condition,
    s.ownership_kind, s.owner_id,
    case when s.ownership_kind = 'individual' then owner_profile.membership_status = 'active' else false end,
    s.custodian_id, custodian.display_name, public.private_listing_postal_code(s.id),
    s.quantity_total, s.listing_status, s.image_paths,
    matching_count, effective_page
  from public.supplies s
  join public.profiles custodian
    on custodian.community_id = s.community_id and custodian.id = s.custodian_id
  left join public.profiles owner_profile
    on owner_profile.community_id = s.community_id and owner_profile.id = s.owner_id
  where s.community_id = caller_community
    and s.listing_status = 'listed'
    and (normalized_search = '' or position(lower(normalized_search) in lower(s.title || ' ' || s.description)) > 0)
    and (supplied_category = 'all' or s.category = supplied_category)
    and (supplied_ownership = 'all' or s.ownership_kind::text = supplied_ownership)
    and (supplied_condition = 'all' or s.condition = supplied_condition)
    and (normalized_postal = 'all' or public.private_listing_postal_code(s.id) = normalized_postal)
  order by lower(s.title), s.id
  limit 24 offset ((effective_page - 1) * 24);
end;
$_$;


ALTER FUNCTION "public"."private_gear_catalog"("supplied_search" "text", "supplied_category" "text", "supplied_ownership" "text", "supplied_condition" "text", "supplied_postal" "text", "supplied_page" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."private_gear_loans"() RETURNS TABLE("id" "uuid", "supply_id" "uuid", "supply_title" "text", "ownership_kind" "public"."ownership_kind", "owner_id" "uuid", "owner_is_active" boolean, "current_custodian_id" "uuid", "current_custodian_name" "text", "borrower_id" "uuid", "borrower_name" "text", "custodian_at_request_id" "uuid", "quantity" integer, "start_date" "date", "end_date" "date", "status" "public"."gear_loan_status", "borrower_note" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller_id uuid := auth.uid(); caller_community uuid := public.current_active_community_id();
begin
  if caller_id is null or caller_community is null then return; end if;
  return query
  select gl.id, gl.supply_id, s.title, s.ownership_kind, s.owner_id,
    case when s.ownership_kind = 'individual' then owner_profile.membership_status = 'active' else false end,
    s.custodian_id, custodian.display_name, gl.borrower_id, borrower.display_name,
    gl.custodian_at_request_id, gl.quantity, gl.start_date, gl.end_date, gl.status, gl.borrower_note
  from public.gear_loans gl
  join public.supplies s on s.id = gl.supply_id and s.community_id = gl.community_id
  join public.profiles borrower on borrower.id = gl.borrower_id and borrower.community_id = gl.community_id
  join public.profiles custodian on custodian.id = s.custodian_id and custodian.community_id = s.community_id
  left join public.profiles owner_profile on owner_profile.id = s.owner_id and owner_profile.community_id = s.community_id
  where gl.community_id = caller_community and (
    gl.borrower_id = caller_id
    or (s.ownership_kind = 'individual' and s.owner_id = caller_id)
    or (s.ownership_kind = 'group' and public.is_active_inventory_manager(gl.community_id))
    or (s.ownership_kind = 'individual' and public.is_active_administrator(gl.community_id))
  )
  order by gl.created_at desc, gl.id;
end;
$$;


ALTER FUNCTION "public"."private_gear_loans"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."private_handoff_candidates"("target_loan_id" "uuid") RETURNS TABLE("id" "uuid", "display_name" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare loan public.gear_loans%rowtype; item public.supplies%rowtype;
begin
  select * into loan from public.gear_loans gl where gl.id = target_loan_id;
  select * into item from public.supplies s where s.id = loan.supply_id and s.community_id = loan.community_id;
  if auth.uid() is null or loan.id is null or item.id is null or item.ownership_kind <> 'group'
    or loan.status not in ('pending', 'approved', 'checked_out')
    or not public.is_active_member(loan.community_id)
    or (
      (loan.status = 'pending' and not public.loan_manager_authorized(item, 'approve'))
      or (
        loan.status in ('approved', 'checked_out')
        and auth.uid() <> loan.handoff_contact_id
        and not public.is_active_administrator(loan.community_id)
      )
    ) then
    raise exception 'active group loan handoff context required';
  end if;
  return query
  select p.id, p.display_name
  from public.profiles p
  where p.community_id = loan.community_id and p.membership_status = 'active'
    and public.valid_group_handoff(loan.community_id, p.id)
  order by p.display_name, p.id
  limit 500;
end;
$$;


ALTER FUNCTION "public"."private_handoff_candidates"("target_loan_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."private_inventory_contacts"("target_supply_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" "uuid", "display_name" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller_id uuid := auth.uid(); caller_community uuid := public.current_active_community_id();
begin
  if caller_id is null or caller_community is null then raise exception 'active inventory contact context required'; end if;
  if not public.is_active_inventory_manager(caller_community) and not exists (
    select 1 from public.supplies s
    where s.id = target_supply_id and s.community_id = caller_community
      and s.ownership_kind = 'individual' and s.owner_id = caller_id
      and s.listing_status <> 'retired'
  ) then raise exception 'active inventory contact context required'; end if;
  if (select count(*) from public.profiles p where p.community_id = caller_community and p.membership_status = 'active') > 500 then
    raise exception 'inventory contact list exceeds gear share bound';
  end if;
  return query
  select p.id, p.display_name from public.profiles p
  where p.community_id = caller_community and p.membership_status = 'active'
  order by p.display_name, p.id;
end;
$$;


ALTER FUNCTION "public"."private_inventory_contacts"("target_supply_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."private_listing_postal_code"("target_supply_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select postal.postal_code
  from public.supplies s
  join public.member_postal_codes postal
    on postal.community_id = s.community_id
   and postal.profile_id = s.custodian_id
  where s.id = target_supply_id
    and s.community_id = public.current_active_community_id()
    and s.listing_status = 'listed'
$$;


ALTER FUNCTION "public"."private_listing_postal_code"("target_supply_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."private_loan_guideline_acceptances"("supplied_loan_ids" "uuid"[]) RETURNS TABLE("loan_id" "uuid", "guideline_version" bigint, "rules" "text"[], "accepted_by" "uuid", "accepted_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if auth.uid() is null or supplied_loan_ids is null or cardinality(supplied_loan_ids) > 100 then
    raise exception 'authenticated bounded loan list required';
  end if;
  return query
    select a.loan_id, a.guideline_version, a.rules, a.accepted_by, a.accepted_at
    from public.gear_loan_guideline_acceptances a
    join public.gear_loans l on l.id = a.loan_id and l.community_id = a.community_id
    join public.supplies s on s.id = l.supply_id and s.community_id = l.community_id
    where a.loan_id = any(supplied_loan_ids)
      and public.is_active_member(a.community_id)
      and (l.borrower_id = auth.uid()
        or (s.ownership_kind = 'individual' and s.owner_id = auth.uid())
        or (s.ownership_kind = 'individual' and public.is_active_administrator(a.community_id))
        or (s.ownership_kind = 'group' and public.is_active_inventory_manager(a.community_id)));
end;
$$;


ALTER FUNCTION "public"."private_loan_guideline_acceptances"("supplied_loan_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."private_loan_operations"("target_ids" "uuid"[]) RETURNS TABLE("loan_id" "uuid", "handoff_contact_id" "uuid", "handoff_contact_name" "text", "needs_attention" boolean, "needs_attention_reason" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller_id uuid := auth.uid(); caller_community uuid := public.current_active_community_id();
begin
  if caller_id is null or caller_community is null then return; end if;
  if target_ids is null or cardinality(target_ids) not between 1 and 500
    or exists (select 1 from unnest(target_ids) id where id is null)
    or cardinality(target_ids) <> (select count(distinct id) from unnest(target_ids) id) then
    raise exception 'one to 500 unique loan identifiers required';
  end if;
  return query
  select gl.id, gl.handoff_contact_id, handoff.display_name,
    s.needs_attention, s.needs_attention_reason
  from public.gear_loans gl
  join public.supplies s on s.id = gl.supply_id and s.community_id = gl.community_id
  left join public.profiles handoff on handoff.id = gl.handoff_contact_id and handoff.community_id = gl.community_id
  where gl.id = any(target_ids) and gl.community_id = caller_community and (
    gl.borrower_id = caller_id
    or (s.ownership_kind = 'individual' and s.owner_id = caller_id)
    or (s.ownership_kind = 'group' and public.is_active_inventory_manager(gl.community_id))
    or (s.ownership_kind = 'individual' and public.is_active_administrator(gl.community_id))
    or gl.handoff_contact_id = caller_id
  );
end;
$$;


ALTER FUNCTION "public"."private_loan_operations"("target_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."private_manageable_listings_for_wanted"() RETURNS TABLE("id" "uuid", "title" "text", "ownership_kind" "public"."ownership_kind")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select s.id, s.title, s.ownership_kind
  from public.supplies s
  where s.community_id = public.current_active_community_id()
    and s.listing_status = 'listed'
    and public.user_has_listing_descriptive_authority(s.community_id, s.id, auth.uid())
  order by s.title, s.id
  limit 100
$$;


ALTER FUNCTION "public"."private_manageable_listings_for_wanted"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."private_member_administration"() RETURNS TABLE("id" "uuid", "display_name" "text", "membership_status" "text", "access_level" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    SET "statement_timeout" TO '3s'
    AS $$
declare
  caller_community uuid := public.current_active_community_id();
begin
  if caller_community is null or not public.is_active_administrator(caller_community) then
    raise exception 'active administrator required';
  end if;
  return query
  select p.id, p.display_name, p.membership_status::text,
    case
      when p.membership_status = 'deactivated' then 'regular'
      when exists (
        select 1 from public.community_roles r
        where r.community_id = caller_community and r.user_id = p.id and r.role = 'steward'
      ) then 'administrator'
      when exists (
        select 1 from public.community_roles r
        where r.community_id = caller_community and r.user_id = p.id and r.role = 'custodian'
      ) then 'custodian'
      else 'regular'
    end
  from public.profiles p
  where p.community_id = caller_community
    and p.membership_status in ('active', 'deactivated')
  order by p.display_name, p.id;
end;
$$;


ALTER FUNCTION "public"."private_member_administration"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."private_notification_delivery_diagnostics"("target_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("outbox_id" "uuid", "recipient_user_id" "uuid", "recipient_display_name" "text", "event_type" "text", "status" "text", "attempt_count" smallint, "suppression_reason" "text", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller_community uuid := public.current_active_community_id();
begin
  if caller_community is null or not public.is_active_administrator(caller_community) then
    raise exception 'active administrator required';
  end if;
  if target_user_id is not null and not exists (
    select 1 from public.profiles p where p.id = target_user_id and p.community_id = caller_community
  ) then raise exception 'same-community diagnostic target required'; end if;
  return query
  select o.id, o.recipient_user_id, p.display_name, o.event_type, o.status,
    o.attempt_count,
    (
      select s.reason from public.transactional_email_suppressions s
      where s.recipient_user_id = o.recipient_user_id
        and s.normalized_email = o.email_snapshot and s.cleared_at is null
      limit 1
    ),
    o.created_at, o.updated_at
  from public.transactional_email_outbox o
  join public.profiles p on p.id = o.recipient_user_id and p.community_id = o.community_id
  where o.community_id = caller_community
    and (target_user_id is null or o.recipient_user_id = target_user_id)
  order by o.updated_at desc, o.id desc
  limit 100;
end;
$$;


ALTER FUNCTION "public"."private_notification_delivery_diagnostics"("target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."private_pending_members"() RETURNS TABLE("id" "uuid", "display_name" "text", "confirmed_email" "text", "submitted_at" timestamp with time zone, "answer_snapshot" "jsonb")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller_community uuid := public.current_active_community_id();
begin
  if not public.is_active_administrator(caller_community) then raise exception 'active administrator required'; end if;
  return query
  select p.id, p.display_name,
    case when u.email_confirmed_at is not null then u.email::text else null end,
    a.submitted_at, a.answer_snapshot
  from public.profiles p
  join public.membership_applications a on a.applicant_id = p.id and a.community_id = p.community_id
  join auth.users u on u.id = p.id
  where p.community_id = caller_community and p.membership_status = 'pending'
    and a.decided_at is null and a.redacted_at is null
    and a.submitted_at >= now() - interval '90 days'
  order by a.submitted_at, p.id;
end;
$$;


ALTER FUNCTION "public"."private_pending_members"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."private_supplies"() RETURNS TABLE("id" "uuid", "community_id" "uuid", "title" "text", "description" "text", "category" "text", "condition" "text", "ownership_kind" "public"."ownership_kind", "owner_id" "uuid", "owner_is_active" boolean, "custodian_id" "uuid", "custodian_name" "text", "quantity_total" integer, "listing_status" "public"."listing_status", "image_paths" "text"[], "publication_attempt_id" "uuid", "publication_expected_images" smallint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller_id uuid := auth.uid(); caller_community uuid := public.current_active_community_id();
begin
  if caller_id is null or caller_community is null then return; end if;
  return query
  select s.id, s.community_id, s.title, s.description, s.category, s.condition,
    s.ownership_kind, s.owner_id,
    case when s.ownership_kind = 'individual' then owner_profile.membership_status = 'active' else false end,
    s.custodian_id, custodian.display_name, s.quantity_total, s.listing_status,
    s.image_paths, s.publication_attempt_id, s.publication_expected_images
  from public.supplies s
  join public.profiles custodian on custodian.id = s.custodian_id and custodian.community_id = s.community_id
  left join public.profiles owner_profile on owner_profile.id = s.owner_id and owner_profile.community_id = s.community_id
  where s.community_id = caller_community and (
    s.listing_status <> 'unlisted'
    or s.created_by = caller_id
    or s.owner_id = caller_id
    or public.is_active_inventory_manager(s.community_id)
  )
  order by s.title, s.id;
end;
$$;


ALTER FUNCTION "public"."private_supplies"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."private_supply_attention_flags"("target_ids" "uuid"[]) RETURNS TABLE("supply_id" "uuid", "needs_attention" boolean, "reason" "text", "version" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller_id uuid := auth.uid(); caller_community uuid := public.current_active_community_id();
begin
  if caller_id is null or caller_community is null then return; end if;
  if target_ids is null or cardinality(target_ids) not between 1 and 500
    or exists (select 1 from unnest(target_ids) id where id is null)
    or cardinality(target_ids) <> (select count(distinct id) from unnest(target_ids) id) then
    raise exception 'one to 500 unique listing identifiers required';
  end if;
  return query
  select s.id, s.needs_attention, s.needs_attention_reason, s.needs_attention_version
  from public.supplies s
  where s.id = any(target_ids) and s.community_id = caller_community
    and (
      s.listing_status = 'listed' or s.created_by = caller_id or s.owner_id = caller_id
      or public.is_active_inventory_manager(s.community_id)
    );
end;
$$;


ALTER FUNCTION "public"."private_supply_attention_flags"("target_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."private_supply_detail"("target_supply_id" "uuid") RETURNS TABLE("id" "uuid", "community_id" "uuid", "title" "text", "description" "text", "category" "text", "condition" "text", "ownership_kind" "public"."ownership_kind", "owner_id" "uuid", "owner_is_active" boolean, "custodian_id" "uuid", "custodian_name" "text", "quantity_total" integer, "listing_status" "public"."listing_status", "image_paths" "text"[], "publication_attempt_id" "uuid", "publication_expected_images" smallint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller_id uuid := auth.uid(); caller_community uuid := public.current_active_community_id();
begin
  if target_supply_id is null or caller_id is null or caller_community is null then return; end if;
  return query
  select s.id, s.community_id, s.title, s.description, s.category, s.condition,
    s.ownership_kind, s.owner_id,
    case when s.ownership_kind = 'individual' then owner_profile.membership_status = 'active' else false end,
    s.custodian_id, custodian.display_name, s.quantity_total, s.listing_status,
    s.image_paths, s.publication_attempt_id, s.publication_expected_images
  from public.supplies s
  join public.profiles custodian on custodian.id = s.custodian_id and custodian.community_id = s.community_id
  left join public.profiles owner_profile on owner_profile.id = s.owner_id and owner_profile.community_id = s.community_id
  where s.id = target_supply_id and s.community_id = caller_community
    and (
      s.listing_status = 'listed'
      or s.created_by = caller_id
      or s.owner_id = caller_id
      or public.is_active_inventory_manager(s.community_id)
    );
end;
$$;


ALTER FUNCTION "public"."private_supply_detail"("target_supply_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."private_supply_guidelines"("target_supply_id" "uuid") RETURNS TABLE("guideline_version" bigint, "rules" "text"[])
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare item public.supplies%rowtype;
begin
  select * into item from public.supplies s where s.id = target_supply_id;
  if not found or item.community_id <> public.current_active_community_id() then
    raise exception 'same-community listing required';
  end if;
  if item.guideline_version = 0 then
    return query select 0::bigint, '{}'::text[];
  else
    return query select v.version, v.rules
      from public.supply_guideline_versions v
      where v.supply_id = item.id and v.version = item.guideline_version;
  end if;
end;
$$;


ALTER FUNCTION "public"."private_supply_guidelines"("target_supply_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."private_supply_guidelines_batch"("target_ids" "uuid"[]) RETURNS TABLE("supply_id" "uuid", "guideline_version" bigint, "rules" "text"[])
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if auth.uid() is null or target_ids is null or cardinality(target_ids) > 500 then
    raise exception 'authenticated bounded listing list required';
  end if;
  return query
    select s.id, s.guideline_version, coalesce(v.rules, '{}'::text[])
    from public.supplies s
    left join public.supply_guideline_versions v
      on v.supply_id = s.id and v.version = s.guideline_version
    where s.id = any(target_ids)
      and s.community_id = public.current_active_community_id();
end;
$$;


ALTER FUNCTION "public"."private_supply_guidelines_batch"("target_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."private_wanted_offers"("target_request_id" "uuid") RETURNS TABLE("id" "uuid", "request_id" "uuid", "supply_id" "uuid", "supply_title" "text", "offerer_id" "uuid", "offerer_name" "text", "note" "text", "status" "public"."wanted_offer_status", "transition_version" bigint, "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare req public.wanted_requests%rowtype; caller_community uuid := public.current_active_community_id();
begin
  if caller_community is null then raise exception 'active member required'; end if;
  select * into req from public.wanted_requests r where r.id = target_request_id;
  if not found or req.community_id <> caller_community
    or (req.status = 'moderated' and not public.is_active_administrator(caller_community)) then
    raise exception 'wanted request unavailable';
  end if;
  return query
    select o.id, o.request_id, o.supply_id, s.title, o.offerer_id, p.display_name,
      o.note, o.status, o.transition_version, o.created_at
    from public.wanted_offers o
    join public.supplies s on s.id = o.supply_id and s.community_id = o.community_id
    join public.profiles p on p.id = o.offerer_id and p.community_id = o.community_id
    where o.request_id = req.id and o.status <> 'invalidated'
    order by o.created_at, o.id
    limit 24;
end;
$$;


ALTER FUNCTION "public"."private_wanted_offers"("target_request_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."private_wanted_requests"("supplied_view" "text" DEFAULT 'open'::"text", "supplied_before_created_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "supplied_before_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" "uuid", "requester_id" "uuid", "requester_name" "text", "title" "text", "category" "text", "desired_quantity" integer, "desired_start" "date", "desired_end" "date", "note" "text", "status" "public"."wanted_request_status", "closure_kind" "text", "selected_offer_id" "uuid", "transition_version" bigint, "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller_id uuid := auth.uid(); caller_community uuid := public.current_active_community_id();
begin
  if caller_id is null or caller_community is null then raise exception 'active member required'; end if;
  if supplied_view not in ('open','fulfilled','closed','moderated','mine')
    or ((supplied_before_created_at is null) <> (supplied_before_id is null)) then
    raise exception 'valid wanted view and cursor required';
  end if;
  if supplied_view = 'moderated' and not public.is_active_administrator(caller_community) then
    raise exception 'administrator required';
  end if;
  return query
    select r.id, r.requester_id, p.display_name, r.title, r.category,
      r.desired_quantity, r.desired_start, r.desired_end, r.note,
      r.status, r.closure_kind, r.selected_offer_id, r.transition_version,
      r.created_at, r.updated_at
    from public.wanted_requests r
    join public.profiles p on p.id = r.requester_id and p.community_id = r.community_id
    where r.community_id = caller_community
      and case supplied_view
        when 'mine' then r.requester_id = caller_id and (r.status <> 'moderated' or public.is_active_administrator(caller_community))
        else r.status::text = supplied_view end
      and (supplied_before_created_at is null or (r.created_at, r.id) < (supplied_before_created_at, supplied_before_id))
    order by r.created_at desc, r.id desc
    limit 24;
end;
$$;


ALTER FUNCTION "public"."private_wanted_requests"("supplied_view" "text", "supplied_before_created_at" timestamp with time zone, "supplied_before_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_ai_attempt_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if coalesce(current_setting('app.ai_attempt_internal', true), '') <> 'allowed' then raise exception 'AI attempt changes require reviewed workflows'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;


ALTER FUNCTION "public"."protect_ai_attempt_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_legacy_deactivation_manifest"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if coalesce(current_setting('app.m6_reviewed_legacy_manifest', true), '') <> 'allowed' then
    raise exception 'legacy deactivation manifest requires a separately reviewed predecessor migration';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;


ALTER FUNCTION "public"."protect_legacy_deactivation_manifest"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_loan_reminder_policy"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.community_id is distinct from old.community_id then
    raise exception 'reminder policy community is immutable';
  end if;
  if new.time_zone is distinct from old.time_zone
    and new.policy_version is distinct from old.policy_version + 1 then
    raise exception 'time-zone changes require exactly the next reminder policy version';
  end if;
  if new.time_zone is not distinct from old.time_zone
    and new.policy_version is distinct from old.policy_version then
    raise exception 'reminder policy version changes require a time-zone change';
  end if;
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."protect_loan_reminder_policy"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_milestone_six_state"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if coalesce(current_setting('app.milestone_six_internal_change', true), '') <> 'allowed' then
    raise exception 'milestone 6 state changes require the reviewed workflow';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;


ALTER FUNCTION "public"."protect_milestone_six_state"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_notification_operational_tables"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if coalesce(current_setting('app.notification_internal_change', true), '') <> 'allowed'
    or current_user <> pg_catalog.pg_get_userbyid(
      (select p.proowner from pg_catalog.pg_proc p
       where p.oid = 'public.emit_private_notification(text,text,bigint,uuid,uuid,jsonb,timestamptz)'::regprocedure)
    ) then
    raise exception 'notification operational changes require the reviewed workflow';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."protect_notification_operational_tables"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_supply_attention_state"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'INSERT' then
    if new.needs_attention is distinct from false
      or new.needs_attention_reason is not null
      or new.needs_attention_version is distinct from 0 then
      raise exception 'new supplies must begin without a Needs Attention hold';
    end if;
    return new;
  end if;
  if (new.needs_attention, new.needs_attention_reason, new.needs_attention_version)
      is distinct from
     (old.needs_attention, old.needs_attention_reason, old.needs_attention_version)
     and (
       coalesce(current_setting('app.supply_attention_change', true), '') <> 'allowed'
       or current_user <> pg_catalog.pg_get_userbyid(
         (
           select p.proowner
           from pg_catalog.pg_proc p
           where p.oid = 'public.set_supply_needs_attention(uuid,boolean,text)'::regprocedure
         )
       )
     ) then
    raise exception 'Needs Attention changes require the audited workflow';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."protect_supply_attention_state"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_join_questions"("supplied_questions" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  caller_community uuid;
  next_version integer;
  result uuid;
begin
  if supplied_questions is null or octet_length(coalesce(supplied_questions::text, '')) > 5000
    or not public.validate_join_questions(supplied_questions) then
    raise exception 'invalid join-question set';
  end if;
  select p.community_id into caller_community from public.profiles p where p.id = caller_id;
  if caller_community is null then raise exception 'active administrator required'; end if;
  perform public.lock_community_authorization(caller_community, true);
  if not public.is_active_administrator(caller_community) then raise exception 'active administrator required'; end if;
  select coalesce(max(q.version), 0) + 1 into next_version
  from public.join_question_versions q where q.community_id = caller_community;
  update public.join_question_versions set is_current = false
  where community_id = caller_community and is_current;
  insert into public.join_question_versions (community_id, version, questions, published_by)
  values (caller_community, next_version, supplied_questions, caller_id)
  returning id into result;
  return result;
end;
$$;


ALTER FUNCTION "public"."publish_join_questions"("supplied_questions" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_supply_draft"("target_supply_id" "uuid", "supplied_attempt_id" "uuid") RETURNS "public"."supplies"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare item public.supplies%rowtype;
begin
  perform public.lock_listing(target_supply_id);
  select * into item from public.supplies where id = target_supply_id for update;
  if not found or item.created_by <> auth.uid() or item.publication_attempt_id <> supplied_attempt_id or item.listing_status <> 'unlisted' or not public.is_active_member(item.community_id) then
    raise exception 'draft unavailable';
  end if;
  if cardinality(item.image_paths) <> item.publication_expected_images then raise exception 'draft photos are incomplete'; end if;
  perform set_config('app.authorized_draft_publication', 'on', true);
  update public.supplies set listing_status = 'listed' where id = item.id returning * into item;
  return item;
end;
$$;


ALTER FUNCTION "public"."publish_supply_draft"("target_supply_id" "uuid", "supplied_attempt_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reactivate_member"("target_user_id" "uuid", "supplied_preview_version" "text", "supplied_reason" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "lock_timeout" TO '3s'
    SET "statement_timeout" TO '8s'
    AS $_$
declare
  caller_id uuid := auth.uid();
  caller_community uuid;
  target public.profiles%rowtype;
  consequence public.membership_deactivation_consequences%rowtype;
  current_version text;
  audit_id uuid;
  cancelled_count bigint;
  individual_count bigint;
  stored_count bigint;
  listing_id uuid;
  loan_id uuid;
  normalized_reason text := regexp_replace(btrim(supplied_reason), '[[:space:]]+', ' ', 'g');
begin
  select p.community_id into caller_community from public.profiles p where p.id = caller_id;
  if caller_id is null or caller_community is null then raise exception 'active administrator required'; end if;
  perform public.lock_community_authorization(caller_community, true);
  if not public.is_active_administrator(caller_community) then raise exception 'active administrator required'; end if;
  if supplied_preview_version !~ '^[0-9a-f]{64}$' or not public.valid_plain_text(normalized_reason, 240) then raise exception 'valid preview and reason required'; end if;
  select * into target from public.profiles p where p.id = target_user_id and p.community_id = caller_community for update;
  if not found then raise exception 'deactivated same-community member required'; end if;
  if target.membership_status = 'active' then
    select a.id into audit_id from public.membership_reactivation_audit a where a.profile_id = target_user_id and a.preview_version = supplied_preview_version;
    if audit_id is not null then return audit_id; end if;
  end if;
  if target.membership_status <> 'deactivated' then raise exception 'deactivated same-community member required'; end if;
  select * into consequence from public.membership_deactivation_consequences c
  where c.profile_id = target_user_id and c.community_id = caller_community
  order by c.deactivation_sequence desc limit 1 for update;
  if not found then raise exception 'reviewed deactivation consequence record required'; end if;
  for listing_id in select s.id from public.supplies s where s.community_id = caller_community and (s.owner_id = target_user_id or s.custodian_id = target_user_id) order by s.id loop perform public.lock_listing(listing_id); end loop;
  for loan_id in select gl.id from public.gear_loans gl join public.supplies s on s.id = gl.supply_id where gl.community_id = caller_community and s.owner_id = target_user_id order by gl.id loop perform 1 from public.gear_loans x where x.id = loan_id for update; end loop;
  current_version := public.reactivation_state_version(target_user_id, caller_community);
  if current_version is distinct from supplied_preview_version then raise exception 'reactivation impact changed; reload before confirming'; end if;
  if exists (select 1 from public.community_roles r where r.community_id = caller_community and r.user_id = target_user_id) then raise exception 'deactivated member has unexpected role state'; end if;
  select count(*) into cancelled_count from public.gear_loans gl join public.supplies s on s.id = gl.supply_id where gl.community_id = caller_community and s.owner_id = target_user_id and gl.status = 'cancelled';
  select count(*) into individual_count from public.supplies s where s.community_id = caller_community and s.ownership_kind = 'individual' and s.owner_id = target_user_id;
  select count(*) into stored_count from public.supplies s where s.community_id = caller_community and s.custodian_id = target_user_id;
  insert into public.community_roles (community_id, user_id, role, granted_by) values (caller_community, target_user_id, 'member', caller_id);
  perform set_config('app.membership_reactivation', 'allowed', true);
  update public.profiles set membership_status = 'active' where id = target_user_id;
  perform set_config('app.membership_reactivation', '', true);
  perform set_config('app.milestone_six_internal_change', 'allowed', true);
  insert into public.membership_reactivation_audit
    (community_id, profile_id, deactivation_id, actor_user_id, prior_access_level, restored_access_level,
     preview_version, reason, cancelled_loans, individual_owned_listings, stored_with_listings)
  values (caller_community, target_user_id, consequence.id, caller_id, consequence.prior_access_level, 'regular',
          current_version, normalized_reason, cancelled_count, individual_count, stored_count)
  returning id into audit_id;
  perform set_config('app.milestone_six_internal_change', '', true);
  return audit_id;
end;
$_$;


ALTER FUNCTION "public"."reactivate_member"("target_user_id" "uuid", "supplied_preview_version" "text", "supplied_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reactivation_impact"("target_user_id" "uuid") RETURNS TABLE("target_id" "uuid", "display_name" "text", "membership_status" "text", "prior_access_level" "text", "cancelled_loans" bigint, "individual_owned_listings" bigint, "stored_with_listings" bigint, "notification_consequence" "text", "preview_version" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "lock_timeout" TO '3s'
    SET "statement_timeout" TO '8s'
    AS $$
declare
  caller_id uuid := auth.uid();
  caller_community uuid;
  listing_id uuid;
  loan_id uuid;
  consequence_id uuid;
begin
  select p.community_id into caller_community from public.profiles p where p.id = caller_id;
  if caller_id is null or caller_community is null then raise exception 'active administrator required'; end if;
  perform public.lock_community_authorization(caller_community, true);
  if not public.is_active_administrator(caller_community) then raise exception 'active administrator required'; end if;
  if not exists (select 1 from public.profiles p where p.id = target_user_id and p.community_id = caller_community and p.membership_status = 'deactivated' for update)
    then raise exception 'deactivated same-community member required'; end if;
  select c.id into consequence_id from public.membership_deactivation_consequences c
  where c.profile_id = target_user_id and c.community_id = caller_community
  order by c.deactivation_sequence desc limit 1 for update;
  if consequence_id is null then raise exception 'reviewed deactivation consequence record required'; end if;
  for listing_id in select s.id from public.supplies s where s.community_id = caller_community and (s.owner_id = target_user_id or s.custodian_id = target_user_id) order by s.id loop perform public.lock_listing(listing_id); end loop;
  for loan_id in select gl.id from public.gear_loans gl join public.supplies s on s.id = gl.supply_id where gl.community_id = caller_community and s.owner_id = target_user_id order by gl.id loop perform 1 from public.gear_loans x where x.id = loan_id for update; end loop;
  return query
  select p.id, p.display_name, p.membership_status::text, c.prior_access_level,
    (select count(*) from public.gear_loans gl join public.supplies s on s.id = gl.supply_id where gl.community_id = caller_community and s.owner_id = target_user_id and gl.status = 'cancelled'),
    (select count(*) from public.supplies s where s.community_id = caller_community and s.ownership_kind = 'individual' and s.owner_id = target_user_id),
    (select count(*) from public.supplies s where s.community_id = caller_community and s.custodian_id = target_user_id),
    'Restores active Regular membership and one lifecycle notification; prior roles, loans, assignments, and contact access remain unchanged.'::text,
    public.reactivation_state_version(target_user_id, caller_community)
  from public.profiles p join public.membership_deactivation_consequences c on c.id = consequence_id
  where p.id = target_user_id;
end;
$$;


ALTER FUNCTION "public"."reactivation_impact"("target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reactivation_state_version"("target_user_id" "uuid", "target_community_id" "uuid") RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select encode(extensions.digest(concat_ws('|',
    p.id::text, p.membership_status::text, p.updated_at::text,
    c.id::text, c.prior_access_level, c.consequence_version::text, c.deactivation_sequence::text, c.deactivated_at::text,
    coalesce((select string_agg(concat_ws(':', r.role::text, r.granted_at::text), ',' order by r.role::text) from public.community_roles r where r.community_id = target_community_id and r.user_id = target_user_id), ''),
    coalesce((select string_agg(concat_ws(':', s.id::text, s.owner_id::text, s.custodian_id::text, s.listing_status::text, s.updated_at::text), ',' order by s.id) from public.supplies s where s.community_id = target_community_id and (s.owner_id = target_user_id or s.custodian_id = target_user_id)), ''),
    coalesce((select string_agg(concat_ws(':', gl.id::text, gl.status::text, gl.updated_at::text), ',' order by gl.id) from public.gear_loans gl join public.supplies s on s.id = gl.supply_id where gl.community_id = target_community_id and s.owner_id = target_user_id), '')
  ), 'sha256'), 'hex')
  from public.profiles p
  join lateral (
    select latest.* from public.membership_deactivation_consequences latest
    where latest.profile_id = p.id and latest.community_id = p.community_id
    order by latest.deactivation_sequence desc limit 1
  ) c on true
  where p.id = target_user_id and p.community_id = target_community_id
$$;


ALTER FUNCTION "public"."reactivation_state_version"("target_user_id" "uuid", "target_community_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reassign_group_custodian"("target_supply_id" "uuid", "new_custodian_id" "uuid") RETURNS "public"."supplies"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  updated public.supplies;
begin
  if not exists (
    select 1 from public.supplies s where s.id = target_supply_id and s.ownership_kind = 'group'
  ) then raise exception 'group listing required'; end if;
  select * into updated from public.set_supply_contact(target_supply_id, new_custodian_id);
  return updated;
end;
$$;


ALTER FUNCTION "public"."reassign_group_custodian"("target_supply_id" "uuid", "new_custodian_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reassign_loan_handoff"("target_loan_id" "uuid", "target_handoff_user_id" "uuid") RETURNS "public"."gear_loans"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare relation_community uuid; relation_supply uuid; loan public.gear_loans%rowtype;
  item public.supplies%rowtype; updated public.gear_loans;
begin
  if target_loan_id is null or target_handoff_user_id is null then raise exception 'complete handoff reassignment required'; end if;
  select gl.community_id, gl.supply_id into relation_community, relation_supply
  from public.gear_loans gl where gl.id = target_loan_id;
  if not found then raise exception 'active group loan handoff required'; end if;
  perform public.lock_community_authorization(relation_community, false);
  perform public.lock_listing(relation_supply);
  select * into loan from public.gear_loans gl where gl.id = target_loan_id for update;
  select * into item from public.supplies s where s.id = relation_supply for update;
  if loan.status not in ('approved', 'checked_out') or item.id is null
    or item.ownership_kind <> 'group' or loan.handoff_contact_id is null
    or not public.is_active_member(loan.community_id)
    or (auth.uid() <> loan.handoff_contact_id and not public.is_active_administrator(loan.community_id)) then
    raise exception 'active group loan handoff required';
  end if;
  if target_handoff_user_id = loan.handoff_contact_id then raise exception 'replacement handoff must be different'; end if;
  if not public.valid_group_handoff(loan.community_id, target_handoff_user_id) then
    raise exception 'active Custodian or Administrator handoff contact required';
  end if;
  perform set_config('app.loan_handoff_change', 'allowed', true);
  update public.gear_loans set handoff_contact_id = target_handoff_user_id
  where id = loan.id and handoff_contact_id = loan.handoff_contact_id
  returning * into updated;
  perform set_config('app.loan_handoff_change', '', true);
  if not found then raise exception 'loan handoff changed concurrently'; end if;
  insert into public.loan_handoff_audit
    (community_id, loan_id, prior_handoff_id, next_handoff_id, changed_by)
  values
    (loan.community_id, loan.id, loan.handoff_contact_id, target_handoff_user_id, auth.uid());
  return updated;
end;
$$;


ALTER FUNCTION "public"."reassign_loan_handoff"("target_loan_id" "uuid", "target_handoff_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."redact_expired_membership_answers"("batch_limit" integer DEFAULT 100) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare changed integer;
begin
  if batch_limit is null or batch_limit not between 1 and 500 then raise exception 'invalid redaction batch limit'; end if;
  with expired as (
    select a.id from public.membership_applications a
    join public.profiles p on p.id = a.applicant_id
    where a.redacted_at is null and (
      a.submitted_at < now() - interval '90 days'
      or (p.membership_status in ('active', 'rejected', 'deactivated') and a.decided_at < now() - interval '30 days')
    ) order by a.submitted_at, a.id limit batch_limit for update of a skip locked
  )
  update public.membership_applications a
  set answer_snapshot = '[]'::jsonb, redacted_at = now()
  from expired where a.id = expired.id;
  get diagnostics changed = row_count;
  return changed;
end;
$$;


ALTER FUNCTION "public"."redact_expired_membership_answers"("batch_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."redact_expired_notification_data"("batch_limit" integer DEFAULT 100) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "lock_timeout" TO '3s'
    SET "statement_timeout" TO '20s'
    AS $$
declare changed integer := 0; rows_changed integer;
  stale_claim record;
begin
  if batch_limit is null or batch_limit not between 1 and 500 then
    raise exception 'bounded notification retention batch required';
  end if;
  perform set_config('app.notification_internal_change', 'allowed', true);
  with doomed as (
    select n.id from public.private_notifications n
    where n.occurred_at < clock_timestamp() - interval '365 days'
      or (n.dismissed_at is not null and n.dismissed_at < clock_timestamp() - interval '30 days')
    order by coalesce(n.dismissed_at, n.occurred_at), n.id
    limit batch_limit for update skip locked
  ) delete from public.private_notifications n where n.id in (select id from doomed);
  get diagnostics rows_changed = row_count; changed := changed + rows_changed;

  for stale_claim in
    select x.id, x.attempt_count
    from public.transactional_email_outbox x
    where x.status = 'claimed' and x.claimed_at < clock_timestamp() - interval '10 minutes'
    order by x.claimed_at, x.id limit batch_limit for update skip locked
  loop
    update public.transactional_email_outbox o
    set status = 'ambiguous', terminal_at = clock_timestamp(),
        claimed_at = null, claimed_by = null, claim_token = null,
        next_attempt_at = null, updated_at = clock_timestamp()
    where o.id = stale_claim.id;
    insert into public.notification_delivery_attempts
      (outbox_id, attempt_number, outcome, error_code, occurred_at)
    values
      (stale_claim.id, stale_claim.attempt_count, 'ambiguous', 'network_ambiguous', clock_timestamp())
    on conflict on constraint notification_delivery_attempts_outbox_id_attempt_number_key do nothing;
    changed := changed + 1;
  end loop;
  update public.transactional_email_outbox o
  set status = 'permanent_failure', terminal_at = clock_timestamp(),
      next_attempt_at = null, updated_at = clock_timestamp()
  where o.id in (
    select x.id from public.transactional_email_outbox x
    where x.status in ('pending', 'retry')
      and x.created_at < clock_timestamp() - interval '24 hours'
    order by x.created_at, x.id limit batch_limit for update skip locked
  );
  get diagnostics rows_changed = row_count; changed := changed + rows_changed;

  with stale as (
    select o.id from public.transactional_email_outbox o
    where o.terminal_at < clock_timestamp() - interval '90 days' and o.redacted_at is null
    order by o.terminal_at, o.id limit batch_limit for update skip locked
  ) update public.transactional_email_outbox o
    set payload = '{}'::jsonb, email_snapshot = null, delivery_tag = null,
        provider_message_id = null, notification_id = null,
        redacted_at = clock_timestamp(), updated_at = clock_timestamp()
    where o.id in (select id from stale);
  get diagnostics rows_changed = row_count; changed := changed + rows_changed;

  delete from public.ses_feedback_events f where f.id in (
    select x.id from public.ses_feedback_events x
    where x.created_at < clock_timestamp() - interval '90 days'
    order by x.created_at, x.id limit batch_limit for update skip locked
  );
  get diagnostics rows_changed = row_count; changed := changed + rows_changed;
  delete from public.notification_delivery_attempts a where a.id in (
    select x.id from public.notification_delivery_attempts x
    join public.transactional_email_outbox o on o.id = x.outbox_id
    where o.terminal_at < clock_timestamp() - interval '90 days'
    order by x.occurred_at, x.id limit batch_limit for update of x skip locked
  );
  get diagnostics rows_changed = row_count; changed := changed + rows_changed;
  perform set_config('app.notification_internal_change', '', true);
  return changed;
end;
$$;


ALTER FUNCTION "public"."redact_expired_notification_data"("batch_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_ai_evidence_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin raise exception 'AI activation and price evidence is immutable'; end;
$$;


ALTER FUNCTION "public"."reject_ai_evidence_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_m7_immutable_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  raise exception 'Milestone 7 history is immutable';
end;
$$;


ALTER FUNCTION "public"."reject_m7_immutable_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reopen_wanted_request"("target_request_id" "uuid", "supplied_expected_version" bigint) RETURNS "public"."wanted_requests"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare item public.wanted_requests%rowtype;
begin
  select * into item from public.wanted_requests r where r.id = target_request_id;
  if not found then raise exception 'wanted request unavailable'; end if;
  perform public.lock_community_authorization(item.community_id, false);
  perform pg_advisory_xact_lock(hashtextextended('wanted-limit:' || item.community_id::text || ':' || auth.uid()::text, 0));
  select * into item from public.wanted_requests r where r.id = target_request_id for update;
  if not found or not public.is_active_member(item.community_id) or item.requester_id <> auth.uid()
    or item.status <> 'closed' or item.closure_kind <> 'voluntary'
    or item.transition_version is distinct from supplied_expected_version then
    raise exception 'reopenable current wanted request required';
  end if;
  if (select count(*) from public.wanted_requests r where r.community_id = item.community_id
      and r.requester_id = auth.uid() and r.status = 'open') >= 10 then
    raise exception 'at most ten open wanted requests are allowed';
  end if;
  update public.wanted_requests set status = 'open', closure_kind = null,
    transition_version = transition_version + 1, updated_at = clock_timestamp()
  where id = item.id returning * into item;
  return item;
end;
$$;


ALTER FUNCTION "public"."reopen_wanted_request"("target_request_id" "uuid", "supplied_expected_version" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_gear_loan"("target_supply_id" "uuid", "requested_quantity" integer, "requested_start" "date", "requested_end" "date", "supplied_note" "text" DEFAULT NULL::"text") RETURNS "public"."gear_loans"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select public.request_gear_loan(
    target_supply_id, requested_quantity, requested_start, requested_end,
    supplied_note, null::bigint, false
  )
$$;


ALTER FUNCTION "public"."request_gear_loan"("target_supply_id" "uuid", "requested_quantity" integer, "requested_start" "date", "requested_end" "date", "supplied_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_gear_loan"("target_supply_id" "uuid", "requested_quantity" integer, "requested_start" "date", "requested_end" "date", "supplied_note" "text", "supplied_guideline_version" bigint, "supplied_guidelines_accepted" boolean) RETURNS "public"."gear_loans"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  listing_community uuid;
  item public.supplies%rowtype;
  current_rules text[] := '{}'::text[];
  created public.gear_loans;
begin
  if caller_id is null then raise exception 'authentication required'; end if;
  select s.community_id into listing_community from public.supplies s where s.id = target_supply_id;
  if not found then raise exception 'listed same-community gear required'; end if;
  perform public.lock_community_authorization(listing_community, false);
  perform public.lock_listing(target_supply_id);
  select * into item from public.supplies s where s.id = target_supply_id for update;
  if not found or item.community_id <> listing_community or not public.is_active_member(item.community_id)
    or item.listing_status <> 'listed' then raise exception 'listing is not available for requests'; end if;
  if item.ownership_kind = 'individual' and not exists (
    select 1 from public.profiles p where p.id = item.owner_id and p.membership_status = 'active'
  ) then raise exception 'inactive-owner individual gear cannot accept requests'; end if;
  if item.ownership_kind = 'individual' and item.owner_id = caller_id then
    raise exception 'individual owners cannot borrow their own gear';
  end if;
  if requested_quantity is null or requested_quantity <= 0 or requested_quantity > item.quantity_total then
    raise exception 'quantity must be a positive whole number no greater than total stock';
  end if;
  if requested_start is null or requested_end is null or requested_end < requested_start then
    raise exception 'valid inclusive start and end dates are required';
  end if;
  if supplied_note is not null and nullif(btrim(supplied_note), '') is not null
    and not public.valid_plain_text(btrim(supplied_note), 1000, false) then
    raise exception 'invalid borrower note';
  end if;
  if item.guideline_version > 0 then
    select v.rules into strict current_rules from public.supply_guideline_versions v
      where v.supply_id = item.id and v.version = item.guideline_version;
  end if;
  if cardinality(current_rules) = 0 then
    if coalesce(supplied_guidelines_accepted, false) or supplied_guideline_version is not null then
      raise exception 'no borrowing guidelines require acceptance';
    end if;
  elsif supplied_guideline_version is distinct from item.guideline_version
    or supplied_guidelines_accepted is distinct from true then
    raise exception 'current borrowing guidelines must be reviewed and accepted';
  end if;
  insert into public.gear_loans (
    community_id, supply_id, borrower_id, custodian_at_request_id,
    quantity, start_date, end_date, borrower_note
  ) values (
    item.community_id, item.id, caller_id, item.custodian_id,
    requested_quantity, requested_start, requested_end, nullif(btrim(supplied_note), '')
  ) returning * into created;
  if cardinality(current_rules) > 0 then
    insert into public.gear_loan_guideline_acceptances
      (community_id, loan_id, supply_id, guideline_version, rules, accepted_by)
    values (item.community_id, created.id, item.id, item.guideline_version, current_rules, caller_id);
  end if;
  return created;
end;
$$;


ALTER FUNCTION "public"."request_gear_loan"("target_supply_id" "uuid", "requested_quantity" integer, "requested_start" "date", "requested_end" "date", "supplied_note" "text", "supplied_guideline_version" bigint, "supplied_guidelines_accepted" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reserve_ai_drafting_attempt"("target_user_id" "uuid", "supplied_attempt_id" "uuid", "supplied_mode" "text", "supplied_candidate_count" integer, "supplied_image_count" integer) RETURNS TABLE("attempt_id" "uuid", "model" "text", "service_tier" "text", "reserved_microdollars" bigint, "attempt_status" "public"."ai_draft_attempt_status")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  caller_id uuid := target_user_id;
  caller_community uuid;
  authz record;
  price public.ai_model_price_snapshots%rowtype;
  existing public.ai_draft_attempts%rowtype;
  reserve_cost bigint;
  minute_start timestamptz := date_trunc('minute', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  day_start timestamptz := date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  month_start timestamptz := date_trunc('month', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
begin
  if (select auth.role()) <> 'service_role' then raise exception 'service role required'; end if;
  if caller_id is null or supplied_attempt_id is null or supplied_mode not in ('single','bulk')
    or supplied_candidate_count not between 1 and 10
    or supplied_image_count not between 1 and 10
    or (supplied_mode = 'single' and (supplied_candidate_count <> 1 or supplied_image_count > 4))
    or (supplied_mode = 'bulk' and supplied_image_count <> supplied_candidate_count)
    then raise exception 'bounded AI attempt required'; end if;
  select p.community_id into caller_community from public.profiles p where p.id = caller_id;
  if caller_community is null then raise exception 'active member required'; end if;
  perform public.lock_community_authorization(caller_community, false);
  if not exists (select 1 from public.profiles p where p.id = caller_id
    and p.community_id = caller_community and p.membership_status = 'active') then
    raise exception 'active member required';
  end if;
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
    and e.secret_present and e.image_input_supported
    and e.structured_output_supported and e.data_controls_reviewed
    and e.dashboard_price_confirmed and e.evaluation_set_version = 'm8-v1'
    and e.evaluation_manifest_sha256 ~ '^[0-9a-f]{64}$'
    and e.evaluation_scores_sha256 ~ '^[0-9a-f]{64}$'
    and e.model_access_confirmed and e.evaluation_passed
    and e.reviewer_one_passed and e.reviewer_two_passed and e.overall_approved;
  if not coalesce(authz.enabled, false) then
    raise exception 'AI drafting is unavailable';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai-rate:' || caller_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('ai-budget:' || caller_community::text || ':' || month_start::text, 0));
  select * into existing from public.ai_draft_attempts a where a.id = supplied_attempt_id for update;
  if found then
    if existing.requester_id <> caller_id or existing.mode <> supplied_mode
      or existing.candidate_count <> supplied_candidate_count
      or existing.image_count <> supplied_image_count then raise exception 'AI attempt unavailable'; end if;
    if existing.status <> 'reserved' then raise exception 'AI attempt already used'; end if;
    return query select existing.id, existing.model, existing.service_tier, existing.reserved_microdollars, existing.status;
    return;
  end if;
  if (select count(*) from public.ai_draft_attempts a where a.requester_id = caller_id and a.created_at >= minute_start) >= 3
    or (select count(*) from public.ai_draft_attempts a where a.requester_id = caller_id and a.created_at >= day_start) >= 20 then
    raise exception 'AI drafting rate limit reached';
  end if;
  select * into strict price from public.ai_model_price_snapshots p where p.id = authz.price_snapshot_id and p.expires_at > clock_timestamp();
  reserve_cost := ceiling(((1000 + 5000 * supplied_image_count)::numeric * price.input_microdollars_per_million
    + (800 * supplied_candidate_count)::numeric * price.output_microdollars_per_million) / 1000000)::bigint;
  if reserve_cost > price.worst_case_microdollars_per_draft * supplied_candidate_count then
    raise exception 'AI price snapshot is inconsistent';
  end if;
  if (select coalesce(sum(a.reserved_units), 0) from public.ai_draft_attempts a where a.community_id = caller_community and a.created_at >= month_start) + supplied_candidate_count > 1000
    or (select coalesce(sum(case when a.usage_recognized and a.actual_microdollars is not null then a.actual_microdollars else a.reserved_microdollars end), 0)
        from public.ai_draft_attempts a where a.community_id = caller_community and a.created_at >= month_start) + reserve_cost > 5000000 then
    raise exception 'AI drafting monthly ceiling reached';
  end if;
  perform set_config('app.ai_attempt_internal', 'allowed', true);
  insert into public.ai_draft_attempts (
    id, community_id, requester_id, activation_evidence_id, price_snapshot_id,
    model, service_tier, mode, detail, candidate_count, image_count, reserved_units, reserved_microdollars
  ) values (
    supplied_attempt_id, caller_community, caller_id, authz.activation_evidence_id,
    authz.price_snapshot_id, authz.model, authz.service_tier, supplied_mode, 'low',
    supplied_candidate_count, supplied_image_count, supplied_candidate_count, reserve_cost
  ) returning * into existing;
  perform set_config('app.ai_attempt_internal', '', true);
  return query select existing.id, existing.model, existing.service_tier, existing.reserved_microdollars, existing.status;
end;
$_$;


ALTER FUNCTION "public"."reserve_ai_drafting_attempt"("target_user_id" "uuid", "supplied_attempt_id" "uuid", "supplied_mode" "text", "supplied_candidate_count" integer, "supplied_image_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restore_wanted_request"("target_request_id" "uuid", "supplied_expected_version" bigint, "supplied_target_status" "public"."wanted_request_status", "supplied_reason" "text") RETURNS "public"."wanted_requests"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare req public.wanted_requests%rowtype;
begin
  select * into req from public.wanted_requests r where r.id = target_request_id;
  if not found then raise exception 'wanted request unavailable'; end if;
  perform public.lock_community_authorization(req.community_id, true);
  select * into req from public.wanted_requests r where r.id = target_request_id for update;
  if not public.is_active_administrator(req.community_id) or req.status <> 'moderated'
    or req.transition_version is distinct from supplied_expected_version
    or supplied_target_status not in ('open','closed')
    or not public.valid_plain_text(btrim(supplied_reason), 500, false) then
    raise exception 'restorable request, target, and reason required';
  end if;
  if supplied_target_status = 'open' then
    perform pg_advisory_xact_lock(hashtextextended('wanted-limit:' || req.community_id::text || ':' || req.requester_id::text, 0));
    if (select count(*) from public.wanted_requests r where r.community_id = req.community_id
        and r.requester_id = req.requester_id and r.status = 'open') >= 10 then
      raise exception 'at most ten open wanted requests are allowed';
    end if;
  end if;
  update public.wanted_requests set status = supplied_target_status,
    closure_kind = case when supplied_target_status = 'closed' then 'moderation_restore' else null end,
    transition_version = transition_version + 1, updated_at = clock_timestamp()
  where id = req.id returning * into req;
  insert into public.wanted_request_moderation_audit
    (community_id, request_id, prior_status, next_status, reason, actor_user_id)
  values (req.community_id, req.id, 'moderated', supplied_target_status, btrim(supplied_reason), auth.uid());
  perform public.emit_wanted_notification('wanted_request_restored', req.id, req.transition_version,
    req.community_id, array[req.requester_id], true);
  return req;
end;
$$;


ALTER FUNCTION "public"."restore_wanted_request"("target_request_id" "uuid", "supplied_expected_version" bigint, "supplied_target_status" "public"."wanted_request_status", "supplied_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."retire_supply"("target_supply_id" "uuid") RETURNS "public"."supplies"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  listing_community uuid;
  item public.supplies%rowtype;
  owner_is_active boolean;
  updated public.supplies;
begin
  if caller_id is null then raise exception 'authentication required'; end if;
  select s.community_id into listing_community from public.supplies s where s.id = target_supply_id;
  if not found then raise exception 'listing unavailable'; end if;
  perform public.lock_community_authorization(listing_community, false);
  perform public.lock_listing(target_supply_id);
  select * into item from public.supplies where id = target_supply_id for update;
  if not found or not public.is_active_member(item.community_id) then raise exception 'listing unavailable'; end if;
  if item.listing_status = 'retired' then raise exception 'listing is already retired'; end if;

  if item.ownership_kind = 'individual' then
    select p.membership_status = 'active' into owner_is_active from public.profiles p where p.id = item.owner_id;
    if coalesce(owner_is_active, false) then
      if item.owner_id <> caller_id then raise exception 'active individual owner required'; end if;
    elsif not public.is_active_administrator(item.community_id) then
      raise exception 'administrator required for inactive-owner individual gear';
    end if;
  elsif not public.is_active_inventory_manager(item.community_id) then
    raise exception 'inventory manager required for group gear';
  end if;

  update public.supplies
  set listing_status = 'retired', retired_at = now()
  where id = item.id returning * into updated;
  return updated;
end;
$$;


ALTER FUNCTION "public"."retire_supply"("target_supply_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."return_gear_loan"("target_loan_id" "uuid") RETURNS "public"."gear_loans"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select public.return_gear_loan(target_loan_id, false, null)
$$;


ALTER FUNCTION "public"."return_gear_loan"("target_loan_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."return_gear_loan"("target_loan_id" "uuid", "mark_needs_attention" boolean, "supplied_attention_reason" "text") RETURNS "public"."gear_loans"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare relation_community uuid; relation_supply uuid; request public.gear_loans%rowtype;
  item public.supplies%rowtype; updated public.gear_loans;
  normalized_reason text := btrim(coalesce(supplied_attention_reason, ''));
  attention_version bigint;
begin
  if mark_needs_attention is null then raise exception 'return attention choice is required'; end if;
  if mark_needs_attention and not public.valid_plain_text(normalized_reason, 500, false) then
    raise exception 'reason must be 1-500 characters of bounded plain text';
  end if;
  if not mark_needs_attention and normalized_reason <> '' then
    raise exception 'attention reason requires Mark Needs Attention';
  end if;
  select gl.community_id, gl.supply_id into relation_community, relation_supply
  from public.gear_loans gl where gl.id = target_loan_id;
  if not found then raise exception 'checked-out loan and current authorized manager required'; end if;
  perform public.lock_community_authorization(relation_community, false);
  perform public.lock_listing(relation_supply);
  select * into request from public.gear_loans where id = target_loan_id for update;
  select * into item from public.supplies where id = relation_supply for update;
  if request.status <> 'checked_out' or item.id is null or request.supply_id <> item.id
      or not public.loan_manager_authorized(item, 'return') then
    raise exception 'checked-out loan and current authorized manager required';
  end if;
  if mark_needs_attention and not public.can_manage_supply_attention(item) then
    raise exception 'authorized return processor cannot set Needs Attention';
  end if;
  update public.gear_loans set status = 'returned', returned_by = auth.uid(), returned_at = now()
  where id = request.id and status = 'checked_out' returning * into updated;
  if not found then raise exception 'loan changed concurrently'; end if;
  if mark_needs_attention and not item.needs_attention then
    attention_version := item.needs_attention_version + 1;
    perform set_config('app.supply_attention_change', 'allowed', true);
    update public.supplies
    set needs_attention = true, needs_attention_reason = normalized_reason,
        needs_attention_version = attention_version
    where id = item.id;
    perform set_config('app.supply_attention_change', '', true);
    insert into public.supply_attention_audit
      (community_id, supply_id, version, prior_value, next_value, reason, changed_by, source_loan_id)
    values
      (item.community_id, item.id, attention_version, false, true,
       normalized_reason, auth.uid(), request.id);
  elsif mark_needs_attention then
    -- A hold set while the loan was checked out must never block its return.
    -- Preserve the existing version/reason rather than appending a false change.
    null;
  end if;
  return updated;
end;
$$;


ALTER FUNCTION "public"."return_gear_loan"("target_loan_id" "uuid", "mark_needs_attention" boolean, "supplied_attention_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."select_wanted_offer"("target_request_id" "uuid", "target_offer_id" "uuid", "supplied_expected_version" bigint) RETURNS "public"."wanted_requests"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare req public.wanted_requests%rowtype; offered public.wanted_offers%rowtype;
  item public.supplies%rowtype; other_offer public.wanted_offers%rowtype;
begin
  select * into offered from public.wanted_offers o where o.id = target_offer_id and o.request_id = target_request_id;
  if not found then raise exception 'selectable offer required'; end if;
  select * into req from public.wanted_requests r where r.id = target_request_id;
  if not found or req.community_id <> offered.community_id then raise exception 'selectable offer required'; end if;
  perform public.lock_community_authorization(req.community_id, false);
  perform public.lock_listing(offered.supply_id);
  select * into req from public.wanted_requests r where r.id = target_request_id for update;
  select * into offered from public.wanted_offers o where o.id = target_offer_id for update;
  select * into item from public.supplies s where s.id = offered.supply_id for update;
  if not public.is_active_member(req.community_id) or req.requester_id <> auth.uid()
    or req.status <> 'open' or req.transition_version is distinct from supplied_expected_version
    or offered.request_id <> req.id or offered.status <> 'active' or item.listing_status <> 'listed'
    or not public.user_has_listing_descriptive_authority(
      item.community_id, item.id, offered.offerer_id
    ) then
    raise exception 'selectable current offer required';
  end if;
  update public.wanted_offers set status = 'selected', transition_version = transition_version + 1,
    updated_at = clock_timestamp() where id = offered.id returning * into offered;
  update public.wanted_requests set status = 'fulfilled', selected_offer_id = offered.id,
    transition_version = transition_version + 1, updated_at = clock_timestamp()
    where id = req.id returning * into req;
  perform public.emit_wanted_notification('wanted_offer_selected', offered.id, offered.transition_version,
    offered.community_id, array[req.requester_id, offered.offerer_id], false);
  for other_offer in
    update public.wanted_offers set status = 'invalidated', transition_version = transition_version + 1,
      updated_at = clock_timestamp()
    where request_id = req.id and id <> offered.id and status = 'active'
    returning *
  loop
    perform public.emit_wanted_notification('wanted_offer_invalidated', other_offer.id, other_offer.transition_version,
      other_offer.community_id, array[req.requester_id, other_offer.offerer_id], false);
  end loop;
  return req;
end;
$$;


ALTER FUNCTION "public"."select_wanted_offer"("target_request_id" "uuid", "target_offer_id" "uuid", "supplied_expected_version" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_access_level"("target_user_id" "uuid", "target_role" "public"."app_role") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  caller_community uuid;
  had_administrator boolean;
  had_custodian boolean;
begin
  select p.community_id into caller_community
  from public.profiles p
  where p.id = caller_id;

  if caller_id is null or caller_community is null then
    raise exception 'active administrator required';
  end if;

  perform public.lock_community_authorization(caller_community, true);

  if not public.is_active_administrator(caller_community) then
    raise exception 'active administrator required';
  end if;
  if target_role is null or target_role not in ('member', 'custodian', 'steward') then
    raise exception 'unsupported access level';
  end if;
  if not exists (
    select 1
    from public.profiles p
    where p.id = target_user_id
      and p.community_id = caller_community
      and p.membership_status = 'active'
    for update
  ) then
    raise exception 'active same-community target required';
  end if;

  select
    coalesce(bool_or(r.role = 'steward'), false),
    coalesce(bool_or(r.role = 'custodian'), false)
  into had_administrator, had_custodian
  from public.community_roles r
  where r.community_id = caller_community
    and r.user_id = target_user_id
    and r.role in ('steward', 'custodian');

  if had_administrator and target_role <> 'steward' and (
    select count(*)
    from public.community_roles r
    join public.profiles p
      on p.id = r.user_id and p.community_id = r.community_id
    where r.community_id = caller_community
      and r.role = 'steward'
      and p.membership_status = 'active'
  ) <= 1 then
    raise exception 'cannot remove the last active administrator';
  end if;

  -- Every active profile retains its base member row. Elevated roles are
  -- mutually exclusive after this operation, including legacy dual-role rows.
  delete from public.community_roles
  where community_id = caller_community
    and user_id = target_user_id
    and role in ('steward', 'custodian');

  if target_role <> 'member' then
    insert into public.community_roles (community_id, user_id, role, granted_by)
    values (caller_community, target_user_id, target_role, caller_id);
  end if;

  if had_administrator and target_role <> 'steward' then
    insert into public.role_audit (community_id, target_user_id, role, action, actor_user_id)
    values (caller_community, target_user_id, 'steward', 'demote', caller_id);
  end if;
  if had_custodian and target_role <> 'custodian' then
    insert into public.role_audit (community_id, target_user_id, role, action, actor_user_id)
    values (caller_community, target_user_id, 'custodian', 'demote', caller_id);
  end if;
  if target_role = 'steward' and not had_administrator then
    insert into public.role_audit (community_id, target_user_id, role, action, actor_user_id)
    values (caller_community, target_user_id, 'steward', 'promote', caller_id);
  elsif target_role = 'custodian' and not had_custodian then
    insert into public.role_audit (community_id, target_user_id, role, action, actor_user_id)
    values (caller_community, target_user_id, 'custodian', 'promote', caller_id);
  end if;
end;
$$;


ALTER FUNCTION "public"."set_access_level"("target_user_id" "uuid", "target_role" "public"."app_role") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_administrator_email_suppression"("target_user_id" "uuid", "supplied_suppressed" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  caller_community uuid := public.current_active_community_id();
  target_email text;
  active_reason text;
begin
  if caller_community is null or not public.is_active_administrator(caller_community)
    or supplied_suppressed is null then raise exception 'active administrator required'; end if;
  perform public.lock_community_authorization(caller_community, true);
  perform 1 from public.profiles p where p.id = target_user_id and p.community_id = caller_community for update;
  select lower(btrim(u.email::text)) into target_email
  from public.profiles p join auth.users u on u.id = p.id
  where p.id = target_user_id and p.community_id = caller_community
    and u.email_confirmed_at is not null and u.email is not null;
  if target_email is null then raise exception 'confirmed same-community email required'; end if;
  select s.reason into active_reason
  from public.transactional_email_suppressions s
  where s.recipient_user_id = target_user_id
    and s.normalized_email = target_email
    and s.cleared_at is null
  for update;
  if active_reason in ('immediate_permanent', 'permanent_bounce', 'complaint') then
    raise exception 'provider suppression cannot be changed by Administrator';
  end if;
  if (supplied_suppressed and active_reason = 'administrator')
    or (not supplied_suppressed and active_reason is null) then
    return;
  end if;
  perform set_config('app.notification_internal_change', 'allowed', true);
  if supplied_suppressed then
    active_reason := null;
    insert into public.transactional_email_suppressions
      (community_id, recipient_user_id, normalized_email, reason)
    values (caller_community, target_user_id, target_email, 'administrator')
    on conflict (recipient_user_id, normalized_email) do update
      set reason = 'administrator', source_outbox_id = null,
          updated_at = clock_timestamp(), cleared_at = null, cleared_by = null
      where public.transactional_email_suppressions.reason = 'administrator'
         or public.transactional_email_suppressions.cleared_at is not null
    returning reason into active_reason;
    if active_reason is distinct from 'administrator' then
      perform set_config('app.notification_internal_change', '', true);
      raise exception 'provider suppression cannot be changed by Administrator';
    end if;
    update public.transactional_email_outbox o
    set status = 'address_suppressed', terminal_at = clock_timestamp(),
        next_attempt_at = null, updated_at = clock_timestamp()
    where o.recipient_user_id = target_user_id and o.email_snapshot = target_email
      and o.status in ('pending', 'retry');
  else
    update public.transactional_email_suppressions s
    set cleared_at = clock_timestamp(), cleared_by = caller_id, updated_at = clock_timestamp()
    where s.recipient_user_id = target_user_id and s.normalized_email = target_email
      and s.reason = 'administrator' and s.cleared_at is null;
    if not found then raise exception 'active Administrator suppression required'; end if;
  end if;
  insert into public.transactional_email_suppression_audit
    (community_id, recipient_user_id, actor_user_id, action)
  values
    (caller_community, target_user_id, caller_id,
     case when supplied_suppressed then 'administrator_paused' else 'administrator_resumed' end);
  perform set_config('app.notification_internal_change', '', true);
  if supplied_suppressed then
    perform public.emit_private_notification(
      'email_delivery_suppressed', target_user_id::text, txid_current(),
      caller_community, target_user_id, '{"schema_version":1}'::jsonb,
      clock_timestamp()
    );
  end if;
end;
$$;


ALTER FUNCTION "public"."set_administrator_email_suppression"("target_user_id" "uuid", "supplied_suppressed" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_ai_drafting_enabled"("supplied_enabled" boolean, "expected_version" bigint) RETURNS TABLE("configuration_version" bigint, "ai_drafting_enabled" boolean, "already_reserved_requests" integer, "status_reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
      and e.secret_present and e.image_input_supported
      and e.structured_output_supported and e.data_controls_reviewed
      and e.dashboard_price_confirmed and e.evaluation_set_version = 'm8-v1'
      and e.evaluation_manifest_sha256 ~ '^[0-9a-f]{64}$'
      and e.evaluation_scores_sha256 ~ '^[0-9a-f]{64}$'
      and e.model_access_confirmed and e.evaluation_passed
      and e.reviewer_one_passed and e.reviewer_two_passed and e.overall_approved
    from public.ai_activation_evidence e
    join public.ai_model_price_snapshots p on p.id = e.price_snapshot_id
    where e.community_id = caller_community
    order by e.recorded_at desc, e.id desc
    limit 1
  ), false) into ready;
  if supplied_enabled and not ready then
    perform set_config('app.milestone_six_internal_change', 'allowed', true);
    insert into public.administrator_ai_setting_audit (community_id, actor_user_id, action, outcome, configuration_version)
    values (caller_community, caller_id, 'enable_requested', 'rejected_missing_gates', current_settings.current_version);
    perform set_config('app.milestone_six_internal_change', '', true);
    return query select current_settings.current_version, false, 0,
      'AI drafting remains disabled until current model, secret-presence, pricing, budget, evaluation, and activation evidence is recorded.'::text;
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
  insert into public.community_setting_versions (community_id, version, display_name, ai_drafting_enabled, changed_by)
  values (caller_community, next_version, current_settings.display_name, supplied_enabled, caller_id);
  update public.community_settings set current_version = next_version,
    ai_drafting_enabled = supplied_enabled, updated_by = caller_id, updated_at = clock_timestamp()
  where community_id = caller_community;
  insert into public.administrator_ai_setting_audit (community_id, actor_user_id, action, outcome, configuration_version)
  values (caller_community, caller_id, case when supplied_enabled then 'enable_requested' else 'disable_requested' end,
    case when supplied_enabled then 'enabled' else 'disabled' end, next_version);
  perform set_config('app.milestone_six_internal_change', '', true);
  return query select next_version, supplied_enabled, in_flight,
    case when supplied_enabled then 'AI drafting is enabled.'
      else 'AI drafting is disabled. Reserved requests already past authorization may finish; manual listing remains available.' end;
end;
$_$;


ALTER FUNCTION "public"."set_ai_drafting_enabled"("supplied_enabled" boolean, "expected_version" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_my_administrator_orientation"("supplied_registry_version" integer, "supplied_item_id" "text", "supplied_status" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "lock_timeout" TO '3s'
    SET "statement_timeout" TO '5s'
    AS $$
declare
  caller_id uuid := auth.uid();
  caller_community uuid := public.current_active_community_id();
  current_registry integer;
begin
  if caller_id is null or caller_community is null then raise exception 'active administrator required'; end if;
  perform public.lock_community_authorization(caller_community, false);
  if not public.is_active_administrator(caller_community) then raise exception 'active administrator required'; end if;
  select max(r.registry_version) into current_registry from public.administrator_orientation_registry r;
  if supplied_registry_version <> current_registry or supplied_status not in ('completed', 'dismissed')
     or not exists (select 1 from public.administrator_orientation_registry r where r.registry_version = current_registry and r.item_id = supplied_item_id)
    then raise exception 'current orientation item and status required'; end if;
  perform set_config('app.milestone_six_internal_change', 'allowed', true);
  insert into public.administrator_orientation_progress
    (community_id, administrator_id, registry_version, item_id, status)
  values (caller_community, caller_id, current_registry, supplied_item_id, supplied_status)
  on conflict (community_id, administrator_id, registry_version, item_id)
  do update set status = excluded.status, changed_at = now()
  where public.administrator_orientation_progress.status is distinct from excluded.status;
  perform set_config('app.milestone_six_internal_change', '', true);
end;
$$;


ALTER FUNCTION "public"."set_my_administrator_orientation"("supplied_registry_version" integer, "supplied_item_id" "text", "supplied_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_my_notification_read"("target_notification_id" "uuid", "supplied_read" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller_id uuid := auth.uid(); caller_community uuid := public.current_active_community_id();
begin
  if caller_id is null or caller_community is null or supplied_read is null then
    raise exception 'active member and explicit read state required';
  end if;
  perform set_config('app.notification_internal_change', 'allowed', true);
  update public.private_notifications n
  set read_at = case when supplied_read then coalesce(n.read_at, clock_timestamp()) else null end
  where n.id = target_notification_id and n.recipient_user_id = caller_id
    and n.community_id = caller_community and n.dismissed_at is null;
  if not found then
    perform set_config('app.notification_internal_change', '', true);
    raise exception 'notification unavailable';
  end if;
  perform set_config('app.notification_internal_change', '', true);
end;
$$;


ALTER FUNCTION "public"."set_my_notification_read"("target_notification_id" "uuid", "supplied_read" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_my_postal_code"("supplied_postal" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  caller_id uuid := auth.uid();
  caller_community uuid;
  normalized_postal text;
begin
  if octet_length(coalesce(supplied_postal, '')) > 40 then
    raise exception 'postal code input is too large';
  end if;
  normalized_postal := public.normalize_postal_code(supplied_postal);
  select p.community_id into caller_community from public.profiles p where p.id = caller_id;
  if caller_id is null or caller_community is null then raise exception 'active member required'; end if;
  perform public.lock_community_authorization(caller_community, false);
  if not public.is_active_member(caller_community) then raise exception 'active member required'; end if;

  if normalized_postal is null then
    delete from public.member_postal_codes
    where community_id = caller_community and profile_id = caller_id;
    return null;
  end if;
  if length(normalized_postal) not between 3 and 10
    or normalized_postal !~ '^[A-Z0-9]+(?:[ -][A-Z0-9]+)?$' then
    raise exception 'postal code must be one complete 3-10 character code';
  end if;

  insert into public.member_postal_codes (community_id, profile_id, postal_code)
  values (caller_community, caller_id, normalized_postal)
  on conflict (community_id, profile_id) do update
    set postal_code = excluded.postal_code, updated_at = now();
  return normalized_postal;
end;
$_$;


ALTER FUNCTION "public"."set_my_postal_code"("supplied_postal" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_steward"("target_user_id" "uuid", "make_steward" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if make_steward is null then
    raise exception 'make_steward is required';
  end if;
  perform public.set_access_level(
    target_user_id,
    case when make_steward then 'steward'::public.app_role else 'member'::public.app_role end
  );
end;
$$;


ALTER FUNCTION "public"."set_steward"("target_user_id" "uuid", "make_steward" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_supply_contact"("target_supply_id" "uuid", "new_contact_id" "uuid") RETURNS "public"."supplies"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  listing_community uuid;
  item public.supplies%rowtype;
  owner_is_active boolean;
  updated public.supplies;
begin
  select s.community_id into listing_community from public.supplies s where s.id = target_supply_id;
  if not found then raise exception 'listing unavailable'; end if;
  perform public.lock_community_authorization(listing_community, false);
  perform public.lock_listing(target_supply_id);
  select * into item from public.supplies where id = target_supply_id for update;
  if not found or item.listing_status = 'retired' or not public.is_active_member(item.community_id) then
    raise exception 'listing unavailable';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = new_contact_id and p.community_id = item.community_id and p.membership_status = 'active'
    for update
  ) then raise exception 'active same-community contact required'; end if;

  if item.ownership_kind = 'individual' then
    select p.membership_status = 'active' into owner_is_active from public.profiles p where p.id = item.owner_id;
    if not coalesce(owner_is_active, false) then raise exception 'inactive-owner individual gear cannot be changed'; end if;
    if item.owner_id <> caller_id and not public.is_active_inventory_manager(item.community_id) then
      raise exception 'individual owner or inventory manager required';
    end if;
  elsif not public.is_active_inventory_manager(item.community_id) then
    raise exception 'inventory manager required for group gear';
  end if;

  update public.supplies set custodian_id = new_contact_id where id = item.id returning * into updated;
  return updated;
end;
$$;


ALTER FUNCTION "public"."set_supply_contact"("target_supply_id" "uuid", "new_contact_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_supply_guidelines"("target_supply_id" "uuid", "supplied_expected_version" bigint, "supplied_rules" "text"[]) RETURNS TABLE("guideline_version" bigint, "rules" "text"[])
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  listing_community uuid;
  item public.supplies%rowtype;
  normalized text[];
  current_rules text[] := '{}'::text[];
  next_version bigint;
begin
  if caller_id is null or supplied_expected_version is null or supplied_expected_version < 0 then
    raise exception 'authenticated caller and expected guideline version required';
  end if;
  normalized := public.normalize_guideline_rules(supplied_rules);
  select s.community_id into listing_community from public.supplies s where s.id = target_supply_id;
  if not found then raise exception 'listing unavailable'; end if;
  perform public.lock_community_authorization(listing_community, false);
  perform public.lock_listing(target_supply_id);
  select * into item from public.supplies s where s.id = target_supply_id for update;
  if not found or item.community_id <> listing_community or not public.is_active_member(item.community_id)
    or item.listing_status = 'retired' then raise exception 'listing unavailable'; end if;
  if not public.user_has_listing_descriptive_authority(item.community_id, item.id, caller_id) then
    raise exception 'descriptive listing authority required';
  end if;
  if item.guideline_version is distinct from supplied_expected_version then
    raise exception 'borrowing guidelines changed; reload before saving';
  end if;
  if item.guideline_version > 0 then
    select v.rules into strict current_rules from public.supply_guideline_versions v
      where v.supply_id = item.id and v.version = item.guideline_version;
  end if;
  if current_rules = normalized then
    return query select item.guideline_version, current_rules;
    return;
  end if;
  next_version := item.guideline_version + 1;
  insert into public.supply_guideline_versions
    (community_id, supply_id, version, rules, changed_by)
  values (item.community_id, item.id, next_version, normalized, caller_id);
  update public.supplies set guideline_version = next_version, updated_at = clock_timestamp()
    where id = item.id;
  return query select next_version, normalized;
end;
$$;


ALTER FUNCTION "public"."set_supply_guidelines"("target_supply_id" "uuid", "supplied_expected_version" bigint, "supplied_rules" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_supply_image_paths"("target_supply_id" "uuid", "supplied_paths" "text"[]) RETURNS "public"."supplies"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  item public.supplies%rowtype;
  owner_is_active boolean;
  object_path text;
  updated public.supplies%rowtype;
begin
  perform public.lock_listing(target_supply_id);
  select * into item from public.supplies where id = target_supply_id for update;
  if not found or item.listing_status = 'retired' or not public.is_active_member(item.community_id) then raise exception 'listing unavailable'; end if;
  if item.ownership_kind = 'individual' then
    select p.membership_status = 'active' into owner_is_active from public.profiles p where p.id = item.owner_id;
    if not coalesce(owner_is_active, false) or (item.owner_id <> auth.uid() and not public.is_active_inventory_manager(item.community_id)) then
      raise exception 'individual owner or inventory manager required';
    end if;
  elsif not public.is_active_inventory_manager(item.community_id) then raise exception 'inventory manager required for group media'; end if;
  if coalesce(cardinality(supplied_paths), 0) > 4 then raise exception 'at most four images are allowed'; end if;
  if (select count(*) from unnest(coalesce(supplied_paths, '{}')) as u(path)) <> (select count(distinct path) from unnest(coalesce(supplied_paths, '{}')) as u(path)) then
    raise exception 'image paths must be unique';
  end if;
  foreach object_path in array coalesce(supplied_paths, '{}') loop
    if object_path !~ ('^' || item.community_id::text || '/' || item.id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$') then
      raise exception 'image path must be a canonical listing-prefixed JPEG';
    end if;
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'gear-images'
        and o.name = object_path
        and o.metadata->>'mimetype' = 'image/jpeg'
        and o.metadata->>'size' ~ '^[0-9]+$'
        and (o.metadata->>'size')::numeric <= 2097152
    ) then
      raise exception 'bounded sanitized JPEG object required';
    end if;
    if not object_path = any(coalesce(item.image_paths, '{}'))
       and not exists (
         select 1 from public.gear_media_upload_attempts a
         where a.supply_id = item.id
           and a.final_path = object_path
           and a.status = 'complete'
       ) then
      raise exception 'sanitized upload receipt required';
    end if;
  end loop;
  update public.supplies set image_paths = coalesce(supplied_paths, '{}') where id = item.id returning * into updated;
  return updated;
end;
$_$;


ALTER FUNCTION "public"."set_supply_image_paths"("target_supply_id" "uuid", "supplied_paths" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_supply_needs_attention"("target_supply_id" "uuid", "supplied_value" boolean, "supplied_reason" "text") RETURNS "public"."supplies"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  relation_community uuid;
  item public.supplies%rowtype;
  normalized_reason text := btrim(coalesce(supplied_reason, ''));
  updated public.supplies;
begin
  if target_supply_id is null or supplied_value is null then raise exception 'complete Needs Attention change required'; end if;
  if not public.valid_plain_text(normalized_reason, 500, false) then
    raise exception 'reason must be 1-500 characters of bounded plain text';
  end if;
  select s.community_id into relation_community from public.supplies s where s.id = target_supply_id;
  if not found then raise exception 'authorized listing required'; end if;
  perform public.lock_community_authorization(relation_community, false);
  perform public.lock_listing(target_supply_id);
  select * into item from public.supplies s where s.id = target_supply_id for update;
  if item.id is null or item.community_id <> relation_community
    or item.listing_status = 'retired' or not public.can_manage_supply_attention(item) then
    raise exception 'authorized listing required';
  end if;
  if item.needs_attention = supplied_value then raise exception 'Needs Attention state is unchanged'; end if;
  perform set_config('app.supply_attention_change', 'allowed', true);
  update public.supplies
  set needs_attention = supplied_value,
      needs_attention_reason = case when supplied_value then normalized_reason else null end,
      needs_attention_version = needs_attention_version + 1
  where id = item.id
  returning * into updated;
  perform set_config('app.supply_attention_change', '', true);
  insert into public.supply_attention_audit
    (community_id, supply_id, version, prior_value, next_value, reason, changed_by)
  values
    (item.community_id, item.id, updated.needs_attention_version,
     item.needs_attention, supplied_value, normalized_reason, auth.uid());
  return updated;
end;
$$;


ALTER FUNCTION "public"."set_supply_needs_attention"("target_supply_id" "uuid", "supplied_value" boolean, "supplied_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_join_application"("supplied_version_id" "uuid", "supplied_answers" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  caller_id uuid := auth.uid();
  caller_community uuid;
  current_version public.join_question_versions%rowtype;
  snapshot jsonb;
  result uuid;
begin
  if caller_id is null or supplied_version_id is null or supplied_answers is null
    or octet_length(coalesce(supplied_answers::text, '')) > 13000
    or jsonb_typeof(supplied_answers) <> 'object' then
    raise exception 'invalid membership application';
  end if;
  select p.community_id into caller_community
  from public.profiles p
  join auth.users u on u.id = p.id and u.email_confirmed_at is not null
  where p.id = caller_id and p.membership_status = 'pending';
  if caller_community is null then raise exception 'confirmed pending applicant required'; end if;
  perform public.lock_community_authorization(caller_community, false);
  if not exists (
    select 1 from public.profiles p join auth.users u on u.id = p.id and u.email_confirmed_at is not null
    where p.id = caller_id and p.community_id = caller_community and p.membership_status = 'pending'
  ) then raise exception 'confirmed pending applicant required'; end if;
  select * into current_version from public.join_question_versions q
  where q.community_id = caller_community and q.is_current for share;
  if current_version.id is distinct from supplied_version_id then
    raise exception 'join questions changed; refresh and review the current questions';
  end if;
  if exists (select 1 from jsonb_object_keys(supplied_answers) key where key !~ '^q[1-3]$')
    or exists (
      select 1 from jsonb_object_keys(supplied_answers) key
      where not exists (select 1 from jsonb_array_elements(current_version.questions) q where q ->> 'id' = key)
    ) then raise exception 'invalid membership application'; end if;
  if exists (
    select 1 from jsonb_array_elements(current_version.questions) q
    where (q ->> 'required')::boolean and length(btrim(coalesce(supplied_answers ->> (q ->> 'id'), ''))) = 0
  ) then raise exception 'required join answer is missing'; end if;
  if exists (
    select 1 from jsonb_array_elements(current_version.questions) q
    where supplied_answers ? (q ->> 'id') and (
      jsonb_typeof(supplied_answers -> (q ->> 'id')) <> 'string'
      or not public.valid_plain_text(supplied_answers ->> (q ->> 'id'), 1000, not (q ->> 'required')::boolean)
    )
  ) then raise exception 'invalid join answer'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q ->> 'id', 'prompt', q ->> 'prompt', 'required', (q ->> 'required')::boolean,
    'answer', coalesce(supplied_answers ->> (q ->> 'id'), '')
  ) order by position), '[]'::jsonb) into snapshot
  from jsonb_array_elements(current_version.questions) with ordinality entry(q, position);
  insert into public.membership_applications (
    community_id, applicant_id, question_version_id, answer_snapshot, answer_count
  ) values (caller_community, caller_id, current_version.id, snapshot, jsonb_array_length(snapshot))
  on conflict (applicant_id) do nothing
  returning id into result;
  if result is null then
    select a.id into result from public.membership_applications a
    where a.applicant_id = caller_id and a.decided_at is null and a.redacted_at is null
      and a.submitted_at >= now() - interval '90 days'
      and a.question_version_id = current_version.id and a.answer_snapshot = snapshot;
  end if;
  if result is null then
    update public.membership_applications a set
      question_version_id = current_version.id, answer_snapshot = snapshot,
      answer_count = jsonb_array_length(snapshot), submitted_at = now(),
      submission_count = submission_count + 1, redacted_at = null
    where a.applicant_id = caller_id and a.decided_at is null
      and (a.redacted_at is not null or a.submitted_at < now() - interval '90 days')
      and a.submission_count < 100
    returning a.id into result;
  end if;
  if result is null then raise exception 'a different membership application is already pending'; end if;
  return result;
end;
$_$;


ALTER FUNCTION "public"."submit_join_application"("supplied_version_id" "uuid", "supplied_answers" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_community_display_name"("supplied_name" "text", "expected_version" bigint) RETURNS TABLE("community_id" "uuid", "display_name" "text", "configuration_version" bigint, "ai_drafting_enabled" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    SET "lock_timeout" TO '3s'
    SET "statement_timeout" TO '5s'
    AS $$
declare
  caller_id uuid := auth.uid();
  caller_community uuid;
  normalized_name text := regexp_replace(btrim(supplied_name), '[[:space:]]+', ' ', 'g');
  current_settings public.community_settings%rowtype;
  next_version bigint;
begin
  if expected_version is null or expected_version <= 0 then raise exception 'positive expected settings version required'; end if;
  select p.community_id into caller_community from public.profiles p where p.id = caller_id;
  if caller_id is null or caller_community is null then raise exception 'active administrator required'; end if;
  perform public.lock_community_authorization(caller_community, true);
  if not public.is_active_administrator(caller_community) then raise exception 'active administrator required'; end if;
  if not public.valid_plain_text(normalized_name, 80) then raise exception 'invalid community display name'; end if;
  select * into current_settings from public.community_settings s where s.community_id = caller_community for update;
  if current_settings.current_version is distinct from expected_version then raise exception 'community settings changed; reload before saving'; end if;
  if current_settings.display_name = normalized_name then
    return query select caller_community, current_settings.display_name, current_settings.current_version, current_settings.ai_drafting_enabled;
    return;
  end if;
  next_version := current_settings.current_version + 1;
  perform set_config('app.milestone_six_internal_change', 'allowed', true);
  insert into public.community_setting_versions
    (community_id, version, display_name, ai_drafting_enabled, changed_by)
  values (caller_community, next_version, normalized_name, current_settings.ai_drafting_enabled, caller_id);
  update public.community_settings s
  set current_version = next_version, display_name = normalized_name,
      updated_by = caller_id, updated_at = now()
  where s.community_id = caller_community;
  update public.communities set name = normalized_name where id = caller_community;
  perform set_config('app.milestone_six_internal_change', '', true);
  return query select caller_community, normalized_name, next_version, current_settings.ai_drafting_enabled;
end;
$$;


ALTER FUNCTION "public"."update_community_display_name"("supplied_name" "text", "expected_version" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_my_profile_settings"("supplied_display_name" "text", "supplied_introduction" "text", "supplied_phone_e164" "text", "supplied_coordination_note" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  caller_id uuid := auth.uid();
  caller_community uuid := public.current_active_community_id();
  normalized_name text := regexp_replace(btrim(coalesce(supplied_display_name, '')), '[[:space:]]+', ' ', 'g');
  normalized_intro text := nullif(btrim(supplied_introduction), '');
  normalized_phone text := nullif(btrim(supplied_phone_e164), '');
  normalized_note text := nullif(btrim(supplied_coordination_note), '');
begin
  if caller_id is null or caller_community is null then raise exception 'active member required'; end if;
  perform public.lock_community_authorization(caller_community, false);
  if not public.is_active_member(caller_community) then raise exception 'active member required'; end if;
  perform 1 from public.profiles p where p.id = caller_id and p.community_id = caller_community for update;
  if supplied_display_name ~ '[[:cntrl:]]'
    or not public.valid_plain_text(normalized_name, 80)
    or (normalized_intro is not null and not public.valid_plain_text(normalized_intro, 500))
    or (normalized_note is not null and not public.valid_plain_text(normalized_note, 160))
    or (normalized_phone is not null and normalized_phone !~ '^\+[1-9][0-9]{7,14}$')
  then
    raise exception 'invalid profile settings';
  end if;
  update public.profiles set display_name = normalized_name where id = caller_id;
  insert into public.member_profile_settings (
    community_id, profile_id, introduction, phone_e164, coordination_note
  ) values (
    caller_community, caller_id, normalized_intro, normalized_phone, normalized_note
  ) on conflict (profile_id) do update set
    introduction = excluded.introduction, phone_e164 = excluded.phone_e164,
    coordination_note = excluded.coordination_note,
    updated_at = now();
end;
$_$;


ALTER FUNCTION "public"."update_my_profile_settings"("supplied_display_name" "text", "supplied_introduction" "text", "supplied_phone_e164" "text", "supplied_coordination_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_my_transactional_email_preferences"("supplied_loan_activity" boolean, "supplied_loan_reminders" boolean, "supplied_wanted_activity" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller_id uuid := auth.uid(); caller_community uuid := public.current_active_community_id();
begin
  if caller_id is null or caller_community is null
    or supplied_loan_activity is null or supplied_loan_reminders is null
    or supplied_wanted_activity is null then
    raise exception 'active member and complete preferences required';
  end if;
  perform public.lock_community_authorization(caller_community, false);
  perform 1 from public.profiles p where p.id = caller_id and p.community_id = caller_community for update;
  perform set_config('app.notification_internal_change', 'allowed', true);
  insert into public.transactional_email_preferences
    (community_id, profile_id, loan_activity, loan_reminders, wanted_activity)
  values
    (caller_community, caller_id, supplied_loan_activity, supplied_loan_reminders, supplied_wanted_activity)
  on conflict (profile_id) do update
    set loan_activity = excluded.loan_activity,
        loan_reminders = excluded.loan_reminders,
        wanted_activity = excluded.wanted_activity,
        updated_at = clock_timestamp();
  insert into public.transactional_email_preference_audit
    (community_id, profile_id, actor_user_id, loan_activity, loan_reminders, wanted_activity)
  values
    (caller_community, caller_id, caller_id, supplied_loan_activity, supplied_loan_reminders, supplied_wanted_activity);
  perform set_config('app.notification_internal_change', '', true);
end;
$$;


ALTER FUNCTION "public"."update_my_transactional_email_preferences"("supplied_loan_activity" boolean, "supplied_loan_reminders" boolean, "supplied_wanted_activity" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_supply"("target_supply_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_status" "public"."listing_status", "supplied_condition" "text") RETURNS "public"."supplies"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  listing_community uuid;
  item public.supplies%rowtype;
  owner_is_active boolean;
  caller_is_manager boolean;
  updated public.supplies;
begin
  if caller_id is null then raise exception 'authentication required'; end if;
  select s.community_id into listing_community from public.supplies s where s.id = target_supply_id;
  if not found then raise exception 'listing unavailable'; end if;
  perform public.lock_community_authorization(listing_community, false);
  perform public.lock_listing(target_supply_id);
  select * into item from public.supplies where id = target_supply_id for update;
  if not found or item.community_id <> listing_community or not public.is_active_member(item.community_id) then
    raise exception 'listing unavailable';
  end if;
  if item.listing_status = 'retired' then raise exception 'retired listings cannot be changed'; end if;
  if nullif(btrim(supplied_title), '') is null then raise exception 'title is required'; end if;
  if char_length(coalesce(supplied_description, '')) > 1000 then raise exception 'description is limited to 1000 characters'; end if;
  if not public.is_canonical_gear_category(supplied_category) then raise exception 'canonical category required'; end if;
  if not public.is_canonical_gear_condition(supplied_condition) then raise exception 'canonical condition required'; end if;
  if supplied_quantity is null or supplied_quantity <= 0 then raise exception 'quantity must be positive'; end if;
  if supplied_status is null then raise exception 'listing status is required'; end if;

  caller_is_manager := public.is_active_inventory_manager(item.community_id);
  if item.ownership_kind = 'individual' then
    select p.membership_status = 'active' into owner_is_active from public.profiles p where p.id = item.owner_id;
    if not coalesce(owner_is_active, false) then raise exception 'inactive-owner individual gear cannot be changed'; end if;
    if item.owner_id = caller_id then
      null;
    elsif caller_is_manager then
      if supplied_status is distinct from item.listing_status then
        raise exception 'individual availability is controlled by its owner';
      end if;
    else
      raise exception 'individual owner or inventory manager required';
    end if;
  elsif not caller_is_manager then
    raise exception 'inventory manager required for group gear';
  end if;

  if supplied_quantity < public.max_committed_quantity(item.id, '-infinity'::date, 'infinity'::date) then
    raise exception 'quantity conflicts with committed loans';
  end if;
  update public.supplies set
    title = btrim(supplied_title),
    description = coalesce(supplied_description, ''),
    category = supplied_category,
    condition = supplied_condition,
    quantity_total = supplied_quantity,
    listing_status = supplied_status
  where id = item.id returning * into updated;

  if item.condition is distinct from updated.condition then
    insert into public.supply_condition_history
      (community_id, supply_id, prior_condition, next_condition, changed_by)
    values (updated.community_id, updated.id, item.condition, updated.condition, caller_id);
  end if;
  return updated;
end;
$$;


ALTER FUNCTION "public"."update_supply"("target_supply_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_status" "public"."listing_status", "supplied_condition" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_supply_with_guidelines"("target_supply_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_status" "public"."listing_status", "supplied_condition" "text", "supplied_expected_guideline_version" bigint, "supplied_guidelines" "text"[]) RETURNS "public"."supplies"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare updated public.supplies;
begin
  updated := public.update_supply(
    target_supply_id, supplied_title, supplied_description, supplied_category,
    supplied_quantity, supplied_status, supplied_condition
  );
  perform public.set_supply_guidelines(
    target_supply_id, supplied_expected_guideline_version, supplied_guidelines
  );
  select * into strict updated from public.supplies s where s.id = target_supply_id;
  return updated;
end;
$$;


ALTER FUNCTION "public"."update_supply_with_guidelines"("target_supply_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_status" "public"."listing_status", "supplied_condition" "text", "supplied_expected_guideline_version" bigint, "supplied_guidelines" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_wanted_request"("target_request_id" "uuid", "supplied_expected_version" bigint, "supplied_title" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_start" "date" DEFAULT NULL::"date", "supplied_end" "date" DEFAULT NULL::"date", "supplied_note" "text" DEFAULT NULL::"text") RETURNS "public"."wanted_requests"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare item public.wanted_requests%rowtype; updated public.wanted_requests; normalized_title text;
begin
  if auth.uid() is null or supplied_expected_version is null or supplied_expected_version <= 0 then
    raise exception 'authenticated caller and expected version required';
  end if;
  select * into item from public.wanted_requests r where r.id = target_request_id;
  if not found then raise exception 'wanted request unavailable'; end if;
  perform public.lock_community_authorization(item.community_id, false);
  select * into item from public.wanted_requests r where r.id = target_request_id for update;
  if not found or not public.is_active_member(item.community_id) or item.requester_id <> auth.uid()
    or item.status <> 'open' or item.transition_version is distinct from supplied_expected_version then
    raise exception 'editable current wanted request required';
  end if;
  normalized_title := regexp_replace(btrim(supplied_title), '[[:space:]]+', ' ', 'g');
  if not public.validate_wanted_fields(
    normalized_title, supplied_category, supplied_quantity,
    supplied_start, supplied_end, nullif(btrim(supplied_note), '')
  ) then raise exception 'invalid wanted request'; end if;
  update public.wanted_requests set title = normalized_title, category = supplied_category,
    desired_quantity = supplied_quantity, desired_start = supplied_start, desired_end = supplied_end,
    note = nullif(btrim(supplied_note), ''), transition_version = transition_version + 1,
    updated_at = clock_timestamp()
  where id = item.id returning * into updated;
  return updated;
end;
$$;


ALTER FUNCTION "public"."update_wanted_request"("target_request_id" "uuid", "supplied_expected_version" bigint, "supplied_title" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_start" "date", "supplied_end" "date", "supplied_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_has_listing_descriptive_authority"("target_community_id" "uuid", "target_supply_id" "uuid", "target_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.supplies s
    join public.profiles p
      on p.community_id = s.community_id and p.id = target_user_id
    where s.community_id = target_community_id
      and s.id = target_supply_id
      and p.membership_status = 'active'
      and (
        (s.ownership_kind = 'individual' and s.owner_id = target_user_id)
        or (s.ownership_kind = 'group' and exists (
          select 1 from public.community_roles r
          where r.community_id = s.community_id
            and r.user_id = target_user_id
            and r.role in ('custodian', 'steward')
        ))
      )
  )
$$;


ALTER FUNCTION "public"."user_has_listing_descriptive_authority"("target_community_id" "uuid", "target_supply_id" "uuid", "target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."valid_group_handoff"("target_community_id" "uuid", "target_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.profiles p
    join public.community_roles r
      on r.community_id = p.community_id and r.user_id = p.id
    where p.id = target_user_id
      and p.community_id = target_community_id
      and p.membership_status = 'active'
      and r.role in ('custodian', 'steward')
  )
$$;


ALTER FUNCTION "public"."valid_group_handoff"("target_community_id" "uuid", "target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."valid_notification_payload"("supplied_event_type" "text", "supplied_payload" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
  select case
    when supplied_event_type = 'loan_weekly_overdue' then
      jsonb_typeof(supplied_payload) = 'object'
      and supplied_payload ?& array['schema_version', 'reminder_ordinal']
      and supplied_payload - array['schema_version', 'reminder_ordinal'] = '{}'::jsonb
      and supplied_payload -> 'schema_version' = '1'::jsonb
      and jsonb_typeof(supplied_payload -> 'reminder_ordinal') = 'number'
      and (supplied_payload ->> 'reminder_ordinal') ~ '^[1-3]$'
    else supplied_payload = '{"schema_version":1}'::jsonb
  end
$_$;


ALTER FUNCTION "public"."valid_notification_payload"("supplied_event_type" "text", "supplied_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."valid_plain_text"("value" "text", "maximum" integer, "allow_blank" boolean DEFAULT false) RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
  select value is not null
    and octet_length(value) <= maximum * 4
    and length(value) <= maximum
    and (allow_blank or length(btrim(value)) > 0)
    and value = btrim(value)
    and value !~ '[[:cntrl:]]'
    and value !~ '[‮‭‪‫‬⁦⁧⁨⁩]'
    and value !~ '[<>]'
    and value !~* '(https?://|ftps?://|mailto:|tel:|javascript:|data:|www\.|(^|[^[:alnum:]])[a-z0-9][a-z0-9-]*([.][a-z0-9-]+)*[.][a-z]{2,}([^[:alnum:]]|$))'
$_$;


ALTER FUNCTION "public"."valid_plain_text"("value" "text", "maximum" integer, "allow_blank" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_join_answer_snapshot"("value" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select jsonb_typeof(value) = 'array'
    and jsonb_array_length(value) between 0 and 3
    and not exists (
      select 1 from jsonb_array_elements(value) with ordinality a(item, position)
      where jsonb_typeof(item) <> 'object'
        or (select array_agg(key order by key) from jsonb_object_keys(item) key)
          <> array['answer', 'id', 'prompt', 'required']::text[]
        or jsonb_typeof(item -> 'id') <> 'string'
        or jsonb_typeof(item -> 'prompt') <> 'string'
        or jsonb_typeof(item -> 'answer') <> 'string'
        or item ->> 'id' <> 'q' || position::text
        or jsonb_typeof(item -> 'required') <> 'boolean'
        or not public.valid_plain_text(item ->> 'prompt', 200)
        or not public.valid_plain_text(item ->> 'answer', 1000, not (item ->> 'required')::boolean)
    )
$$;


ALTER FUNCTION "public"."validate_join_answer_snapshot"("value" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_join_questions"("value" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select jsonb_typeof(value) = 'array'
    and jsonb_array_length(value) between 0 and 3
    and not exists (
      select 1
      from jsonb_array_elements(value) with ordinality q(item, position)
      where jsonb_typeof(item) <> 'object'
        or (select array_agg(key order by key) from jsonb_object_keys(item) key)
          <> array['id', 'prompt', 'required']::text[]
        or jsonb_typeof(item -> 'id') <> 'string'
        or jsonb_typeof(item -> 'prompt') <> 'string'
        or item ->> 'id' <> 'q' || position::text
        or jsonb_typeof(item -> 'required') <> 'boolean'
        or not public.valid_plain_text(item ->> 'prompt', 200)
        or item ->> 'prompt' <> regexp_replace(btrim(item ->> 'prompt'), '[[:space:]]+', ' ', 'g')
    )
    and not exists (
      select 1 from jsonb_array_elements(value) with ordinality a(item, position)
      join jsonb_array_elements(value) with ordinality b(item, position)
        on lower(a.item ->> 'prompt') = lower(b.item ->> 'prompt') and a.position <> b.position
    )
$$;


ALTER FUNCTION "public"."validate_join_questions"("value" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_m6_legacy_deactivation_manifest"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if exists (
    select 1 from public.profiles p
    left join public.legacy_deactivation_backfill_manifest m on m.profile_id = p.id and m.community_id = p.community_id
    where p.membership_status = 'deactivated' and m.profile_id is null
  ) or exists (
    select 1 from public.legacy_deactivation_backfill_manifest m
    join public.profiles p on p.id = m.profile_id
    where p.membership_status <> 'deactivated' or p.community_id <> m.community_id
  ) then
    raise exception 'milestone 6 preflight: every pre-existing deactivated profile requires one exact reviewed predecessor-manifest row';
  end if;
end;
$$;


ALTER FUNCTION "public"."validate_m6_legacy_deactivation_manifest"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_wanted_fields"("supplied_title" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_start" "date", "supplied_end" "date", "supplied_note" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select public.valid_plain_text(supplied_title, 120, false)
    and (supplied_category is null or public.is_canonical_gear_category(supplied_category))
    and supplied_quantity between 1 and 99
    and ((supplied_start is null and supplied_end is null)
      or (supplied_start is not null and supplied_end is not null
        and supplied_end >= supplied_start and supplied_end - supplied_start <= 366))
    and (supplied_note is null or public.valid_plain_text(supplied_note, 1000, true))
$$;


ALTER FUNCTION "public"."validate_wanted_fields"("supplied_title" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_start" "date", "supplied_end" "date", "supplied_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."wanted_offer_listing_status_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if old.listing_status = 'listed' and new.listing_status <> 'listed' then
    perform public.invalidate_wanted_offers_for_supply(new.id);
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."wanted_offer_listing_status_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."wanted_request_listing_seed"("target_request_id" "uuid") RETURNS TABLE("title" "text", "description" "text", "category" "text", "quantity" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare req public.wanted_requests%rowtype; caller_community uuid := public.current_active_community_id();
begin
  if caller_community is null then raise exception 'active member required'; end if;
  select * into req from public.wanted_requests r where r.id = target_request_id;
  if not found or req.community_id <> caller_community or req.status <> 'open' then
    raise exception 'open same-community wanted request required';
  end if;
  return query select req.title, coalesce(req.note, ''), req.category, req.desired_quantity;
end;
$$;


ALTER FUNCTION "public"."wanted_request_listing_seed"("target_request_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."administrator_ai_setting_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "community_id" "uuid" NOT NULL,
    "actor_user_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "outcome" "text" NOT NULL,
    "configuration_version" bigint NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "administrator_ai_setting_audit_action_check" CHECK (("action" = ANY (ARRAY['enable_requested'::"text", 'disable_requested'::"text"]))),
    CONSTRAINT "administrator_ai_setting_audit_configuration_version_check" CHECK (("configuration_version" > 0)),
    CONSTRAINT "administrator_ai_setting_audit_outcome_check" CHECK (("outcome" = ANY (ARRAY['rejected_missing_gates'::"text", 'noop_already_disabled'::"text", 'disabled'::"text", 'enabled'::"text"])))
);

ALTER TABLE ONLY "public"."administrator_ai_setting_audit" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."administrator_ai_setting_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."administrator_orientation_progress" (
    "community_id" "uuid" NOT NULL,
    "administrator_id" "uuid" NOT NULL,
    "registry_version" integer NOT NULL,
    "item_id" "text" NOT NULL,
    "status" "text" NOT NULL,
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "administrator_orientation_progress_status_check" CHECK (("status" = ANY (ARRAY['completed'::"text", 'dismissed'::"text"])))
);

ALTER TABLE ONLY "public"."administrator_orientation_progress" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."administrator_orientation_progress" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."administrator_orientation_registry" (
    "registry_version" integer NOT NULL,
    "item_id" "text" NOT NULL,
    "label" "text" NOT NULL,
    "help_text" "text",
    "route_id" "text" NOT NULL,
    "display_order" smallint NOT NULL,
    "required" boolean NOT NULL,
    "applicable_role" "text" NOT NULL,
    CONSTRAINT "administrator_orientation_registry_applicable_role_check" CHECK (("applicable_role" = 'administrator'::"text")),
    CONSTRAINT "administrator_orientation_registry_display_order_check" CHECK ((("display_order" >= 1) AND ("display_order" <= 20))),
    CONSTRAINT "administrator_orientation_registry_help_text_check" CHECK ((("help_text" IS NULL) OR "public"."valid_plain_text"("help_text", 500))),
    CONSTRAINT "administrator_orientation_registry_item_id_check" CHECK (("item_id" ~ '^[a-z][a-z0-9_]{2,47}$'::"text")),
    CONSTRAINT "administrator_orientation_registry_label_check" CHECK ("public"."valid_plain_text"("label", 120)),
    CONSTRAINT "administrator_orientation_registry_registry_version_check" CHECK (("registry_version" > 0)),
    CONSTRAINT "administrator_orientation_registry_route_id_check" CHECK (("route_id" = ANY (ARRAY['administration_members'::"text", 'administration_settings'::"text", 'inventory'::"text", 'loans'::"text", 'notifications'::"text", 'privacy'::"text"])))
);

ALTER TABLE ONLY "public"."administrator_orientation_registry" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."administrator_orientation_registry" OWNER TO "postgres";


COMMENT ON TABLE "public"."administrator_orientation_registry" IS 'Generic Administrator orientation only. No statistics, member counts, analytics, arbitrary URLs, scripts, or action payloads.';



CREATE TABLE IF NOT EXISTS "public"."ai_activation_evidence" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "community_id" "uuid" NOT NULL,
    "price_snapshot_id" "uuid" NOT NULL,
    "model" "text" NOT NULL,
    "service_tier" "text" NOT NULL,
    "model_access_confirmed" boolean NOT NULL,
    "secret_present" boolean NOT NULL,
    "image_input_supported" boolean NOT NULL,
    "structured_output_supported" boolean NOT NULL,
    "data_controls_reviewed" boolean NOT NULL,
    "dashboard_price_confirmed" boolean NOT NULL,
    "evaluation_set_version" "text" NOT NULL,
    "evaluation_manifest_sha256" "text" NOT NULL,
    "evaluation_scores_sha256" "text" NOT NULL,
    "evaluation_passed" boolean NOT NULL,
    "reviewer_one" "text" NOT NULL,
    "reviewer_two" "text" NOT NULL,
    "reviewer_one_passed" boolean NOT NULL,
    "reviewer_two_passed" boolean NOT NULL,
    "overall_approved" boolean NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "recorded_by" "text" NOT NULL,
    CONSTRAINT "ai_activation_evidence_check" CHECK (("reviewer_one" <> "reviewer_two")),
    CONSTRAINT "ai_activation_evidence_check1" CHECK (("overall_approved" = ("model_access_confirmed" AND "secret_present" AND "image_input_supported" AND "structured_output_supported" AND "data_controls_reviewed" AND "dashboard_price_confirmed" AND "evaluation_passed" AND "reviewer_one_passed" AND "reviewer_two_passed"))),
    CONSTRAINT "ai_activation_evidence_check2" CHECK ((("expires_at" > "recorded_at") AND ("expires_at" <= ("recorded_at" + '24:00:00'::interval)))),
    CONSTRAINT "ai_activation_evidence_evaluation_manifest_sha256_check" CHECK (("evaluation_manifest_sha256" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "ai_activation_evidence_evaluation_scores_sha256_check" CHECK (("evaluation_scores_sha256" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "ai_activation_evidence_evaluation_set_version_check" CHECK (("evaluation_set_version" = 'm8-v1'::"text")),
    CONSTRAINT "ai_activation_evidence_model_check" CHECK (("model" = 'gpt-5.6-luna'::"text")),
    CONSTRAINT "ai_activation_evidence_recorded_by_check" CHECK ("public"."valid_plain_text"("recorded_by", 120)),
    CONSTRAINT "ai_activation_evidence_reviewer_one_check" CHECK ("public"."valid_plain_text"("reviewer_one", 120)),
    CONSTRAINT "ai_activation_evidence_reviewer_two_check" CHECK ("public"."valid_plain_text"("reviewer_two", 120)),
    CONSTRAINT "ai_activation_evidence_service_tier_check" CHECK (("service_tier" = 'standard'::"text"))
);

ALTER TABLE ONLY "public"."ai_activation_evidence" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_activation_evidence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_draft_attempts" (
    "id" "uuid" NOT NULL,
    "community_id" "uuid" NOT NULL,
    "requester_id" "uuid" NOT NULL,
    "activation_evidence_id" "uuid" NOT NULL,
    "price_snapshot_id" "uuid" NOT NULL,
    "model" "text" NOT NULL,
    "service_tier" "text" NOT NULL,
    "mode" "text" NOT NULL,
    "detail" "text" NOT NULL,
    "candidate_count" smallint NOT NULL,
    "image_count" smallint NOT NULL,
    "reserved_units" integer NOT NULL,
    "reserved_microdollars" bigint NOT NULL,
    "status" "public"."ai_draft_attempt_status" DEFAULT 'reserved'::"public"."ai_draft_attempt_status" NOT NULL,
    "input_tokens" integer,
    "cached_input_tokens" integer,
    "output_tokens" integer,
    "reasoning_output_tokens" integer,
    "usage_recognized" boolean DEFAULT false NOT NULL,
    "actual_microdollars" bigint,
    "provider_response_id" "text",
    "failure_kind" "text",
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "ai_draft_attempts_actual_microdollars_check" CHECK ((("actual_microdollars" IS NULL) OR ("actual_microdollars" >= 0))),
    CONSTRAINT "ai_draft_attempts_cached_input_tokens_check" CHECK ((("cached_input_tokens" IS NULL) OR (("cached_input_tokens" >= 0) AND ("cached_input_tokens" <= 100000)))),
    CONSTRAINT "ai_draft_attempts_candidate_count_check" CHECK ((("candidate_count" >= 1) AND ("candidate_count" <= 10))),
    CONSTRAINT "ai_draft_attempts_check" CHECK ((("cached_input_tokens" IS NULL) OR ("input_tokens" IS NULL) OR ("cached_input_tokens" <= "input_tokens"))),
    CONSTRAINT "ai_draft_attempts_check1" CHECK ((("reasoning_output_tokens" IS NULL) OR ("output_tokens" IS NULL) OR ("reasoning_output_tokens" <= "output_tokens"))),
    CONSTRAINT "ai_draft_attempts_check2" CHECK ((("status" = ANY (ARRAY['reserved'::"public"."ai_draft_attempt_status", 'provider_inflight'::"public"."ai_draft_attempt_status"])) = ("completed_at" IS NULL))),
    CONSTRAINT "ai_draft_attempts_detail_check" CHECK (("detail" = 'low'::"text")),
    CONSTRAINT "ai_draft_attempts_failure_kind_check" CHECK ((("failure_kind" IS NULL) OR ("failure_kind" = ANY (ARRAY['authorization'::"text", 'input'::"text", 'rate_limit'::"text", 'timeout'::"text", 'network'::"text", 'provider'::"text", 'quota'::"text", 'refusal'::"text", 'truncated'::"text", 'schema'::"text", 'usage'::"text", 'configuration'::"text", 'reconciliation'::"text"])))),
    CONSTRAINT "ai_draft_attempts_image_count_check" CHECK ((("image_count" >= 1) AND ("image_count" <= 10))),
    CONSTRAINT "ai_draft_attempts_input_tokens_check" CHECK ((("input_tokens" IS NULL) OR (("input_tokens" >= 0) AND ("input_tokens" <= 100000)))),
    CONSTRAINT "ai_draft_attempts_mode_check" CHECK (("mode" = ANY (ARRAY['single'::"text", 'bulk'::"text"]))),
    CONSTRAINT "ai_draft_attempts_model_check" CHECK (("model" = 'gpt-5.6-luna'::"text")),
    CONSTRAINT "ai_draft_attempts_output_tokens_check" CHECK ((("output_tokens" IS NULL) OR (("output_tokens" >= 0) AND ("output_tokens" <= 2400)))),
    CONSTRAINT "ai_draft_attempts_provider_response_id_check" CHECK ((("provider_response_id" IS NULL) OR ("provider_response_id" ~ '^resp_[A-Za-z0-9_-]{1,120}$'::"text"))),
    CONSTRAINT "ai_draft_attempts_reasoning_output_tokens_check" CHECK ((("reasoning_output_tokens" IS NULL) OR (("reasoning_output_tokens" >= 0) AND ("reasoning_output_tokens" <= 2400)))),
    CONSTRAINT "ai_draft_attempts_reserved_microdollars_check" CHECK (("reserved_microdollars" > 0)),
    CONSTRAINT "ai_draft_attempts_reserved_units_check" CHECK ((("reserved_units" >= 1) AND ("reserved_units" <= 10))),
    CONSTRAINT "ai_draft_attempts_service_tier_check" CHECK (("service_tier" = 'standard'::"text"))
);

ALTER TABLE ONLY "public"."ai_draft_attempts" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_draft_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_model_price_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "model" "text" NOT NULL,
    "service_tier" "text" NOT NULL,
    "currency" "text" NOT NULL,
    "input_microdollars_per_million" bigint NOT NULL,
    "cached_input_microdollars_per_million" bigint NOT NULL,
    "output_microdollars_per_million" bigint NOT NULL,
    "worst_case_microdollars_per_draft" bigint NOT NULL,
    "source_reference" "text" NOT NULL,
    "effective_at" timestamp with time zone NOT NULL,
    "observed_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "recorded_by" "text" NOT NULL,
    CONSTRAINT "ai_model_price_snapshots_cached_input_microdollars_per_mi_check" CHECK (("cached_input_microdollars_per_million" > 0)),
    CONSTRAINT "ai_model_price_snapshots_check" CHECK (("effective_at" <= "observed_at")),
    CONSTRAINT "ai_model_price_snapshots_check1" CHECK (("cached_input_microdollars_per_million" <= "input_microdollars_per_million")),
    CONSTRAINT "ai_model_price_snapshots_check2" CHECK ((("worst_case_microdollars_per_draft")::numeric >= "ceiling"(((((21000)::numeric * ("input_microdollars_per_million")::numeric) + ((800)::numeric * ("output_microdollars_per_million")::numeric)) / (1000000)::numeric)))),
    CONSTRAINT "ai_model_price_snapshots_check3" CHECK ((("expires_at" > "observed_at") AND ("expires_at" <= ("observed_at" + '30 days'::interval)))),
    CONSTRAINT "ai_model_price_snapshots_currency_check" CHECK (("currency" = 'USD'::"text")),
    CONSTRAINT "ai_model_price_snapshots_input_microdollars_per_million_check" CHECK (("input_microdollars_per_million" > 0)),
    CONSTRAINT "ai_model_price_snapshots_model_check" CHECK (("model" = 'gpt-5.6-luna'::"text")),
    CONSTRAINT "ai_model_price_snapshots_output_microdollars_per_million_check" CHECK (("output_microdollars_per_million" > 0)),
    CONSTRAINT "ai_model_price_snapshots_recorded_by_check" CHECK ("public"."valid_plain_text"("recorded_by", 120)),
    CONSTRAINT "ai_model_price_snapshots_service_tier_check" CHECK (("service_tier" = 'standard'::"text")),
    CONSTRAINT "ai_model_price_snapshots_source_reference_check" CHECK ("public"."valid_plain_text"("source_reference", 240)),
    CONSTRAINT "ai_model_price_snapshots_worst_case_microdollars_per_draf_check" CHECK (("worst_case_microdollars_per_draft" > 0))
);

ALTER TABLE ONLY "public"."ai_model_price_snapshots" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_model_price_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."communities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "join_mode" "public"."community_join_mode" DEFAULT 'approval_required'::"public"."community_join_mode" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "communities_name_check" CHECK ((("length"("btrim"("name")) >= 1) AND ("length"("btrim"("name")) <= 120))),
    CONSTRAINT "communities_slug_check" CHECK (("slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::"text"))
);


ALTER TABLE "public"."communities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."community_roles" (
    "community_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."app_role" NOT NULL,
    "granted_by" "uuid",
    "granted_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."community_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."community_setting_versions" (
    "community_id" "uuid" NOT NULL,
    "version" bigint NOT NULL,
    "display_name" "text" NOT NULL,
    "ai_drafting_enabled" boolean DEFAULT false NOT NULL,
    "changed_by" "uuid",
    "operator_identifier" "text",
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "community_setting_version_actor" CHECK (((("changed_by" IS NOT NULL) AND ("operator_identifier" IS NULL)) OR (("changed_by" IS NULL) AND ("operator_identifier" = 'milestone-6-migration'::"text")))),
    CONSTRAINT "community_setting_versions_display_name_check" CHECK ("public"."valid_plain_text"("display_name", 80)),
    CONSTRAINT "community_setting_versions_version_check" CHECK (("version" > 0))
);

ALTER TABLE ONLY "public"."community_setting_versions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."community_setting_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."community_settings" (
    "community_id" "uuid" NOT NULL,
    "current_version" bigint NOT NULL,
    "display_name" "text" NOT NULL,
    "ai_drafting_enabled" boolean DEFAULT false NOT NULL,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "community_settings_current_version_check" CHECK (("current_version" > 0)),
    CONSTRAINT "community_settings_display_name_check" CHECK ("public"."valid_plain_text"("display_name", 80))
);

ALTER TABLE ONLY "public"."community_settings" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."community_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."founding_steward_bootstrap" (
    "community_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "operator_identifier" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "bootstrapped_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "founding_steward_bootstrap_operator_identifier_check" CHECK (("length"("btrim"("operator_identifier")) > 0)),
    CONSTRAINT "founding_steward_bootstrap_reason_check" CHECK (("length"("btrim"("reason")) > 0))
);


ALTER TABLE "public"."founding_steward_bootstrap" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gear_loan_guideline_acceptances" (
    "community_id" "uuid" NOT NULL,
    "loan_id" "uuid" NOT NULL,
    "supply_id" "uuid" NOT NULL,
    "guideline_version" bigint NOT NULL,
    "rules" "text"[] NOT NULL,
    "accepted_by" "uuid" NOT NULL,
    "accepted_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "gear_loan_guideline_acceptances_guideline_version_check" CHECK (("guideline_version" > 0)),
    CONSTRAINT "gear_loan_guideline_acceptances_rules_check" CHECK ((("cardinality"("rules") >= 1) AND ("cardinality"("rules") <= 8)))
);

ALTER TABLE ONLY "public"."gear_loan_guideline_acceptances" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."gear_loan_guideline_acceptances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."join_question_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "community_id" "uuid" NOT NULL,
    "version" integer NOT NULL,
    "questions" "jsonb" NOT NULL,
    "published_by" "uuid",
    "published_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_current" boolean DEFAULT true NOT NULL,
    CONSTRAINT "join_question_shape" CHECK ((("jsonb_typeof"("questions") = 'array'::"text") AND (("jsonb_array_length"("questions") >= 0) AND ("jsonb_array_length"("questions") <= 3)))),
    CONSTRAINT "join_question_versions_version_check" CHECK (("version" > 0)),
    CONSTRAINT "join_questions_valid" CHECK ("public"."validate_join_questions"("questions"))
);

ALTER TABLE ONLY "public"."join_question_versions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."join_question_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."legacy_deactivation_backfill_manifest" (
    "profile_id" "uuid" NOT NULL,
    "community_id" "uuid" NOT NULL,
    "deactivated_by" "uuid" NOT NULL,
    "successor_user_id" "uuid" NOT NULL,
    "prior_access_level" "text" NOT NULL,
    "affected_listings" bigint NOT NULL,
    "cancelled_loans" bigint NOT NULL,
    "checked_out_loans" bigint NOT NULL,
    "deactivated_at" timestamp with time zone NOT NULL,
    "evidence_reference" "text" NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "legacy_deactivation_backfill_manifest_affected_listings_check" CHECK (("affected_listings" >= 0)),
    CONSTRAINT "legacy_deactivation_backfill_manifest_cancelled_loans_check" CHECK (("cancelled_loans" >= 0)),
    CONSTRAINT "legacy_deactivation_backfill_manifest_checked_out_loans_check" CHECK (("checked_out_loans" >= 0)),
    CONSTRAINT "legacy_deactivation_backfill_manifest_evidence_reference_check" CHECK ("public"."valid_plain_text"("evidence_reference", 240)),
    CONSTRAINT "legacy_deactivation_backfill_manifest_prior_access_level_check" CHECK (("prior_access_level" = ANY (ARRAY['regular'::"text", 'custodian'::"text", 'administrator'::"text"])))
);

ALTER TABLE ONLY "public"."legacy_deactivation_backfill_manifest" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."legacy_deactivation_backfill_manifest" OWNER TO "postgres";


COMMENT ON TABLE "public"."legacy_deactivation_backfill_manifest" IS 'Empty by default. Exact evidence rows may be added only by a separately reviewed predecessor migration before Milestone 6; runtime callers have no access.';



CREATE TABLE IF NOT EXISTS "public"."loan_handoff_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "community_id" "uuid" NOT NULL,
    "loan_id" "uuid" NOT NULL,
    "prior_handoff_id" "uuid" NOT NULL,
    "next_handoff_id" "uuid" NOT NULL,
    "changed_by" "uuid" NOT NULL,
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "loan_handoff_changed" CHECK (("prior_handoff_id" <> "next_handoff_id"))
);

ALTER TABLE ONLY "public"."loan_handoff_audit" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."loan_handoff_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loan_reminder_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "community_id" "uuid" NOT NULL,
    "loan_id" "uuid" NOT NULL,
    "recipient_user_id" "uuid" NOT NULL,
    "reminder_kind" "text" NOT NULL,
    "ordinal" smallint NOT NULL,
    "end_date" "date" NOT NULL,
    "time_zone" "text" NOT NULL,
    "policy_version" integer NOT NULL,
    "due_at" timestamp with time zone NOT NULL,
    "occurred_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "loan_reminder_events_check" CHECK (((("reminder_kind" = ANY (ARRAY['due_soon'::"text", 'first_overdue'::"text"])) AND ("ordinal" = 0)) OR (("reminder_kind" = 'weekly_overdue'::"text") AND (("ordinal" >= 1) AND ("ordinal" <= 3))))),
    CONSTRAINT "loan_reminder_events_policy_version_check" CHECK (("policy_version" > 0)),
    CONSTRAINT "loan_reminder_events_reminder_kind_check" CHECK (("reminder_kind" = ANY (ARRAY['due_soon'::"text", 'first_overdue'::"text", 'weekly_overdue'::"text"])))
);

ALTER TABLE ONLY "public"."loan_reminder_events" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."loan_reminder_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loan_reminder_policies" (
    "community_id" "uuid" NOT NULL,
    "time_zone" "text" NOT NULL,
    "policy_version" integer NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "reviewed_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "loan_reminder_policies_policy_version_check" CHECK (("policy_version" > 0)),
    CONSTRAINT "loan_reminder_policies_time_zone_check" CHECK (((("length"("time_zone") >= 3) AND ("length"("time_zone") <= 64)) AND ("time_zone" ~ '^[A-Za-z_]+(?:/[A-Za-z0-9_+.-]+)+$'::"text")))
);

ALTER TABLE ONLY "public"."loan_reminder_policies" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."loan_reminder_policies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."member_postal_codes" (
    "community_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "postal_code" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "member_postal_normalized" CHECK ((("postal_code" = "public"."normalize_postal_code"("postal_code")) AND (("length"("postal_code") >= 3) AND ("length"("postal_code") <= 10)) AND ("postal_code" ~ '^[A-Z0-9]+(?:[ -][A-Z0-9]+)?$'::"text")))
);

ALTER TABLE ONLY "public"."member_postal_codes" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."member_postal_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."member_profile_settings" (
    "community_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "introduction" "text",
    "phone_e164" "text",
    "coordination_note" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "member_coordination_bound" CHECK ((("coordination_note" IS NULL) OR (("length"("coordination_note") >= 1) AND ("length"("coordination_note") <= 160)))),
    CONSTRAINT "member_coordination_plain" CHECK ((("coordination_note" IS NULL) OR "public"."valid_plain_text"("coordination_note", 160))),
    CONSTRAINT "member_intro_bound" CHECK ((("introduction" IS NULL) OR (("length"("introduction") >= 1) AND ("length"("introduction") <= 500)))),
    CONSTRAINT "member_intro_plain" CHECK ((("introduction" IS NULL) OR "public"."valid_plain_text"("introduction", 500))),
    CONSTRAINT "member_phone_bound" CHECK ((("phone_e164" IS NULL) OR ("phone_e164" ~ '^\+[1-9][0-9]{7,14}$'::"text")))
);

ALTER TABLE ONLY "public"."member_profile_settings" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."member_profile_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."membership_applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "community_id" "uuid" NOT NULL,
    "applicant_id" "uuid" NOT NULL,
    "question_version_id" "uuid" NOT NULL,
    "answer_snapshot" "jsonb" NOT NULL,
    "answer_count" smallint NOT NULL,
    "policy_snapshot" "text" DEFAULT 'approval_required'::"text" NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "first_submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "submission_count" integer DEFAULT 1 NOT NULL,
    "decided_at" timestamp with time zone,
    "redacted_at" timestamp with time zone,
    CONSTRAINT "membership_answer_shape" CHECK ((("jsonb_typeof"("answer_snapshot") = 'array'::"text") AND ((("redacted_at" IS NULL) AND ("answer_count" = "jsonb_array_length"("answer_snapshot"))) OR (("redacted_at" IS NOT NULL) AND ("answer_snapshot" = '[]'::"jsonb"))))),
    CONSTRAINT "membership_answers_valid" CHECK ("public"."validate_join_answer_snapshot"("answer_snapshot")),
    CONSTRAINT "membership_applications_answer_count_check" CHECK ((("answer_count" >= 0) AND ("answer_count" <= 3))),
    CONSTRAINT "membership_applications_policy_snapshot_check" CHECK (("policy_snapshot" = 'approval_required'::"text")),
    CONSTRAINT "membership_applications_submission_count_check" CHECK ((("submission_count" >= 1) AND ("submission_count" <= 100)))
);

ALTER TABLE ONLY "public"."membership_applications" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."membership_applications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."membership_deactivation_consequences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "community_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "deactivated_by" "uuid" NOT NULL,
    "successor_user_id" "uuid" NOT NULL,
    "prior_access_level" "text" NOT NULL,
    "affected_listings" bigint NOT NULL,
    "cancelled_loans" bigint NOT NULL,
    "checked_out_loans" bigint NOT NULL,
    "consequence_version" bigint DEFAULT 1 NOT NULL,
    "deactivation_sequence" bigint NOT NULL,
    "deactivated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "evidence_origin" "text" DEFAULT 'workflow'::"text" NOT NULL,
    "evidence_reference" "text",
    CONSTRAINT "deactivation_evidence_shape" CHECK (((("evidence_origin" = 'workflow'::"text") AND ("evidence_reference" IS NULL)) OR (("evidence_origin" = 'legacy_manifest'::"text") AND "public"."valid_plain_text"("evidence_reference", 240)))),
    CONSTRAINT "membership_deactivation_consequence_deactivation_sequence_check" CHECK (("deactivation_sequence" > 0)),
    CONSTRAINT "membership_deactivation_consequences_affected_listings_check" CHECK (("affected_listings" >= 0)),
    CONSTRAINT "membership_deactivation_consequences_cancelled_loans_check" CHECK (("cancelled_loans" >= 0)),
    CONSTRAINT "membership_deactivation_consequences_checked_out_loans_check" CHECK (("checked_out_loans" >= 0)),
    CONSTRAINT "membership_deactivation_consequences_consequence_version_check" CHECK (("consequence_version" = 1)),
    CONSTRAINT "membership_deactivation_consequences_evidence_origin_check" CHECK (("evidence_origin" = ANY (ARRAY['workflow'::"text", 'legacy_manifest'::"text"]))),
    CONSTRAINT "membership_deactivation_consequences_prior_access_level_check" CHECK (("prior_access_level" = ANY (ARRAY['regular'::"text", 'custodian'::"text", 'administrator'::"text"])))
);

ALTER TABLE ONLY "public"."membership_deactivation_consequences" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."membership_deactivation_consequences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."membership_reactivation_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "community_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "deactivation_id" "uuid" NOT NULL,
    "actor_user_id" "uuid" NOT NULL,
    "prior_access_level" "text" NOT NULL,
    "restored_access_level" "text" NOT NULL,
    "preview_version" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "cancelled_loans" bigint NOT NULL,
    "individual_owned_listings" bigint NOT NULL,
    "stored_with_listings" bigint NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "membership_reactivation_audit_cancelled_loans_check" CHECK (("cancelled_loans" >= 0)),
    CONSTRAINT "membership_reactivation_audit_individual_owned_listings_check" CHECK (("individual_owned_listings" >= 0)),
    CONSTRAINT "membership_reactivation_audit_preview_version_check" CHECK (("preview_version" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "membership_reactivation_audit_prior_access_level_check" CHECK (("prior_access_level" = ANY (ARRAY['regular'::"text", 'custodian'::"text", 'administrator'::"text"]))),
    CONSTRAINT "membership_reactivation_audit_reason_check" CHECK ("public"."valid_plain_text"("reason", 240)),
    CONSTRAINT "membership_reactivation_audit_restored_access_level_check" CHECK (("restored_access_level" = 'regular'::"text")),
    CONSTRAINT "membership_reactivation_audit_stored_with_listings_check" CHECK (("stored_with_listings" >= 0))
);

ALTER TABLE ONLY "public"."membership_reactivation_audit" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."membership_reactivation_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_delivery_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "outbox_id" "uuid" NOT NULL,
    "attempt_number" smallint NOT NULL,
    "outcome" "text" NOT NULL,
    "error_code" "text",
    "provider_message_id" "text",
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notification_delivery_attempts_attempt_number_check" CHECK ((("attempt_number" >= 1) AND ("attempt_number" <= 5))),
    CONSTRAINT "notification_delivery_attempts_error_code_check" CHECK ((("error_code" IS NULL) OR ("error_code" = ANY (ARRAY['provider_4xx'::"text", 'provider_5xx'::"text", 'throttled'::"text", 'network_ambiguous'::"text", 'invalid_provider_response'::"text", 'address_rejected'::"text", 'attempts_exhausted'::"text"])))),
    CONSTRAINT "notification_delivery_attempts_outcome_check" CHECK (("outcome" = ANY (ARRAY['delivered'::"text", 'retryable'::"text", 'permanent'::"text", 'permanent_address'::"text", 'ambiguous'::"text"]))),
    CONSTRAINT "notification_delivery_attempts_provider_message_id_check" CHECK ((("provider_message_id" IS NULL) OR (("length"("provider_message_id") >= 1) AND ("length"("provider_message_id") <= 200))))
);

ALTER TABLE ONLY "public"."notification_delivery_attempts" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_delivery_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_event_registry" (
    "event_type" "text" NOT NULL,
    "category" "text" NOT NULL,
    "email_required" boolean NOT NULL,
    "email_enabled" boolean DEFAULT true NOT NULL,
    "in_app_title" "text" NOT NULL,
    "in_app_body" "text" NOT NULL,
    "app_route" "text" NOT NULL,
    "email_subject" "text" NOT NULL,
    "email_body" "text" NOT NULL,
    "source_kind" "text" NOT NULL,
    CONSTRAINT "notification_event_registry_app_route_check" CHECK (((("length"("app_route") >= 1) AND ("length"("app_route") <= 160)) AND ("app_route" ~ '^/[a-z0-9/?=&_-]+$'::"text") AND ("app_route" !~~ '//%'::"text"))),
    CONSTRAINT "notification_event_registry_category_check" CHECK (("category" = ANY (ARRAY['membership_access'::"text", 'role_access'::"text", 'loan_activity'::"text", 'loan_reminders'::"text", 'wanted_activity'::"text", 'delivery_status'::"text"]))),
    CONSTRAINT "notification_event_registry_email_body_check" CHECK ((("length"("email_body") >= 1) AND ("length"("email_body") <= 400))),
    CONSTRAINT "notification_event_registry_email_subject_check" CHECK ((("length"("email_subject") >= 1) AND ("length"("email_subject") <= 100))),
    CONSTRAINT "notification_event_registry_event_type_check" CHECK (("event_type" ~ '^[a-z][a-z0-9_]{2,63}$'::"text")),
    CONSTRAINT "notification_event_registry_in_app_body_check" CHECK ((("length"("in_app_body") >= 1) AND ("length"("in_app_body") <= 240))),
    CONSTRAINT "notification_event_registry_in_app_title_check" CHECK ((("length"("in_app_title") >= 1) AND ("length"("in_app_title") <= 80))),
    CONSTRAINT "notification_event_registry_source_kind_check" CHECK (("source_kind" = ANY (ARRAY['membership_application'::"text", 'membership'::"text", 'role_audit'::"text", 'loan'::"text", 'loan_reminder'::"text", 'wanted'::"text", 'delivery'::"text"])))
);

ALTER TABLE ONLY "public"."notification_event_registry" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_event_registry" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."private_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "community_id" "uuid" NOT NULL,
    "recipient_user_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "authoritative_record_id" "text" NOT NULL,
    "transition_version" bigint NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "app_route" "text" NOT NULL,
    "occurred_at" timestamp with time zone NOT NULL,
    "read_at" timestamp with time zone,
    "dismissed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "private_notifications_app_route_check" CHECK (((("length"("app_route") >= 1) AND ("length"("app_route") <= 160)) AND ("app_route" ~~ '/%'::"text"))),
    CONSTRAINT "private_notifications_authoritative_record_id_check" CHECK ((("length"("authoritative_record_id") >= 1) AND ("length"("authoritative_record_id") <= 80))),
    CONSTRAINT "private_notifications_body_check" CHECK ((("length"("body") >= 1) AND ("length"("body") <= 240))),
    CONSTRAINT "private_notifications_title_check" CHECK ((("length"("title") >= 1) AND ("length"("title") <= 80))),
    CONSTRAINT "private_notifications_transition_version_check" CHECK (("transition_version" > 0))
);

ALTER TABLE ONLY "public"."private_notifications" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."private_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "community_id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "membership_status" "public"."membership_status" DEFAULT 'pending'::"public"."membership_status" NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "rejected_by" "uuid",
    "rejected_at" timestamp with time zone,
    "deactivated_by" "uuid",
    "deactivated_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_approval_audit" CHECK (((("approved_at" IS NULL) AND ("approved_by" IS NULL)) OR (("approved_at" IS NOT NULL) AND ("approved_by" IS NOT NULL)))),
    CONSTRAINT "profiles_deactivation_audit" CHECK (((("deactivated_at" IS NULL) AND ("deactivated_by" IS NULL)) OR (("deactivated_at" IS NOT NULL) AND ("deactivated_by" IS NOT NULL)))),
    CONSTRAINT "profiles_display_name_check" CHECK ((("length"("btrim"("display_name")) >= 1) AND ("length"("btrim"("display_name")) <= 120))),
    CONSTRAINT "profiles_recovered_display_name" CHECK (("public"."valid_plain_text"("display_name", 80) AND ("display_name" = "regexp_replace"("btrim"("display_name"), '[[:space:]]+'::"text", ' '::"text", 'g'::"text")))),
    CONSTRAINT "profiles_rejection_audit" CHECK (((("rejected_at" IS NULL) AND ("rejected_by" IS NULL)) OR (("rejected_at" IS NOT NULL) AND ("rejected_by" IS NOT NULL))))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_audit" (
    "id" bigint NOT NULL,
    "community_id" "uuid" NOT NULL,
    "target_user_id" "uuid" NOT NULL,
    "role" "public"."app_role" NOT NULL,
    "action" "text" NOT NULL,
    "actor_user_id" "uuid",
    "operator_identifier" "text",
    "reason" "text",
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "role_audit_action_check" CHECK (("action" = ANY (ARRAY['bootstrap'::"text", 'promote'::"text", 'demote'::"text"]))),
    CONSTRAINT "role_audit_actor" CHECK (((("action" = 'bootstrap'::"text") AND ("actor_user_id" IS NULL) AND ("length"("btrim"("operator_identifier")) > 0) AND ("length"("btrim"("reason")) > 0)) OR (("action" <> 'bootstrap'::"text") AND ("actor_user_id" IS NOT NULL) AND ("operator_identifier" IS NULL))))
);


ALTER TABLE "public"."role_audit" OWNER TO "postgres";


ALTER TABLE "public"."role_audit" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."role_audit_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ses_feedback_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "topic_arn" "text" NOT NULL,
    "sns_message_id" "text" NOT NULL,
    "outbox_id" "uuid" NOT NULL,
    "feedback_kind" "text" NOT NULL,
    "occurred_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ses_feedback_events_feedback_kind_check" CHECK (("feedback_kind" = ANY (ARRAY['complaint'::"text", 'permanent_bounce'::"text", 'transient_bounce'::"text"]))),
    CONSTRAINT "ses_feedback_events_sns_message_id_check" CHECK ((("length"("sns_message_id") >= 1) AND ("length"("sns_message_id") <= 200))),
    CONSTRAINT "ses_feedback_events_topic_arn_check" CHECK ((("length"("topic_arn") >= 20) AND ("length"("topic_arn") <= 300)))
);

ALTER TABLE ONLY "public"."ses_feedback_events" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."ses_feedback_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supply_attention_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "community_id" "uuid" NOT NULL,
    "supply_id" "uuid" NOT NULL,
    "version" bigint NOT NULL,
    "prior_value" boolean NOT NULL,
    "next_value" boolean NOT NULL,
    "reason" "text" NOT NULL,
    "changed_by" "uuid" NOT NULL,
    "source_loan_id" "uuid",
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "supply_attention_audit_reason_check" CHECK ((("length"("reason") >= 1) AND ("length"("reason") <= 500))),
    CONSTRAINT "supply_attention_audit_version_check" CHECK (("version" > 0)),
    CONSTRAINT "supply_attention_changed" CHECK (("prior_value" <> "next_value"))
);

ALTER TABLE ONLY "public"."supply_attention_audit" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."supply_attention_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supply_condition_history" (
    "id" bigint NOT NULL,
    "community_id" "uuid" NOT NULL,
    "supply_id" "uuid" NOT NULL,
    "prior_condition" "text",
    "next_condition" "text" NOT NULL,
    "changed_by" "uuid" NOT NULL,
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "supply_condition_history_next_condition_check" CHECK ("public"."is_canonical_gear_condition"("next_condition")),
    CONSTRAINT "supply_condition_prior_canonical" CHECK ((("prior_condition" IS NULL) OR "public"."is_canonical_gear_condition"("prior_condition")))
);

ALTER TABLE ONLY "public"."supply_condition_history" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."supply_condition_history" OWNER TO "postgres";


ALTER TABLE "public"."supply_condition_history" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."supply_condition_history_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."supply_donation_audit" (
    "supply_id" "uuid" NOT NULL,
    "community_id" "uuid" NOT NULL,
    "prior_owner_id" "uuid" NOT NULL,
    "converted_by" "uuid" NOT NULL,
    "converted_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."supply_donation_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supply_guideline_versions" (
    "community_id" "uuid" NOT NULL,
    "supply_id" "uuid" NOT NULL,
    "version" bigint NOT NULL,
    "rules" "text"[] NOT NULL,
    "changed_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "supply_guideline_versions_version_check" CHECK (("version" > 0))
);

ALTER TABLE ONLY "public"."supply_guideline_versions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."supply_guideline_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transactional_email_outbox" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "notification_id" "uuid",
    "community_id" "uuid" NOT NULL,
    "recipient_user_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "authoritative_record_id" "text" NOT NULL,
    "transition_version" bigint NOT NULL,
    "payload" "jsonb" NOT NULL,
    "email_snapshot" "text",
    "delivery_tag" "uuid",
    "status" "text" NOT NULL,
    "attempt_count" smallint DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone,
    "claimed_at" timestamp with time zone,
    "claimed_by" "uuid",
    "claim_token" "uuid",
    "first_attempt_at" timestamp with time zone,
    "last_attempt_at" timestamp with time zone,
    "provider_message_id" "text",
    "terminal_at" timestamp with time zone,
    "redacted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "transactional_email_claim_shape" CHECK (((("status" = 'claimed'::"text") AND ("claimed_at" IS NOT NULL) AND ("claimed_by" IS NOT NULL) AND ("claim_token" IS NOT NULL)) OR (("status" <> 'claimed'::"text") AND ("claimed_at" IS NULL) AND ("claimed_by" IS NULL) AND ("claim_token" IS NULL)))),
    CONSTRAINT "transactional_email_outbox_attempt_count_check" CHECK ((("attempt_count" >= 0) AND ("attempt_count" <= 5))),
    CONSTRAINT "transactional_email_outbox_authoritative_record_id_check" CHECK ((("length"("authoritative_record_id") >= 1) AND ("length"("authoritative_record_id") <= 80))),
    CONSTRAINT "transactional_email_outbox_provider_message_id_check" CHECK ((("provider_message_id" IS NULL) OR (("length"("provider_message_id") >= 1) AND ("length"("provider_message_id") <= 200)))),
    CONSTRAINT "transactional_email_outbox_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'claimed'::"text", 'retry'::"text", 'delivered'::"text", 'preference_suppressed'::"text", 'address_suppressed'::"text", 'invalidated'::"text", 'permanent_failure'::"text", 'ambiguous'::"text"]))),
    CONSTRAINT "transactional_email_outbox_transition_version_check" CHECK (("transition_version" > 0)),
    CONSTRAINT "transactional_email_payload_shape" CHECK (((("redacted_at" IS NULL) AND ("jsonb_typeof"("payload") = 'object'::"text") AND ("delivery_tag" IS NOT NULL)) OR (("redacted_at" IS NOT NULL) AND ("payload" = '{}'::"jsonb") AND ("email_snapshot" IS NULL) AND ("delivery_tag" IS NULL)))),
    CONSTRAINT "transactional_email_terminal_shape" CHECK (((("status" = ANY (ARRAY['pending'::"text", 'claimed'::"text", 'retry'::"text"])) AND ("terminal_at" IS NULL)) OR (("status" <> ALL (ARRAY['pending'::"text", 'claimed'::"text", 'retry'::"text"])) AND ("terminal_at" IS NOT NULL))))
);

ALTER TABLE ONLY "public"."transactional_email_outbox" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."transactional_email_outbox" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transactional_email_preference_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "community_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "actor_user_id" "uuid" NOT NULL,
    "loan_activity" boolean NOT NULL,
    "loan_reminders" boolean NOT NULL,
    "wanted_activity" boolean NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."transactional_email_preference_audit" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."transactional_email_preference_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transactional_email_preferences" (
    "community_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "loan_activity" boolean DEFAULT true NOT NULL,
    "loan_reminders" boolean DEFAULT true NOT NULL,
    "wanted_activity" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."transactional_email_preferences" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."transactional_email_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transactional_email_suppression_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "community_id" "uuid" NOT NULL,
    "recipient_user_id" "uuid" NOT NULL,
    "actor_user_id" "uuid",
    "action" "text" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "transactional_email_suppression_audit_action_check" CHECK (("action" = ANY (ARRAY['administrator_paused'::"text", 'administrator_resumed'::"text"])))
);

ALTER TABLE ONLY "public"."transactional_email_suppression_audit" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."transactional_email_suppression_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transactional_email_suppressions" (
    "community_id" "uuid" NOT NULL,
    "recipient_user_id" "uuid" NOT NULL,
    "normalized_email" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "source_outbox_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cleared_at" timestamp with time zone,
    "cleared_by" "uuid",
    CONSTRAINT "transactional_email_suppression_clear_shape" CHECK (((("cleared_at" IS NULL) AND ("cleared_by" IS NULL)) OR (("cleared_at" IS NOT NULL) AND ("cleared_by" IS NOT NULL) AND ("reason" = 'administrator'::"text")))),
    CONSTRAINT "transactional_email_suppressions_normalized_email_check" CHECK (((("length"("normalized_email") >= 3) AND ("length"("normalized_email") <= 254)) AND ("normalized_email" = "lower"("btrim"("normalized_email"))))),
    CONSTRAINT "transactional_email_suppressions_reason_check" CHECK (("reason" = ANY (ARRAY['administrator'::"text", 'immediate_permanent'::"text", 'permanent_bounce'::"text", 'complaint'::"text"])))
);

ALTER TABLE ONLY "public"."transactional_email_suppressions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."transactional_email_suppressions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wanted_request_moderation_audit" (
    "id" bigint NOT NULL,
    "community_id" "uuid" NOT NULL,
    "request_id" "uuid" NOT NULL,
    "prior_status" "public"."wanted_request_status" NOT NULL,
    "next_status" "public"."wanted_request_status" NOT NULL,
    "reason" "text" NOT NULL,
    "actor_user_id" "uuid" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "wanted_request_moderation_audit_check" CHECK ((("next_status" = 'moderated'::"public"."wanted_request_status") OR ("prior_status" = 'moderated'::"public"."wanted_request_status")))
);

ALTER TABLE ONLY "public"."wanted_request_moderation_audit" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."wanted_request_moderation_audit" OWNER TO "postgres";


ALTER TABLE "public"."wanted_request_moderation_audit" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."wanted_request_moderation_audit_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."administrator_ai_setting_audit"
    ADD CONSTRAINT "administrator_ai_setting_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."administrator_orientation_progress"
    ADD CONSTRAINT "administrator_orientation_progress_pkey" PRIMARY KEY ("community_id", "administrator_id", "registry_version", "item_id");



ALTER TABLE ONLY "public"."administrator_orientation_registry"
    ADD CONSTRAINT "administrator_orientation_reg_registry_version_display_orde_key" UNIQUE ("registry_version", "display_order");



ALTER TABLE ONLY "public"."administrator_orientation_registry"
    ADD CONSTRAINT "administrator_orientation_registry_pkey" PRIMARY KEY ("registry_version", "item_id");



ALTER TABLE ONLY "public"."ai_activation_evidence"
    ADD CONSTRAINT "ai_activation_evidence_community_id_id_key" UNIQUE ("community_id", "id");



ALTER TABLE ONLY "public"."ai_activation_evidence"
    ADD CONSTRAINT "ai_activation_evidence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_draft_attempts"
    ADD CONSTRAINT "ai_draft_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_model_price_snapshots"
    ADD CONSTRAINT "ai_model_price_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."communities"
    ADD CONSTRAINT "communities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."communities"
    ADD CONSTRAINT "communities_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."community_roles"
    ADD CONSTRAINT "community_roles_pkey" PRIMARY KEY ("community_id", "user_id", "role");



ALTER TABLE ONLY "public"."community_setting_versions"
    ADD CONSTRAINT "community_setting_versions_pkey" PRIMARY KEY ("community_id", "version");



ALTER TABLE ONLY "public"."community_settings"
    ADD CONSTRAINT "community_settings_pkey" PRIMARY KEY ("community_id");



ALTER TABLE ONLY "public"."founding_steward_bootstrap"
    ADD CONSTRAINT "founding_steward_bootstrap_pkey" PRIMARY KEY ("community_id");



ALTER TABLE ONLY "public"."founding_steward_bootstrap"
    ADD CONSTRAINT "founding_steward_bootstrap_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."gear_loan_guideline_acceptances"
    ADD CONSTRAINT "gear_loan_guideline_acceptances_pkey" PRIMARY KEY ("loan_id");



ALTER TABLE ONLY "public"."gear_loans"
    ADD CONSTRAINT "gear_loans_community_id_id_key" UNIQUE ("community_id", "id");



ALTER TABLE ONLY "public"."gear_loans"
    ADD CONSTRAINT "gear_loans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gear_media_upload_attempts"
    ADD CONSTRAINT "gear_media_attempt_digest_unique" UNIQUE ("supply_id", "slot_index", "source_digest");



ALTER TABLE ONLY "public"."gear_media_upload_attempts"
    ADD CONSTRAINT "gear_media_upload_attempts_final_path_key" UNIQUE ("final_path");



ALTER TABLE ONLY "public"."gear_media_upload_attempts"
    ADD CONSTRAINT "gear_media_upload_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gear_media_upload_attempts"
    ADD CONSTRAINT "gear_media_upload_attempts_staging_path_key" UNIQUE ("staging_path");



ALTER TABLE ONLY "public"."join_question_versions"
    ADD CONSTRAINT "join_question_versions_community_id_version_key" UNIQUE ("community_id", "version");



ALTER TABLE ONLY "public"."join_question_versions"
    ADD CONSTRAINT "join_question_versions_id_community_id_key" UNIQUE ("id", "community_id");



ALTER TABLE ONLY "public"."join_question_versions"
    ADD CONSTRAINT "join_question_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."legacy_deactivation_backfill_manifest"
    ADD CONSTRAINT "legacy_deactivation_backfill_manifest_pkey" PRIMARY KEY ("profile_id");



ALTER TABLE ONLY "public"."loan_handoff_audit"
    ADD CONSTRAINT "loan_handoff_audit_loan_id_changed_at_id_key" UNIQUE ("loan_id", "changed_at", "id");



ALTER TABLE ONLY "public"."loan_handoff_audit"
    ADD CONSTRAINT "loan_handoff_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loan_reminder_events"
    ADD CONSTRAINT "loan_reminder_events_loan_id_end_date_time_zone_policy_vers_key" UNIQUE ("loan_id", "end_date", "time_zone", "policy_version", "reminder_kind", "ordinal", "recipient_user_id");



ALTER TABLE ONLY "public"."loan_reminder_events"
    ADD CONSTRAINT "loan_reminder_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loan_reminder_policies"
    ADD CONSTRAINT "loan_reminder_policies_pkey" PRIMARY KEY ("community_id");



ALTER TABLE ONLY "public"."member_postal_codes"
    ADD CONSTRAINT "member_postal_codes_pkey" PRIMARY KEY ("community_id", "profile_id");



ALTER TABLE ONLY "public"."member_profile_settings"
    ADD CONSTRAINT "member_profile_settings_pkey" PRIMARY KEY ("profile_id");



ALTER TABLE ONLY "public"."membership_applications"
    ADD CONSTRAINT "membership_applications_applicant_id_key" UNIQUE ("applicant_id");



ALTER TABLE ONLY "public"."membership_applications"
    ADD CONSTRAINT "membership_applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."membership_deactivation_consequences"
    ADD CONSTRAINT "membership_deactivation_conse_profile_id_deactivation_seque_key" UNIQUE ("profile_id", "deactivation_sequence");



ALTER TABLE ONLY "public"."membership_deactivation_consequences"
    ADD CONSTRAINT "membership_deactivation_consequences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."membership_reactivation_audit"
    ADD CONSTRAINT "membership_reactivation_audit_deactivation_id_key" UNIQUE ("deactivation_id");



ALTER TABLE ONLY "public"."membership_reactivation_audit"
    ADD CONSTRAINT "membership_reactivation_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."membership_reactivation_audit"
    ADD CONSTRAINT "membership_reactivation_audit_profile_id_preview_version_key" UNIQUE ("profile_id", "preview_version");



ALTER TABLE ONLY "public"."notification_delivery_attempts"
    ADD CONSTRAINT "notification_delivery_attempts_outbox_id_attempt_number_key" UNIQUE ("outbox_id", "attempt_number");



ALTER TABLE ONLY "public"."notification_delivery_attempts"
    ADD CONSTRAINT "notification_delivery_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_event_registry"
    ADD CONSTRAINT "notification_event_registry_pkey" PRIMARY KEY ("event_type");



ALTER TABLE ONLY "public"."private_notifications"
    ADD CONSTRAINT "private_notifications_event_type_authoritative_record_id_tr_key" UNIQUE ("event_type", "authoritative_record_id", "transition_version", "recipient_user_id");



ALTER TABLE ONLY "public"."private_notifications"
    ADD CONSTRAINT "private_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_community_id_id_key" UNIQUE ("community_id", "id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_audit"
    ADD CONSTRAINT "role_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ses_feedback_events"
    ADD CONSTRAINT "ses_feedback_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ses_feedback_events"
    ADD CONSTRAINT "ses_feedback_events_topic_arn_sns_message_id_key" UNIQUE ("topic_arn", "sns_message_id");



ALTER TABLE ONLY "public"."supplies"
    ADD CONSTRAINT "supplies_community_id_id_key" UNIQUE ("community_id", "id");



ALTER TABLE ONLY "public"."supplies"
    ADD CONSTRAINT "supplies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplies"
    ADD CONSTRAINT "supplies_publication_attempt_unique" UNIQUE ("community_id", "created_by", "publication_attempt_id");



ALTER TABLE ONLY "public"."supply_attention_audit"
    ADD CONSTRAINT "supply_attention_audit_id_community_id_key" UNIQUE ("id", "community_id");



ALTER TABLE ONLY "public"."supply_attention_audit"
    ADD CONSTRAINT "supply_attention_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supply_attention_audit"
    ADD CONSTRAINT "supply_attention_audit_supply_id_version_key" UNIQUE ("supply_id", "version");



ALTER TABLE ONLY "public"."supply_condition_history"
    ADD CONSTRAINT "supply_condition_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supply_donation_audit"
    ADD CONSTRAINT "supply_donation_audit_pkey" PRIMARY KEY ("supply_id");



ALTER TABLE ONLY "public"."supply_guideline_versions"
    ADD CONSTRAINT "supply_guideline_versions_pkey" PRIMARY KEY ("supply_id", "version");



ALTER TABLE ONLY "public"."transactional_email_outbox"
    ADD CONSTRAINT "transactional_email_outbox_delivery_tag_key" UNIQUE ("delivery_tag");



ALTER TABLE ONLY "public"."transactional_email_outbox"
    ADD CONSTRAINT "transactional_email_outbox_event_type_authoritative_record__key" UNIQUE ("event_type", "authoritative_record_id", "transition_version", "recipient_user_id");



ALTER TABLE ONLY "public"."transactional_email_outbox"
    ADD CONSTRAINT "transactional_email_outbox_notification_id_key" UNIQUE ("notification_id");



ALTER TABLE ONLY "public"."transactional_email_outbox"
    ADD CONSTRAINT "transactional_email_outbox_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transactional_email_preference_audit"
    ADD CONSTRAINT "transactional_email_preference_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transactional_email_preferences"
    ADD CONSTRAINT "transactional_email_preferences_pkey" PRIMARY KEY ("profile_id");



ALTER TABLE ONLY "public"."transactional_email_suppression_audit"
    ADD CONSTRAINT "transactional_email_suppression_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transactional_email_suppressions"
    ADD CONSTRAINT "transactional_email_suppressions_pkey" PRIMARY KEY ("recipient_user_id", "normalized_email");



ALTER TABLE ONLY "public"."wanted_offers"
    ADD CONSTRAINT "wanted_offers_community_id_id_key" UNIQUE ("community_id", "id");



ALTER TABLE ONLY "public"."wanted_offers"
    ADD CONSTRAINT "wanted_offers_community_id_request_id_id_key" UNIQUE ("community_id", "request_id", "id");



ALTER TABLE ONLY "public"."wanted_offers"
    ADD CONSTRAINT "wanted_offers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wanted_request_moderation_audit"
    ADD CONSTRAINT "wanted_request_moderation_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wanted_requests"
    ADD CONSTRAINT "wanted_requests_community_id_id_key" UNIQUE ("community_id", "id");



ALTER TABLE ONLY "public"."wanted_requests"
    ADD CONSTRAINT "wanted_requests_pkey" PRIMARY KEY ("id");



CREATE INDEX "ai_attempt_community_month_idx" ON "public"."ai_draft_attempts" USING "btree" ("community_id", "created_at" DESC);



CREATE INDEX "ai_attempt_user_rate_idx" ON "public"."ai_draft_attempts" USING "btree" ("requester_id", "created_at" DESC);



CREATE INDEX "community_roles_user_idx" ON "public"."community_roles" USING "btree" ("user_id", "community_id", "role");



CREATE INDEX "gear_loans_borrower_idx" ON "public"."gear_loans" USING "btree" ("borrower_id", "status", "start_date" DESC);



CREATE INDEX "gear_loans_cancelled_by_idx" ON "public"."gear_loans" USING "btree" ("cancelled_by") WHERE ("cancelled_by" IS NOT NULL);



CREATE INDEX "gear_loans_checked_out_by_idx" ON "public"."gear_loans" USING "btree" ("checked_out_by") WHERE ("checked_out_by" IS NOT NULL);



CREATE INDEX "gear_loans_committed_overlap_idx" ON "public"."gear_loans" USING "btree" ("supply_id", "start_date", "end_date") WHERE ("status" = ANY (ARRAY['approved'::"public"."gear_loan_status", 'checked_out'::"public"."gear_loan_status"]));



CREATE INDEX "gear_loans_community_status_idx" ON "public"."gear_loans" USING "btree" ("community_id", "status", "start_date");



CREATE INDEX "gear_loans_custodian_request_idx" ON "public"."gear_loans" USING "btree" ("custodian_at_request_id", "created_at" DESC);



CREATE INDEX "gear_loans_decided_by_idx" ON "public"."gear_loans" USING "btree" ("decided_by") WHERE ("decided_by" IS NOT NULL);



CREATE INDEX "gear_loans_handoff_contact_idx" ON "public"."gear_loans" USING "btree" ("handoff_contact_id", "status") WHERE ("handoff_contact_id" IS NOT NULL);



CREATE INDEX "gear_loans_returned_by_idx" ON "public"."gear_loans" USING "btree" ("returned_by") WHERE ("returned_by" IS NOT NULL);



CREATE INDEX "gear_loans_supply_history_idx" ON "public"."gear_loans" USING "btree" ("supply_id", "created_at" DESC);



CREATE INDEX "gear_media_attempt_supply_idx" ON "public"."gear_media_upload_attempts" USING "btree" ("supply_id", "slot_index", "created_at" DESC);



CREATE UNIQUE INDEX "join_question_one_current_idx" ON "public"."join_question_versions" USING "btree" ("community_id") WHERE "is_current";



CREATE INDEX "loan_handoff_audit_community_time_idx" ON "public"."loan_handoff_audit" USING "btree" ("community_id", "changed_at" DESC, "id");



CREATE INDEX "loan_reminder_events_loan_idx" ON "public"."loan_reminder_events" USING "btree" ("loan_id", "occurred_at" DESC, "id");



CREATE INDEX "loan_reminder_events_recipient_idx" ON "public"."loan_reminder_events" USING "btree" ("recipient_user_id", "occurred_at" DESC, "id" DESC);



CREATE INDEX "member_postal_lookup_idx" ON "public"."member_postal_codes" USING "btree" ("community_id", "postal_code", "profile_id");



CREATE INDEX "member_profile_settings_community_idx" ON "public"."member_profile_settings" USING "btree" ("community_id", "profile_id");



CREATE INDEX "membership_applications_community_time_idx" ON "public"."membership_applications" USING "btree" ("community_id", "submitted_at", "id");



CREATE INDEX "notification_delivery_attempts_outbox_idx" ON "public"."notification_delivery_attempts" USING "btree" ("outbox_id", "occurred_at" DESC);



CREATE INDEX "private_notifications_recipient_page_idx" ON "public"."private_notifications" USING "btree" ("recipient_user_id", "occurred_at" DESC, "id" DESC) WHERE ("dismissed_at" IS NULL);



CREATE INDEX "private_notifications_retention_idx" ON "public"."private_notifications" USING "btree" ("occurred_at", "id");



CREATE INDEX "profiles_approved_by_idx" ON "public"."profiles" USING "btree" ("approved_by") WHERE ("approved_by" IS NOT NULL);



CREATE INDEX "profiles_community_status_idx" ON "public"."profiles" USING "btree" ("community_id", "membership_status", "id");



CREATE INDEX "profiles_deactivated_by_idx" ON "public"."profiles" USING "btree" ("deactivated_by") WHERE ("deactivated_by" IS NOT NULL);



CREATE INDEX "profiles_rejected_by_idx" ON "public"."profiles" USING "btree" ("rejected_by") WHERE ("rejected_by" IS NOT NULL);



CREATE INDEX "role_audit_community_time_idx" ON "public"."role_audit" USING "btree" ("community_id", "occurred_at" DESC);



CREATE INDEX "role_audit_target_idx" ON "public"."role_audit" USING "btree" ("target_user_id", "occurred_at" DESC);



CREATE INDEX "ses_feedback_events_outbox_idx" ON "public"."ses_feedback_events" USING "btree" ("outbox_id", "occurred_at" DESC);



CREATE INDEX "supplies_catalog_category_idx" ON "public"."supplies" USING "btree" ("community_id", "category", "ownership_kind", "condition", "listing_status");



CREATE INDEX "supplies_catalog_idx" ON "public"."supplies" USING "btree" ("community_id", "listing_status", "title");



CREATE INDEX "supplies_created_by_idx" ON "public"."supplies" USING "btree" ("created_by");



CREATE INDEX "supplies_custodian_idx" ON "public"."supplies" USING "btree" ("custodian_id", "listing_status");



CREATE INDEX "supplies_owner_idx" ON "public"."supplies" USING "btree" ("owner_id") WHERE ("owner_id" IS NOT NULL);



CREATE INDEX "supplies_private_catalog_idx" ON "public"."supplies" USING "btree" ("community_id", "listing_status", "lower"("title"), "id");



CREATE INDEX "supply_attention_audit_community_time_idx" ON "public"."supply_attention_audit" USING "btree" ("community_id", "changed_at" DESC, "id");



CREATE INDEX "supply_condition_history_listing_idx" ON "public"."supply_condition_history" USING "btree" ("community_id", "supply_id", "changed_at" DESC);



CREATE INDEX "supply_donation_actor_idx" ON "public"."supply_donation_audit" USING "btree" ("converted_by");



CREATE INDEX "supply_donation_community_idx" ON "public"."supply_donation_audit" USING "btree" ("community_id", "converted_at" DESC);



CREATE INDEX "supply_donation_owner_idx" ON "public"."supply_donation_audit" USING "btree" ("prior_owner_id");



CREATE INDEX "supply_guideline_versions_community_idx" ON "public"."supply_guideline_versions" USING "btree" ("community_id", "supply_id", "version" DESC);



CREATE INDEX "transactional_email_outbox_claim_idx" ON "public"."transactional_email_outbox" USING "btree" (COALESCE("next_attempt_at", "created_at"), "created_at", "id") WHERE ("status" = ANY (ARRAY['pending'::"text", 'retry'::"text"]));



CREATE INDEX "transactional_email_outbox_provider_idx" ON "public"."transactional_email_outbox" USING "btree" ("provider_message_id") WHERE ("provider_message_id" IS NOT NULL);



CREATE INDEX "transactional_email_outbox_recipient_idx" ON "public"."transactional_email_outbox" USING "btree" ("recipient_user_id", "updated_at" DESC, "id" DESC);



CREATE INDEX "transactional_email_preference_audit_profile_idx" ON "public"."transactional_email_preference_audit" USING "btree" ("profile_id", "occurred_at" DESC, "id" DESC);



CREATE INDEX "transactional_email_suppression_audit_recipient_idx" ON "public"."transactional_email_suppression_audit" USING "btree" ("recipient_user_id", "occurred_at" DESC, "id" DESC);



CREATE INDEX "transactional_email_suppressions_active_idx" ON "public"."transactional_email_suppressions" USING "btree" ("recipient_user_id", "normalized_email") WHERE ("cleared_at" IS NULL);



CREATE INDEX "wanted_moderation_audit_request_idx" ON "public"."wanted_request_moderation_audit" USING "btree" ("community_id", "request_id", "occurred_at" DESC);



CREATE UNIQUE INDEX "wanted_offers_one_current_listing_idx" ON "public"."wanted_offers" USING "btree" ("request_id", "supply_id") WHERE ("status" = ANY (ARRAY['active'::"public"."wanted_offer_status", 'selected'::"public"."wanted_offer_status"]));



CREATE INDEX "wanted_offers_request_idx" ON "public"."wanted_offers" USING "btree" ("community_id", "request_id", "created_at", "id");



CREATE INDEX "wanted_offers_supply_idx" ON "public"."wanted_offers" USING "btree" ("community_id", "supply_id", "status");



CREATE INDEX "wanted_requests_board_idx" ON "public"."wanted_requests" USING "btree" ("community_id", "status", "created_at" DESC, "id" DESC);



CREATE INDEX "wanted_requests_requester_open_idx" ON "public"."wanted_requests" USING "btree" ("community_id", "requester_id", "status") WHERE ("status" = 'open'::"public"."wanted_request_status");



CREATE OR REPLACE TRIGGER "administrator_ai_setting_audit_protected" BEFORE INSERT OR DELETE OR UPDATE ON "public"."administrator_ai_setting_audit" FOR EACH ROW EXECUTE FUNCTION "public"."protect_milestone_six_state"();



CREATE OR REPLACE TRIGGER "ai_activation_evidence_immutable" BEFORE DELETE OR UPDATE ON "public"."ai_activation_evidence" FOR EACH ROW EXECUTE FUNCTION "public"."reject_ai_evidence_change"();



CREATE OR REPLACE TRIGGER "ai_draft_attempts_protected" BEFORE INSERT OR DELETE OR UPDATE ON "public"."ai_draft_attempts" FOR EACH ROW EXECUTE FUNCTION "public"."protect_ai_attempt_change"();



CREATE OR REPLACE TRIGGER "ai_price_snapshots_immutable" BEFORE DELETE OR UPDATE ON "public"."ai_model_price_snapshots" FOR EACH ROW EXECUTE FUNCTION "public"."reject_ai_evidence_change"();



CREATE OR REPLACE TRIGGER "communities_set_updated_at" BEFORE UPDATE ON "public"."communities" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "community_setting_versions_protected" BEFORE INSERT OR DELETE OR UPDATE ON "public"."community_setting_versions" FOR EACH ROW EXECUTE FUNCTION "public"."protect_milestone_six_state"();



CREATE OR REPLACE TRIGGER "community_settings_protected" BEFORE INSERT OR DELETE OR UPDATE ON "public"."community_settings" FOR EACH ROW EXECUTE FUNCTION "public"."protect_milestone_six_state"();



CREATE OR REPLACE TRIGGER "deactivation_consequences_protected" BEFORE INSERT OR DELETE OR UPDATE ON "public"."membership_deactivation_consequences" FOR EACH ROW EXECUTE FUNCTION "public"."protect_milestone_six_state"();



CREATE OR REPLACE TRIGGER "gear_loan_guideline_acceptances_immutable" BEFORE DELETE OR UPDATE ON "public"."gear_loan_guideline_acceptances" FOR EACH ROW EXECUTE FUNCTION "public"."reject_m7_immutable_change"();



CREATE OR REPLACE TRIGGER "gear_loan_insert_notification" AFTER INSERT ON "public"."gear_loans" FOR EACH ROW EXECUTE FUNCTION "public"."notify_loan_transition"();



CREATE OR REPLACE TRIGGER "gear_loan_status_notification" AFTER UPDATE OF "status" ON "public"."gear_loans" FOR EACH ROW EXECUTE FUNCTION "public"."notify_loan_transition"();



CREATE OR REPLACE TRIGGER "gear_loans_capture_handoff_contact" BEFORE UPDATE ON "public"."gear_loans" FOR EACH ROW EXECUTE FUNCTION "public"."capture_loan_handoff_contact"();



CREATE OR REPLACE TRIGGER "gear_loans_immutable_request" BEFORE UPDATE ON "public"."gear_loans" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_loan_audit_rewrite"();



CREATE OR REPLACE TRIGGER "gear_loans_set_updated_at" BEFORE UPDATE ON "public"."gear_loans" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "legacy_deactivation_backfill_manifest_protected" BEFORE INSERT OR DELETE OR UPDATE ON "public"."legacy_deactivation_backfill_manifest" FOR EACH ROW EXECUTE FUNCTION "public"."protect_legacy_deactivation_manifest"();



CREATE OR REPLACE TRIGGER "loan_handoff_audit_immutable" BEFORE DELETE OR UPDATE ON "public"."loan_handoff_audit" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_operational_audit_rewrite"();



CREATE OR REPLACE TRIGGER "loan_reminder_events_immutable" BEFORE DELETE OR UPDATE ON "public"."loan_reminder_events" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_operational_audit_rewrite"();



CREATE OR REPLACE TRIGGER "loan_reminder_notification" AFTER INSERT ON "public"."loan_reminder_events" FOR EACH ROW EXECUTE FUNCTION "public"."notify_loan_reminder_insert"();



CREATE OR REPLACE TRIGGER "loan_reminder_policy_versioned" BEFORE UPDATE ON "public"."loan_reminder_policies" FOR EACH ROW EXECUTE FUNCTION "public"."protect_loan_reminder_policy"();



CREATE OR REPLACE TRIGGER "membership_application_notification" AFTER INSERT ON "public"."membership_applications" FOR EACH ROW EXECUTE FUNCTION "public"."notify_membership_application_insert"();



CREATE OR REPLACE TRIGGER "notification_delivery_attempts_protected" BEFORE DELETE OR UPDATE ON "public"."notification_delivery_attempts" FOR EACH ROW EXECUTE FUNCTION "public"."protect_notification_operational_tables"();



CREATE OR REPLACE TRIGGER "notification_event_registry_immutable" BEFORE DELETE OR UPDATE ON "public"."notification_event_registry" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_notification_registry_rewrite"();



CREATE OR REPLACE TRIGGER "orientation_progress_protected" BEFORE INSERT OR DELETE OR UPDATE ON "public"."administrator_orientation_progress" FOR EACH ROW EXECUTE FUNCTION "public"."protect_milestone_six_state"();



CREATE OR REPLACE TRIGGER "orientation_registry_protected" BEFORE INSERT OR DELETE OR UPDATE ON "public"."administrator_orientation_registry" FOR EACH ROW EXECUTE FUNCTION "public"."protect_milestone_six_state"();



CREATE OR REPLACE TRIGGER "private_notifications_protected" BEFORE DELETE OR UPDATE ON "public"."private_notifications" FOR EACH ROW EXECUTE FUNCTION "public"."protect_notification_operational_tables"();



CREATE OR REPLACE TRIGGER "profile_membership_notification" AFTER UPDATE OF "membership_status" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."notify_membership_status_transition"();



CREATE OR REPLACE TRIGGER "profiles_set_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "profiles_terminal_membership" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_terminal_membership_reactivation"();



CREATE OR REPLACE TRIGGER "reactivation_audit_protected" BEFORE INSERT OR DELETE OR UPDATE ON "public"."membership_reactivation_audit" FOR EACH ROW EXECUTE FUNCTION "public"."protect_milestone_six_state"();



CREATE OR REPLACE TRIGGER "role_audit_notification" AFTER INSERT ON "public"."role_audit" FOR EACH ROW EXECUTE FUNCTION "public"."notify_role_audit_insert"();



CREATE OR REPLACE TRIGGER "ses_feedback_events_protected" BEFORE DELETE OR UPDATE ON "public"."ses_feedback_events" FOR EACH ROW EXECUTE FUNCTION "public"."protect_notification_operational_tables"();



CREATE OR REPLACE TRIGGER "supplies_initialize_attention" BEFORE INSERT ON "public"."supplies" FOR EACH ROW EXECUTE FUNCTION "public"."protect_supply_attention_state"();



CREATE OR REPLACE TRIGGER "supplies_invalidate_wanted_offers" AFTER UPDATE OF "listing_status" ON "public"."supplies" FOR EACH ROW EXECUTE FUNCTION "public"."wanted_offer_listing_status_trigger"();



CREATE OR REPLACE TRIGGER "supplies_protect_attention" BEFORE UPDATE OF "needs_attention", "needs_attention_reason", "needs_attention_version" ON "public"."supplies" FOR EACH ROW EXECUTE FUNCTION "public"."protect_supply_attention_state"();



CREATE OR REPLACE TRIGGER "supplies_recoverable_draft_publication" BEFORE UPDATE OF "listing_status" ON "public"."supplies" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_recoverable_draft_publication"();



CREATE OR REPLACE TRIGGER "supplies_set_updated_at" BEFORE UPDATE ON "public"."supplies" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "supply_attention_audit_immutable" BEFORE DELETE OR UPDATE ON "public"."supply_attention_audit" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_operational_audit_rewrite"();



CREATE OR REPLACE TRIGGER "supply_condition_history_immutable" BEFORE DELETE OR UPDATE ON "public"."supply_condition_history" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_supply_condition_history_rewrite"();



CREATE OR REPLACE TRIGGER "supply_guideline_versions_immutable" BEFORE DELETE OR UPDATE ON "public"."supply_guideline_versions" FOR EACH ROW EXECUTE FUNCTION "public"."reject_m7_immutable_change"();



CREATE OR REPLACE TRIGGER "transactional_email_outbox_protected" BEFORE DELETE OR UPDATE ON "public"."transactional_email_outbox" FOR EACH ROW EXECUTE FUNCTION "public"."protect_notification_operational_tables"();



CREATE OR REPLACE TRIGGER "transactional_email_preference_audit_protected" BEFORE DELETE OR UPDATE ON "public"."transactional_email_preference_audit" FOR EACH ROW EXECUTE FUNCTION "public"."protect_notification_operational_tables"();



CREATE OR REPLACE TRIGGER "transactional_email_preferences_protected" BEFORE DELETE OR UPDATE ON "public"."transactional_email_preferences" FOR EACH ROW EXECUTE FUNCTION "public"."protect_notification_operational_tables"();



CREATE OR REPLACE TRIGGER "transactional_email_suppression_audit_protected" BEFORE DELETE OR UPDATE ON "public"."transactional_email_suppression_audit" FOR EACH ROW EXECUTE FUNCTION "public"."protect_notification_operational_tables"();



CREATE OR REPLACE TRIGGER "transactional_email_suppressions_protected" BEFORE DELETE OR UPDATE ON "public"."transactional_email_suppressions" FOR EACH ROW EXECUTE FUNCTION "public"."protect_notification_operational_tables"();



CREATE OR REPLACE TRIGGER "wanted_request_moderation_audit_immutable" BEFORE DELETE OR UPDATE ON "public"."wanted_request_moderation_audit" FOR EACH ROW EXECUTE FUNCTION "public"."reject_m7_immutable_change"();



ALTER TABLE ONLY "public"."administrator_ai_setting_audit"
    ADD CONSTRAINT "administrator_ai_setting_audi_community_id_configuration_v_fkey" FOREIGN KEY ("community_id", "configuration_version") REFERENCES "public"."community_setting_versions"("community_id", "version") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."administrator_ai_setting_audit"
    ADD CONSTRAINT "administrator_ai_setting_audit_community_id_actor_user_id_fkey" FOREIGN KEY ("community_id", "actor_user_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."administrator_ai_setting_audit"
    ADD CONSTRAINT "administrator_ai_setting_audit_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."administrator_orientation_progress"
    ADD CONSTRAINT "administrator_orientation_pro_community_id_administrator_i_fkey" FOREIGN KEY ("community_id", "administrator_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."administrator_orientation_progress"
    ADD CONSTRAINT "administrator_orientation_progres_registry_version_item_id_fkey" FOREIGN KEY ("registry_version", "item_id") REFERENCES "public"."administrator_orientation_registry"("registry_version", "item_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."administrator_orientation_progress"
    ADD CONSTRAINT "administrator_orientation_progress_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ai_activation_evidence"
    ADD CONSTRAINT "ai_activation_evidence_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ai_activation_evidence"
    ADD CONSTRAINT "ai_activation_evidence_price_snapshot_id_fkey" FOREIGN KEY ("price_snapshot_id") REFERENCES "public"."ai_model_price_snapshots"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ai_draft_attempts"
    ADD CONSTRAINT "ai_draft_attempts_community_id_activation_evidence_id_fkey" FOREIGN KEY ("community_id", "activation_evidence_id") REFERENCES "public"."ai_activation_evidence"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ai_draft_attempts"
    ADD CONSTRAINT "ai_draft_attempts_community_id_requester_id_fkey" FOREIGN KEY ("community_id", "requester_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ai_draft_attempts"
    ADD CONSTRAINT "ai_draft_attempts_price_snapshot_id_fkey" FOREIGN KEY ("price_snapshot_id") REFERENCES "public"."ai_model_price_snapshots"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."community_roles"
    ADD CONSTRAINT "community_roles_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."community_roles"
    ADD CONSTRAINT "community_roles_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."community_roles"
    ADD CONSTRAINT "community_roles_member_same_community_fkey" FOREIGN KEY ("community_id", "user_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."community_roles"
    ADD CONSTRAINT "community_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."community_setting_versions"
    ADD CONSTRAINT "community_setting_versions_community_id_changed_by_fkey" FOREIGN KEY ("community_id", "changed_by") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."community_setting_versions"
    ADD CONSTRAINT "community_setting_versions_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."community_settings"
    ADD CONSTRAINT "community_settings_community_id_current_version_fkey" FOREIGN KEY ("community_id", "current_version") REFERENCES "public"."community_setting_versions"("community_id", "version") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."community_settings"
    ADD CONSTRAINT "community_settings_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."community_settings"
    ADD CONSTRAINT "community_settings_community_id_updated_by_fkey" FOREIGN KEY ("community_id", "updated_by") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."founding_steward_bootstrap"
    ADD CONSTRAINT "founding_steward_bootstrap_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."founding_steward_bootstrap"
    ADD CONSTRAINT "founding_steward_bootstrap_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_loan_guideline_acceptances"
    ADD CONSTRAINT "gear_loan_guideline_acceptance_supply_id_guideline_version_fkey" FOREIGN KEY ("supply_id", "guideline_version") REFERENCES "public"."supply_guideline_versions"("supply_id", "version") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_loan_guideline_acceptances"
    ADD CONSTRAINT "gear_loan_guideline_acceptances_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_loan_guideline_acceptances"
    ADD CONSTRAINT "gear_loan_guideline_acceptances_community_id_accepted_by_fkey" FOREIGN KEY ("community_id", "accepted_by") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_loan_guideline_acceptances"
    ADD CONSTRAINT "gear_loan_guideline_acceptances_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_loan_guideline_acceptances"
    ADD CONSTRAINT "gear_loan_guideline_acceptances_community_id_loan_id_fkey" FOREIGN KEY ("community_id", "loan_id") REFERENCES "public"."gear_loans"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_loan_guideline_acceptances"
    ADD CONSTRAINT "gear_loan_guideline_acceptances_community_id_supply_id_fkey" FOREIGN KEY ("community_id", "supply_id") REFERENCES "public"."supplies"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_loans"
    ADD CONSTRAINT "gear_loans_borrower_id_fkey" FOREIGN KEY ("borrower_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_loans"
    ADD CONSTRAINT "gear_loans_borrower_same_community_fkey" FOREIGN KEY ("community_id", "borrower_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_loans"
    ADD CONSTRAINT "gear_loans_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_loans"
    ADD CONSTRAINT "gear_loans_checked_out_by_fkey" FOREIGN KEY ("checked_out_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_loans"
    ADD CONSTRAINT "gear_loans_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_loans"
    ADD CONSTRAINT "gear_loans_custodian_at_request_id_fkey" FOREIGN KEY ("custodian_at_request_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_loans"
    ADD CONSTRAINT "gear_loans_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_loans"
    ADD CONSTRAINT "gear_loans_handoff_contact_id_fkey" FOREIGN KEY ("handoff_contact_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_loans"
    ADD CONSTRAINT "gear_loans_handoff_same_community_fkey" FOREIGN KEY ("handoff_contact_id", "community_id") REFERENCES "public"."profiles"("id", "community_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_loans"
    ADD CONSTRAINT "gear_loans_request_custodian_same_community_fkey" FOREIGN KEY ("community_id", "custodian_at_request_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_loans"
    ADD CONSTRAINT "gear_loans_returned_by_fkey" FOREIGN KEY ("returned_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_loans"
    ADD CONSTRAINT "gear_loans_supply_id_fkey" FOREIGN KEY ("supply_id") REFERENCES "public"."supplies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_loans"
    ADD CONSTRAINT "gear_loans_supply_same_community_fkey" FOREIGN KEY ("community_id", "supply_id") REFERENCES "public"."supplies"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_media_upload_attempts"
    ADD CONSTRAINT "gear_media_upload_attempts_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_media_upload_attempts"
    ADD CONSTRAINT "gear_media_upload_attempts_supply_id_fkey" FOREIGN KEY ("supply_id") REFERENCES "public"."supplies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gear_media_upload_attempts"
    ADD CONSTRAINT "gear_media_upload_attempts_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."join_question_versions"
    ADD CONSTRAINT "join_question_versions_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."join_question_versions"
    ADD CONSTRAINT "join_question_versions_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."legacy_deactivation_backfill_manifest"
    ADD CONSTRAINT "legacy_deactivation_backfill__community_id_successor_user__fkey" FOREIGN KEY ("community_id", "successor_user_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."legacy_deactivation_backfill_manifest"
    ADD CONSTRAINT "legacy_deactivation_backfill_m_community_id_deactivated_by_fkey" FOREIGN KEY ("community_id", "deactivated_by") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."legacy_deactivation_backfill_manifest"
    ADD CONSTRAINT "legacy_deactivation_backfill_manif_community_id_profile_id_fkey" FOREIGN KEY ("community_id", "profile_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."legacy_deactivation_backfill_manifest"
    ADD CONSTRAINT "legacy_deactivation_backfill_manifest_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."legacy_deactivation_backfill_manifest"
    ADD CONSTRAINT "legacy_deactivation_backfill_manifest_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."loan_handoff_audit"
    ADD CONSTRAINT "loan_handoff_audit_community_id_changed_by_fkey" FOREIGN KEY ("community_id", "changed_by") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."loan_handoff_audit"
    ADD CONSTRAINT "loan_handoff_audit_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."loan_handoff_audit"
    ADD CONSTRAINT "loan_handoff_audit_community_id_loan_id_fkey" FOREIGN KEY ("community_id", "loan_id") REFERENCES "public"."gear_loans"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."loan_handoff_audit"
    ADD CONSTRAINT "loan_handoff_audit_community_id_next_handoff_id_fkey" FOREIGN KEY ("community_id", "next_handoff_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."loan_handoff_audit"
    ADD CONSTRAINT "loan_handoff_audit_community_id_prior_handoff_id_fkey" FOREIGN KEY ("community_id", "prior_handoff_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."loan_reminder_events"
    ADD CONSTRAINT "loan_reminder_events_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."loan_reminder_events"
    ADD CONSTRAINT "loan_reminder_events_community_id_loan_id_fkey" FOREIGN KEY ("community_id", "loan_id") REFERENCES "public"."gear_loans"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."loan_reminder_events"
    ADD CONSTRAINT "loan_reminder_events_community_id_recipient_user_id_fkey" FOREIGN KEY ("community_id", "recipient_user_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."loan_reminder_policies"
    ADD CONSTRAINT "loan_reminder_policies_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."member_postal_codes"
    ADD CONSTRAINT "member_postal_profile_same_community_fkey" FOREIGN KEY ("community_id", "profile_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."member_profile_settings"
    ADD CONSTRAINT "member_profile_same_community_fkey" FOREIGN KEY ("profile_id", "community_id") REFERENCES "public"."profiles"("id", "community_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."member_profile_settings"
    ADD CONSTRAINT "member_profile_settings_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."member_profile_settings"
    ADD CONSTRAINT "member_profile_settings_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."membership_applications"
    ADD CONSTRAINT "membership_application_profile_same_community_fkey" FOREIGN KEY ("applicant_id", "community_id") REFERENCES "public"."profiles"("id", "community_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."membership_applications"
    ADD CONSTRAINT "membership_application_question_same_community_fkey" FOREIGN KEY ("question_version_id", "community_id") REFERENCES "public"."join_question_versions"("id", "community_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."membership_applications"
    ADD CONSTRAINT "membership_applications_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."membership_applications"
    ADD CONSTRAINT "membership_applications_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."membership_applications"
    ADD CONSTRAINT "membership_applications_question_version_id_fkey" FOREIGN KEY ("question_version_id") REFERENCES "public"."join_question_versions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."membership_deactivation_consequences"
    ADD CONSTRAINT "membership_deactivation_conse_community_id_successor_user__fkey" FOREIGN KEY ("community_id", "successor_user_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."membership_deactivation_consequences"
    ADD CONSTRAINT "membership_deactivation_conseq_community_id_deactivated_by_fkey" FOREIGN KEY ("community_id", "deactivated_by") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."membership_deactivation_consequences"
    ADD CONSTRAINT "membership_deactivation_consequenc_community_id_profile_id_fkey" FOREIGN KEY ("community_id", "profile_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."membership_deactivation_consequences"
    ADD CONSTRAINT "membership_deactivation_consequences_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."membership_reactivation_audit"
    ADD CONSTRAINT "membership_reactivation_audit_community_id_actor_user_id_fkey" FOREIGN KEY ("community_id", "actor_user_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."membership_reactivation_audit"
    ADD CONSTRAINT "membership_reactivation_audit_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."membership_reactivation_audit"
    ADD CONSTRAINT "membership_reactivation_audit_community_id_profile_id_fkey" FOREIGN KEY ("community_id", "profile_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."membership_reactivation_audit"
    ADD CONSTRAINT "membership_reactivation_audit_deactivation_id_fkey" FOREIGN KEY ("deactivation_id") REFERENCES "public"."membership_deactivation_consequences"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."notification_delivery_attempts"
    ADD CONSTRAINT "notification_delivery_attempts_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "public"."transactional_email_outbox"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."private_notifications"
    ADD CONSTRAINT "private_notifications_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."private_notifications"
    ADD CONSTRAINT "private_notifications_community_id_recipient_user_id_fkey" FOREIGN KEY ("community_id", "recipient_user_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."private_notifications"
    ADD CONSTRAINT "private_notifications_event_type_fkey" FOREIGN KEY ("event_type") REFERENCES "public"."notification_event_registry"("event_type") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_deactivated_by_fkey" FOREIGN KEY ("deactivated_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_rejected_by_fkey" FOREIGN KEY ("rejected_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."role_audit"
    ADD CONSTRAINT "role_audit_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."role_audit"
    ADD CONSTRAINT "role_audit_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."role_audit"
    ADD CONSTRAINT "role_audit_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ses_feedback_events"
    ADD CONSTRAINT "ses_feedback_events_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "public"."transactional_email_outbox"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplies"
    ADD CONSTRAINT "supplies_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplies"
    ADD CONSTRAINT "supplies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplies"
    ADD CONSTRAINT "supplies_custodian_id_fkey" FOREIGN KEY ("custodian_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplies"
    ADD CONSTRAINT "supplies_custodian_same_community_fkey" FOREIGN KEY ("community_id", "custodian_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplies"
    ADD CONSTRAINT "supplies_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplies"
    ADD CONSTRAINT "supplies_owner_same_community_fkey" FOREIGN KEY ("community_id", "owner_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supply_attention_audit"
    ADD CONSTRAINT "supply_attention_audit_community_id_changed_by_fkey" FOREIGN KEY ("community_id", "changed_by") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supply_attention_audit"
    ADD CONSTRAINT "supply_attention_audit_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supply_attention_audit"
    ADD CONSTRAINT "supply_attention_audit_community_id_source_loan_id_fkey" FOREIGN KEY ("community_id", "source_loan_id") REFERENCES "public"."gear_loans"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supply_attention_audit"
    ADD CONSTRAINT "supply_attention_audit_community_id_supply_id_fkey" FOREIGN KEY ("community_id", "supply_id") REFERENCES "public"."supplies"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supply_condition_history"
    ADD CONSTRAINT "supply_condition_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supply_condition_history"
    ADD CONSTRAINT "supply_condition_supply_same_community_fkey" FOREIGN KEY ("community_id", "supply_id") REFERENCES "public"."supplies"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supply_donation_audit"
    ADD CONSTRAINT "supply_donation_audit_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supply_donation_audit"
    ADD CONSTRAINT "supply_donation_audit_converted_by_fkey" FOREIGN KEY ("converted_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supply_donation_audit"
    ADD CONSTRAINT "supply_donation_audit_prior_owner_id_fkey" FOREIGN KEY ("prior_owner_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supply_donation_audit"
    ADD CONSTRAINT "supply_donation_audit_supply_id_fkey" FOREIGN KEY ("supply_id") REFERENCES "public"."supplies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supply_donation_audit"
    ADD CONSTRAINT "supply_donation_supply_same_community_fkey" FOREIGN KEY ("community_id", "supply_id") REFERENCES "public"."supplies"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supply_guideline_versions"
    ADD CONSTRAINT "supply_guideline_versions_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supply_guideline_versions"
    ADD CONSTRAINT "supply_guideline_versions_community_id_changed_by_fkey" FOREIGN KEY ("community_id", "changed_by") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supply_guideline_versions"
    ADD CONSTRAINT "supply_guideline_versions_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supply_guideline_versions"
    ADD CONSTRAINT "supply_guideline_versions_community_id_supply_id_fkey" FOREIGN KEY ("community_id", "supply_id") REFERENCES "public"."supplies"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."transactional_email_outbox"
    ADD CONSTRAINT "transactional_email_outbox_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."transactional_email_outbox"
    ADD CONSTRAINT "transactional_email_outbox_community_id_recipient_user_id_fkey" FOREIGN KEY ("community_id", "recipient_user_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."transactional_email_outbox"
    ADD CONSTRAINT "transactional_email_outbox_event_type_fkey" FOREIGN KEY ("event_type") REFERENCES "public"."notification_event_registry"("event_type") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."transactional_email_outbox"
    ADD CONSTRAINT "transactional_email_outbox_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "public"."private_notifications"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transactional_email_preference_audit"
    ADD CONSTRAINT "transactional_email_preference_aud_community_id_profile_id_fkey" FOREIGN KEY ("community_id", "profile_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."transactional_email_preference_audit"
    ADD CONSTRAINT "transactional_email_preference_audit_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."transactional_email_preference_audit"
    ADD CONSTRAINT "transactional_email_preference_audit_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."transactional_email_preferences"
    ADD CONSTRAINT "transactional_email_preferences_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."transactional_email_preferences"
    ADD CONSTRAINT "transactional_email_preferences_community_id_profile_id_fkey" FOREIGN KEY ("community_id", "profile_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."transactional_email_suppression_audit"
    ADD CONSTRAINT "transactional_email_suppress_community_id_recipient_user__fkey1" FOREIGN KEY ("community_id", "recipient_user_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."transactional_email_suppressions"
    ADD CONSTRAINT "transactional_email_suppressi_community_id_recipient_user__fkey" FOREIGN KEY ("community_id", "recipient_user_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."transactional_email_suppression_audit"
    ADD CONSTRAINT "transactional_email_suppression_audit_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."transactional_email_suppression_audit"
    ADD CONSTRAINT "transactional_email_suppression_audit_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."transactional_email_suppressions"
    ADD CONSTRAINT "transactional_email_suppressions_cleared_by_fkey" FOREIGN KEY ("cleared_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."transactional_email_suppressions"
    ADD CONSTRAINT "transactional_email_suppressions_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."transactional_email_suppressions"
    ADD CONSTRAINT "transactional_email_suppressions_source_outbox_id_fkey" FOREIGN KEY ("source_outbox_id") REFERENCES "public"."transactional_email_outbox"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."wanted_offers"
    ADD CONSTRAINT "wanted_offers_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."wanted_offers"
    ADD CONSTRAINT "wanted_offers_community_id_offerer_id_fkey" FOREIGN KEY ("community_id", "offerer_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."wanted_offers"
    ADD CONSTRAINT "wanted_offers_community_id_request_id_fkey" FOREIGN KEY ("community_id", "request_id") REFERENCES "public"."wanted_requests"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."wanted_offers"
    ADD CONSTRAINT "wanted_offers_community_id_supply_id_fkey" FOREIGN KEY ("community_id", "supply_id") REFERENCES "public"."supplies"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."wanted_request_moderation_audit"
    ADD CONSTRAINT "wanted_request_moderation_audit_community_id_actor_user_id_fkey" FOREIGN KEY ("community_id", "actor_user_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."wanted_request_moderation_audit"
    ADD CONSTRAINT "wanted_request_moderation_audit_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."wanted_request_moderation_audit"
    ADD CONSTRAINT "wanted_request_moderation_audit_community_id_request_id_fkey" FOREIGN KEY ("community_id", "request_id") REFERENCES "public"."wanted_requests"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."wanted_requests"
    ADD CONSTRAINT "wanted_requests_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."wanted_requests"
    ADD CONSTRAINT "wanted_requests_community_id_requester_id_fkey" FOREIGN KEY ("community_id", "requester_id") REFERENCES "public"."profiles"("community_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."wanted_requests"
    ADD CONSTRAINT "wanted_requests_selected_offer_fk" FOREIGN KEY ("community_id", "id", "selected_offer_id") REFERENCES "public"."wanted_offers"("community_id", "request_id", "id") ON DELETE RESTRICT;



ALTER TABLE "public"."administrator_ai_setting_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."administrator_orientation_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."administrator_orientation_registry" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_activation_evidence" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_draft_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_model_price_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bootstrap_steward_read" ON "public"."founding_steward_bootstrap" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_active_steward"("founding_steward_bootstrap"."community_id") AS "is_active_steward"));



ALTER TABLE "public"."communities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "communities_active_member_read" ON "public"."communities" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_active_member"("communities"."id") AS "is_active_member"));



ALTER TABLE "public"."community_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."community_setting_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."community_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "donation_audit_steward_read" ON "public"."supply_donation_audit" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_active_steward"("supply_donation_audit"."community_id") AS "is_active_steward"));



ALTER TABLE "public"."founding_steward_bootstrap" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gear_loan_guideline_acceptances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gear_loans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "gear_loans_participant_read" ON "public"."gear_loans" FOR SELECT TO "authenticated" USING ((( SELECT "public"."is_active_member"("gear_loans"."community_id") AS "is_active_member") AND (("borrower_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."supplies" "s"
  WHERE (("s"."id" = "gear_loans"."supply_id") AND ("s"."community_id" = "gear_loans"."community_id") AND ((("s"."ownership_kind" = 'individual'::"public"."ownership_kind") AND ("s"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))) OR (("s"."ownership_kind" = 'group'::"public"."ownership_kind") AND ( SELECT "public"."is_active_inventory_manager"("gear_loans"."community_id") AS "is_active_inventory_manager")) OR (("s"."ownership_kind" = 'individual'::"public"."ownership_kind") AND ( SELECT "public"."is_active_administrator"("gear_loans"."community_id") AS "is_active_administrator")))))))));



CREATE POLICY "gear_media_attempt_owner_read" ON "public"."gear_media_upload_attempts" FOR SELECT TO "authenticated" USING ((("uploader_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "public"."is_active_member"("gear_media_upload_attempts"."community_id") AS "is_active_member")));



ALTER TABLE "public"."gear_media_upload_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."join_question_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."legacy_deactivation_backfill_manifest" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loan_handoff_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loan_reminder_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loan_reminder_policies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "member_postal_authorized_read" ON "public"."member_postal_codes" FOR SELECT TO "authenticated" USING ((("profile_id" = ( SELECT "auth"."uid"() AS "uid")) OR (( SELECT "public"."is_active_member"("member_postal_codes"."community_id") AS "is_active_member") AND (EXISTS ( SELECT 1
   FROM "public"."supplies" "s"
  WHERE (("s"."community_id" = "member_postal_codes"."community_id") AND ("s"."custodian_id" = "member_postal_codes"."profile_id") AND ("s"."listing_status" = 'listed'::"public"."listing_status")))))));



ALTER TABLE "public"."member_postal_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."member_profile_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."membership_applications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."membership_deactivation_consequences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."membership_reactivation_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_delivery_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_event_registry" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."private_notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_inventory_context_read" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("membership_status" = 'active'::"public"."membership_status") AND ( SELECT "public"."is_active_inventory_manager"("profiles"."community_id") AS "is_active_inventory_manager")));



CREATE POLICY "profiles_self_read" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."role_audit" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "role_audit_steward_read" ON "public"."role_audit" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_active_steward"("role_audit"."community_id") AS "is_active_steward"));



CREATE POLICY "roles_self_or_admin_read" ON "public"."community_roles" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_active_administrator"("community_roles"."community_id") AS "is_active_administrator")));



ALTER TABLE "public"."ses_feedback_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."supplies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "supplies_active_community_read" ON "public"."supplies" FOR SELECT TO "authenticated" USING ((( SELECT "public"."is_active_member"("supplies"."community_id") AS "is_active_member") AND (("listing_status" <> 'unlisted'::"public"."listing_status") OR ("created_by" = ( SELECT "auth"."uid"() AS "uid")) OR ("owner_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_active_inventory_manager"("supplies"."community_id") AS "is_active_inventory_manager"))));



ALTER TABLE "public"."supply_attention_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."supply_condition_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "supply_condition_history_member_read" ON "public"."supply_condition_history" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_active_member"("supply_condition_history"."community_id") AS "is_active_member"));



ALTER TABLE "public"."supply_donation_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."supply_guideline_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transactional_email_outbox" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transactional_email_preference_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transactional_email_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transactional_email_suppression_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transactional_email_suppressions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wanted_offers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wanted_request_moderation_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wanted_requests" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";








GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






































































































































































































REVOKE ALL ON FUNCTION "public"."active_member_introduction"("target_profile_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."active_member_introduction"("target_profile_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."apply_verified_ses_feedback"("supplied_topic_arn" "text", "supplied_sns_message_id" "text", "supplied_feedback_kind" "text", "supplied_ses_message_id" "text", "supplied_recipient_email" "text", "supplied_delivery_tag" "uuid", "supplied_occurred_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_verified_ses_feedback"("supplied_topic_arn" "text", "supplied_sns_message_id" "text", "supplied_feedback_kind" "text", "supplied_ses_message_id" "text", "supplied_recipient_email" "text", "supplied_delivery_tag" "uuid", "supplied_occurred_at" timestamp with time zone) TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."gear_loans" TO "service_role";
GRANT SELECT ON TABLE "public"."gear_loans" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."approve_gear_loan"("target_loan_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."approve_gear_loan"("target_loan_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."approve_gear_loan"("target_loan_id" "uuid", "supplied_handoff_contact_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."approve_gear_loan"("target_loan_id" "uuid", "supplied_handoff_contact_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."available_quantity"("target_supply_id" "uuid", "range_start" "date", "range_end" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."available_quantity"("target_supply_id" "uuid", "range_start" "date", "range_end" "date") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."batch_stage_gear_drafts"("supplied_candidates" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."batch_stage_gear_drafts"("supplied_candidates" "jsonb") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."gear_media_upload_attempts" TO "service_role";
GRANT SELECT ON TABLE "public"."gear_media_upload_attempts" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."begin_gear_media_upload"("target_supply_id" "uuid", "supplied_slot" integer, "supplied_source_digest" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."begin_gear_media_upload"("target_supply_id" "uuid", "supplied_slot" integer, "supplied_source_digest" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."bootstrap_founding_steward"("target_user_id" "uuid", "supplied_operator_identifier" "text", "supplied_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bootstrap_founding_steward"("target_user_id" "uuid", "supplied_operator_identifier" "text", "supplied_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_manage_gear_object"("object_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_manage_gear_object"("object_name" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_canonical_gear_category"("value" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_canonical_gear_category"("value" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_canonical_gear_condition"("value" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_canonical_gear_condition"("value" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."supplies" TO "service_role";
GRANT SELECT ON TABLE "public"."supplies" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."can_manage_supply_attention"("item" "public"."supplies") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."can_stage_gear_object"("object_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_stage_gear_object"("object_name" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."can_view_gear_object"("object_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_view_gear_object"("object_name" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."cancel_gear_loan"("target_loan_id" "uuid", "supplied_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_gear_loan"("target_loan_id" "uuid", "supplied_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."capture_loan_handoff_contact"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."checkout_gear_loan"("target_loan_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."checkout_gear_loan"("target_loan_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."claim_transactional_notifications"("supplied_worker_id" "uuid", "batch_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_transactional_notifications"("supplied_worker_id" "uuid", "batch_limit" integer) TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."wanted_requests" TO "service_role";



REVOKE ALL ON FUNCTION "public"."close_wanted_request"("target_request_id" "uuid", "supplied_expected_version" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."close_wanted_request"("target_request_id" "uuid", "supplied_expected_version" bigint) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."commit_sanitized_gear_image"("supplied_attempt_id" "uuid", "supplied_source_digest" "text", "supplied_final_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."commit_sanitized_gear_image"("supplied_attempt_id" "uuid", "supplied_source_digest" "text", "supplied_final_path" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."complete_ai_drafting_attempt"("supplied_attempt_id" "uuid", "supplied_status" "public"."ai_draft_attempt_status", "supplied_input_tokens" integer, "supplied_cached_input_tokens" integer, "supplied_output_tokens" integer, "supplied_reasoning_output_tokens" integer, "supplied_failure_kind" "text", "supplied_provider_response_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_ai_drafting_attempt"("supplied_attempt_id" "uuid", "supplied_status" "public"."ai_draft_attempt_status", "supplied_input_tokens" integer, "supplied_cached_input_tokens" integer, "supplied_output_tokens" integer, "supplied_reasoning_output_tokens" integer, "supplied_failure_kind" "text", "supplied_provider_response_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_transactional_notification_delivery"("target_outbox_id" "uuid", "supplied_claim_token" "uuid", "supplied_outcome" "text", "supplied_provider_message_id" "text", "supplied_error_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_transactional_notification_delivery"("target_outbox_id" "uuid", "supplied_claim_token" "uuid", "supplied_outcome" "text", "supplied_provider_message_id" "text", "supplied_error_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."convert_individual_donation"("target_supply_id" "uuid", "new_custodian_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."convert_individual_donation"("target_supply_id" "uuid", "new_custodian_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_group_supply"("supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_custodian_id" "uuid", "supplied_status" "public"."listing_status", "supplied_condition" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_group_supply"("supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_custodian_id" "uuid", "supplied_status" "public"."listing_status", "supplied_condition" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_individual_supply"("supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_status" "public"."listing_status", "supplied_condition" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_individual_supply"("supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_status" "public"."listing_status", "supplied_condition" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_or_resume_group_draft"("supplied_attempt_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_custodian_id" "uuid", "supplied_condition" "text", "supplied_expected_images" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_or_resume_group_draft"("supplied_attempt_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_custodian_id" "uuid", "supplied_condition" "text", "supplied_expected_images" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_or_resume_group_draft_with_guidelines"("supplied_attempt_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_custodian_id" "uuid", "supplied_condition" "text", "supplied_expected_images" integer, "supplied_guidelines" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_or_resume_group_draft_with_guidelines"("supplied_attempt_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_custodian_id" "uuid", "supplied_condition" "text", "supplied_expected_images" integer, "supplied_guidelines" "text"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_or_resume_individual_draft"("supplied_attempt_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_condition" "text", "supplied_expected_images" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_or_resume_individual_draft"("supplied_attempt_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_condition" "text", "supplied_expected_images" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_or_resume_individual_draft_with_guidelines"("supplied_attempt_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_condition" "text", "supplied_expected_images" integer, "supplied_guidelines" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_or_resume_individual_draft_with_guidelines"("supplied_attempt_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_condition" "text", "supplied_expected_images" integer, "supplied_guidelines" "text"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_wanted_request"("supplied_title" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_start" "date", "supplied_end" "date", "supplied_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_wanted_request"("supplied_title" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_start" "date", "supplied_end" "date", "supplied_note" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."current_access_level"("target_community_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_access_level"("target_community_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."current_active_community_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_active_community_id"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."current_join_questions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_join_questions"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_join_questions"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."deactivate_member"("target_user_id" "uuid", "successor_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."deactivate_member"("target_user_id" "uuid", "successor_user_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."deactivation_impact"("target_user_id" "uuid", "successor_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."deactivation_impact"("target_user_id" "uuid", "successor_user_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."decide_membership"("target_user_id" "uuid", "approve" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decide_membership"("target_user_id" "uuid", "approve" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."decline_gear_loan"("target_loan_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decline_gear_loan"("target_loan_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."dismiss_my_notification"("target_notification_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dismiss_my_notification"("target_notification_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."emit_notification_to_active_administrators"("supplied_event_type" "text", "supplied_authoritative_record_id" "text", "supplied_transition_version" bigint, "supplied_community_id" "uuid", "supplied_payload" "jsonb", "supplied_occurred_at" timestamp with time zone) FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."emit_private_notification"("supplied_event_type" "text", "supplied_authoritative_record_id" "text", "supplied_transition_version" bigint, "supplied_community_id" "uuid", "supplied_recipient_user_id" "uuid", "supplied_payload" "jsonb", "supplied_occurred_at" timestamp with time zone) FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."emit_wanted_notification"("supplied_event" "text", "supplied_record_id" "uuid", "supplied_version" bigint, "supplied_community_id" "uuid", "supplied_participants" "uuid"[], "supplied_include_administrators" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."enforce_recoverable_draft_publication"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."enqueue_due_loan_reminders"("supplied_run_at" timestamp with time zone, "batch_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_due_loan_reminders"("supplied_run_at" timestamp with time zone, "batch_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."expire_stale_ai_draft_attempts"("supplied_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expire_stale_ai_draft_attempts"("supplied_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_ai_drafting_availability"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_ai_drafting_availability"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_my_administrator_orientation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_administrator_orientation"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_my_community_settings"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_community_settings"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_my_postal_code"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_postal_code"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_my_profile_settings"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_profile_settings"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_my_transactional_email_preferences"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_transactional_email_preferences"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."invalidate_wanted_offers_for_supply"("target_supply_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."is_active_administrator"("target_community_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_active_administrator"("target_community_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_active_custodian"("target_community_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_active_custodian"("target_community_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_active_inventory_manager"("target_community_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_active_inventory_manager"("target_community_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_active_member"("target_community_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_active_member"("target_community_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_active_steward"("target_community_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_active_steward"("target_community_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."loan_contact_details"("target_loan_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."loan_contact_details"("target_loan_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."loan_manager_authorized"("item" "public"."supplies", "operation" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."lock_community_authorization"("target_community_id" "uuid", "exclusive_lock" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."lock_listing"("target_supply_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."mark_ai_drafting_provider_started"("supplied_attempt_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_ai_drafting_provider_started"("supplied_attempt_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."max_committed_quantity"("target_supply_id" "uuid", "range_start" "date", "range_end" "date", "excluded_loan_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."moderate_wanted_request"("target_request_id" "uuid", "supplied_expected_version" bigint, "supplied_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."moderate_wanted_request"("target_request_id" "uuid", "supplied_expected_version" bigint, "supplied_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."my_loan_reminders"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_loan_reminders"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."my_membership_application"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_membership_application"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."my_private_notifications"("before_occurred_at" timestamp with time zone, "before_notification_id" "uuid", "page_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_private_notifications"("before_occurred_at" timestamp with time zone, "before_notification_id" "uuid", "page_limit" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."normalize_guideline_rules"("supplied_rules" "text"[]) FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."normalize_postal_code"("value" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."normalize_postal_code"("value" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."notify_loan_reminder_insert"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."notify_loan_transition"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."notify_membership_application_insert"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."notify_membership_status_transition"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."notify_role_audit_insert"() FROM PUBLIC;



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."wanted_offers" TO "service_role";



REVOKE ALL ON FUNCTION "public"."offer_wanted_listing"("target_request_id" "uuid", "target_supply_id" "uuid", "supplied_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."offer_wanted_listing"("target_request_id" "uuid", "target_supply_id" "uuid", "supplied_note" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."prevent_loan_audit_rewrite"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."prevent_notification_registry_rewrite"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."prevent_operational_audit_rewrite"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."prevent_supply_condition_history_rewrite"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."prevent_terminal_membership_reactivation"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."private_bulk_draft_attempt_status"("supplied_attempt_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."private_bulk_draft_attempt_status"("supplied_attempt_ids" "uuid"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."private_gear_catalog"("supplied_search" "text", "supplied_category" "text", "supplied_ownership" "text", "supplied_condition" "text", "supplied_postal" "text", "supplied_page" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."private_gear_catalog"("supplied_search" "text", "supplied_category" "text", "supplied_ownership" "text", "supplied_condition" "text", "supplied_postal" "text", "supplied_page" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."private_gear_loans"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."private_gear_loans"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."private_handoff_candidates"("target_loan_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."private_handoff_candidates"("target_loan_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."private_inventory_contacts"("target_supply_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."private_inventory_contacts"("target_supply_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."private_listing_postal_code"("target_supply_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."private_listing_postal_code"("target_supply_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."private_loan_guideline_acceptances"("supplied_loan_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."private_loan_guideline_acceptances"("supplied_loan_ids" "uuid"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."private_loan_operations"("target_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."private_loan_operations"("target_ids" "uuid"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."private_manageable_listings_for_wanted"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."private_manageable_listings_for_wanted"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."private_member_administration"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."private_member_administration"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."private_notification_delivery_diagnostics"("target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."private_notification_delivery_diagnostics"("target_user_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."private_pending_members"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."private_pending_members"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."private_supplies"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."private_supplies"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."private_supply_attention_flags"("target_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."private_supply_attention_flags"("target_ids" "uuid"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."private_supply_detail"("target_supply_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."private_supply_detail"("target_supply_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."private_supply_guidelines"("target_supply_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."private_supply_guidelines"("target_supply_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."private_supply_guidelines_batch"("target_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."private_supply_guidelines_batch"("target_ids" "uuid"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."private_wanted_offers"("target_request_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."private_wanted_offers"("target_request_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."private_wanted_requests"("supplied_view" "text", "supplied_before_created_at" timestamp with time zone, "supplied_before_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."private_wanted_requests"("supplied_view" "text", "supplied_before_created_at" timestamp with time zone, "supplied_before_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."protect_ai_attempt_change"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."protect_legacy_deactivation_manifest"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."protect_loan_reminder_policy"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."protect_milestone_six_state"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."protect_notification_operational_tables"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."protect_supply_attention_state"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."publish_join_questions"("supplied_questions" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_join_questions"("supplied_questions" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."publish_supply_draft"("target_supply_id" "uuid", "supplied_attempt_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_supply_draft"("target_supply_id" "uuid", "supplied_attempt_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reactivate_member"("target_user_id" "uuid", "supplied_preview_version" "text", "supplied_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reactivate_member"("target_user_id" "uuid", "supplied_preview_version" "text", "supplied_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reactivation_impact"("target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reactivation_impact"("target_user_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reactivation_state_version"("target_user_id" "uuid", "target_community_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."reassign_group_custodian"("target_supply_id" "uuid", "new_custodian_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reassign_group_custodian"("target_supply_id" "uuid", "new_custodian_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reassign_loan_handoff"("target_loan_id" "uuid", "target_handoff_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reassign_loan_handoff"("target_loan_id" "uuid", "target_handoff_user_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."redact_expired_membership_answers"("batch_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."redact_expired_membership_answers"("batch_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."redact_expired_notification_data"("batch_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."redact_expired_notification_data"("batch_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reject_ai_evidence_change"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."reject_m7_immutable_change"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."reopen_wanted_request"("target_request_id" "uuid", "supplied_expected_version" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reopen_wanted_request"("target_request_id" "uuid", "supplied_expected_version" bigint) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."request_gear_loan"("target_supply_id" "uuid", "requested_quantity" integer, "requested_start" "date", "requested_end" "date", "supplied_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_gear_loan"("target_supply_id" "uuid", "requested_quantity" integer, "requested_start" "date", "requested_end" "date", "supplied_note" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."request_gear_loan"("target_supply_id" "uuid", "requested_quantity" integer, "requested_start" "date", "requested_end" "date", "supplied_note" "text", "supplied_guideline_version" bigint, "supplied_guidelines_accepted" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_gear_loan"("target_supply_id" "uuid", "requested_quantity" integer, "requested_start" "date", "requested_end" "date", "supplied_note" "text", "supplied_guideline_version" bigint, "supplied_guidelines_accepted" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reserve_ai_drafting_attempt"("target_user_id" "uuid", "supplied_attempt_id" "uuid", "supplied_mode" "text", "supplied_candidate_count" integer, "supplied_image_count" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reserve_ai_drafting_attempt"("target_user_id" "uuid", "supplied_attempt_id" "uuid", "supplied_mode" "text", "supplied_candidate_count" integer, "supplied_image_count" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."restore_wanted_request"("target_request_id" "uuid", "supplied_expected_version" bigint, "supplied_target_status" "public"."wanted_request_status", "supplied_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restore_wanted_request"("target_request_id" "uuid", "supplied_expected_version" bigint, "supplied_target_status" "public"."wanted_request_status", "supplied_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."retire_supply"("target_supply_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."retire_supply"("target_supply_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."return_gear_loan"("target_loan_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."return_gear_loan"("target_loan_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."return_gear_loan"("target_loan_id" "uuid", "mark_needs_attention" boolean, "supplied_attention_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."return_gear_loan"("target_loan_id" "uuid", "mark_needs_attention" boolean, "supplied_attention_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."select_wanted_offer"("target_request_id" "uuid", "target_offer_id" "uuid", "supplied_expected_version" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."select_wanted_offer"("target_request_id" "uuid", "target_offer_id" "uuid", "supplied_expected_version" bigint) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_access_level"("target_user_id" "uuid", "target_role" "public"."app_role") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_access_level"("target_user_id" "uuid", "target_role" "public"."app_role") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_administrator_email_suppression"("target_user_id" "uuid", "supplied_suppressed" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_administrator_email_suppression"("target_user_id" "uuid", "supplied_suppressed" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_ai_drafting_enabled"("supplied_enabled" boolean, "expected_version" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_ai_drafting_enabled"("supplied_enabled" boolean, "expected_version" bigint) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_my_administrator_orientation"("supplied_registry_version" integer, "supplied_item_id" "text", "supplied_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_my_administrator_orientation"("supplied_registry_version" integer, "supplied_item_id" "text", "supplied_status" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_my_notification_read"("target_notification_id" "uuid", "supplied_read" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_my_notification_read"("target_notification_id" "uuid", "supplied_read" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_my_postal_code"("supplied_postal" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_my_postal_code"("supplied_postal" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_steward"("target_user_id" "uuid", "make_steward" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_steward"("target_user_id" "uuid", "make_steward" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_supply_contact"("target_supply_id" "uuid", "new_contact_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_supply_contact"("target_supply_id" "uuid", "new_contact_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_supply_guidelines"("target_supply_id" "uuid", "supplied_expected_version" bigint, "supplied_rules" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_supply_guidelines"("target_supply_id" "uuid", "supplied_expected_version" bigint, "supplied_rules" "text"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_supply_image_paths"("target_supply_id" "uuid", "supplied_paths" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_supply_image_paths"("target_supply_id" "uuid", "supplied_paths" "text"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_supply_needs_attention"("target_supply_id" "uuid", "supplied_value" boolean, "supplied_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_supply_needs_attention"("target_supply_id" "uuid", "supplied_value" boolean, "supplied_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."submit_join_application"("supplied_version_id" "uuid", "supplied_answers" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_join_application"("supplied_version_id" "uuid", "supplied_answers" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_community_display_name"("supplied_name" "text", "expected_version" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_community_display_name"("supplied_name" "text", "expected_version" bigint) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_my_profile_settings"("supplied_display_name" "text", "supplied_introduction" "text", "supplied_phone_e164" "text", "supplied_coordination_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_my_profile_settings"("supplied_display_name" "text", "supplied_introduction" "text", "supplied_phone_e164" "text", "supplied_coordination_note" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_my_transactional_email_preferences"("supplied_loan_activity" boolean, "supplied_loan_reminders" boolean, "supplied_wanted_activity" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_my_transactional_email_preferences"("supplied_loan_activity" boolean, "supplied_loan_reminders" boolean, "supplied_wanted_activity" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_supply"("target_supply_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_status" "public"."listing_status", "supplied_condition" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_supply"("target_supply_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_status" "public"."listing_status", "supplied_condition" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_supply_with_guidelines"("target_supply_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_status" "public"."listing_status", "supplied_condition" "text", "supplied_expected_guideline_version" bigint, "supplied_guidelines" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_supply_with_guidelines"("target_supply_id" "uuid", "supplied_title" "text", "supplied_description" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_status" "public"."listing_status", "supplied_condition" "text", "supplied_expected_guideline_version" bigint, "supplied_guidelines" "text"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_wanted_request"("target_request_id" "uuid", "supplied_expected_version" bigint, "supplied_title" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_start" "date", "supplied_end" "date", "supplied_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_wanted_request"("target_request_id" "uuid", "supplied_expected_version" bigint, "supplied_title" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_start" "date", "supplied_end" "date", "supplied_note" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."user_has_listing_descriptive_authority"("target_community_id" "uuid", "target_supply_id" "uuid", "target_user_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."valid_group_handoff"("target_community_id" "uuid", "target_user_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."valid_notification_payload"("supplied_event_type" "text", "supplied_payload" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."valid_plain_text"("value" "text", "maximum" integer, "allow_blank" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."validate_join_answer_snapshot"("value" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."validate_join_questions"("value" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."validate_m6_legacy_deactivation_manifest"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."validate_wanted_fields"("supplied_title" "text", "supplied_category" "text", "supplied_quantity" integer, "supplied_start" "date", "supplied_end" "date", "supplied_note" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."wanted_offer_listing_status_trigger"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."wanted_request_listing_seed"("target_request_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."wanted_request_listing_seed"("target_request_id" "uuid") TO "authenticated";
























GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."administrator_ai_setting_audit" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."administrator_orientation_progress" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."administrator_orientation_registry" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."ai_activation_evidence" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."ai_draft_attempts" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."ai_model_price_snapshots" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."communities" TO "service_role";
GRANT SELECT ON TABLE "public"."communities" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."community_roles" TO "service_role";
GRANT SELECT ON TABLE "public"."community_roles" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."community_setting_versions" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."community_settings" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."founding_steward_bootstrap" TO "service_role";
GRANT SELECT ON TABLE "public"."founding_steward_bootstrap" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."gear_loan_guideline_acceptances" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."join_question_versions" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."loan_handoff_audit" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."loan_reminder_events" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."loan_reminder_policies" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."member_postal_codes" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."member_profile_settings" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."membership_applications" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."membership_deactivation_consequences" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."membership_reactivation_audit" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."notification_delivery_attempts" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."notification_event_registry" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."private_notifications" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."role_audit" TO "service_role";
GRANT SELECT ON TABLE "public"."role_audit" TO "authenticated";



GRANT UPDATE ON SEQUENCE "public"."role_audit_id_seq" TO "anon";
GRANT UPDATE ON SEQUENCE "public"."role_audit_id_seq" TO "authenticated";
GRANT UPDATE ON SEQUENCE "public"."role_audit_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."ses_feedback_events" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."supply_attention_audit" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."supply_condition_history" TO "service_role";
GRANT SELECT ON TABLE "public"."supply_condition_history" TO "authenticated";



GRANT UPDATE ON SEQUENCE "public"."supply_condition_history_id_seq" TO "anon";
GRANT UPDATE ON SEQUENCE "public"."supply_condition_history_id_seq" TO "authenticated";
GRANT UPDATE ON SEQUENCE "public"."supply_condition_history_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."supply_donation_audit" TO "service_role";
GRANT SELECT ON TABLE "public"."supply_donation_audit" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."supply_guideline_versions" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."transactional_email_outbox" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."transactional_email_preference_audit" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."transactional_email_preferences" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."transactional_email_suppression_audit" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."transactional_email_suppressions" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."wanted_request_moderation_audit" TO "service_role";



GRANT UPDATE ON SEQUENCE "public"."wanted_request_moderation_audit_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLES  TO "service_role";































--
-- Dumped schema changes for auth and storage
--

CREATE OR REPLACE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();



CREATE POLICY "gear_image_staging_owner_insert" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'gear-image-staging'::"text") AND "public"."can_stage_gear_object"("name")));



CREATE POLICY "gear_images_active_member_read" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'gear-images'::"text") AND "public"."can_view_gear_object"("name")));



CREATE POLICY "gear_images_manager_delete" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'gear-images'::"text") AND "public"."can_manage_gear_object"("name")));
