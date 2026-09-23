begin;
select plan(4);

select is(
  (select name from public.communities where id = '7b000000-0000-4000-8000-000000000001'::uuid),
  'Community Gear Share',
  'the hosted migration creates a neutral application community'
);

select is(
  (select join_mode::text from public.communities where id = '7b000000-0000-4000-8000-000000000001'::uuid),
  'approval_required',
  'membership still requires Administrator approval'
);

select is(
  (select display_name from public.community_settings where community_id = '7b000000-0000-4000-8000-000000000001'::uuid),
  'Community Gear Share',
  'the hosted migration creates current community settings'
);

select is(
  (select ai_drafting_enabled from public.community_settings where community_id = '7b000000-0000-4000-8000-000000000001'::uuid),
  false,
  'AI drafting remains disabled until its connection check succeeds'
);

select * from finish();
rollback;
