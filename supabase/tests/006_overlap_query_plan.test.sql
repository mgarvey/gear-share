begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select has_index(
  'public',
  'gear_loans',
  'gear_loans_committed_overlap_idx',
  'committed-loan overlap index exists'
);
select matches(
  pg_get_indexdef('public.gear_loans_committed_overlap_idx'::regclass),
  'supply_id, start_date, end_date.*approved.*checked_out',
  'overlap index covers listing and inclusive dates only for capacity-consuming states'
);
select matches(
  pg_get_functiondef('public.available_quantity(uuid,date,date)'::regprocedure),
  'public[.]max_committed_quantity',
  'availability delegates to the shared indexed commitment calculation'
);
select matches(
  pg_get_functiondef('public.approve_gear_loan(uuid,uuid)'::regprocedure),
  'public[.]max_committed_quantity',
  'approval delegates to the same indexed commitment calculation'
);

create or replace function pg_temp.committed_overlap_plan()
returns text
language plpgsql
as $$
declare
  plan_row record;
  rendered text := '';
begin
  for plan_row in execute $query$
    explain (costs off)
    select quantity
    from public.gear_loans
    where supply_id = '60000000-0000-4000-8000-000000000001'
      and status in ('approved', 'checked_out')
      and start_date <= date '2027-06-30'
      and end_date >= date '2027-06-01'
  $query$
  loop
    rendered := rendered || plan_row."QUERY PLAN" || E'\n';
  end loop;
  return rendered;
end;
$$;

set local enable_seqscan = off;
select matches(
  pg_temp.committed_overlap_plan(),
  'gear_loans_committed_overlap_idx',
  'planner can use the intended partial index for the shared overlap predicate'
);

select * from finish();
rollback;
