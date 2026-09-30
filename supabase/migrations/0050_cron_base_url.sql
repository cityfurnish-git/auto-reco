-- Point the database's own scheduled jobs at the deployment that still works.
--
-- APPLIED BY HAND IN THE SUPABASE SQL EDITOR ON 30 SEP 2026 and verified by
-- reading app_cron.base_url() back. This file records what was run; it is not
-- the thing that ran.
--
-- app_cron.base_url() had said 'https://auto-reco.vercel.app' since 0018. That
-- address belongs to the ORIGINAL Hobby Vercel project. Moving the project to
-- the company team on 30 Sep created a SECOND project rather than renaming the
-- first, so the live deployment answers on auto-reco.cityfurnish.com while the
-- old project kept the old address and the old code.
--
-- The old project was then given SCHEDULED_JOBS_DISABLED=1 to stop it
-- reconciling and emailing a second time (two cron runs, 17:00 and 17:13, for
-- the same business date). That flag is deployment-wide: it makes EVERY
-- /api/cron/* route return 200 {"skipped": ...} without doing the work. Six
-- database jobs call those routes through pg_net and would all have gone quiet
-- while reporting success -- pg_net records its own dispatch as succeeded
-- whatever the response says, so nothing would have raised an alarm:
--
--   recheck-d2 .. recheck-d7   10:20-10:25 UTC   re-reconcile D-2 .. D-7
--   settle-queue               10:15 UTC         close settled variances
--   gate-expected              01:30 UTC         build the expected list
--   gate-enrich                03:30-13:30 UTC   name the customer on a scan
--   gate-day-end               19:00 UTC         close abandoned shifts
--   gate-media                 19:30 UTC         sweep captured photos
--
-- THE SECRET DOES NOT TRAVEL WITH A VERCEL TRANSFER. These jobs send the Vault
-- secret `cron_secret`; the new project needs the same value in CRON_SECRET or
-- every call 401s, again silently, for the same pg_net reason. Verified on 30
-- Sep by calling the new deployment with a wrong bearer (401) and the real one
-- (ran to completion).
--
-- The custom domain, not the project's own auto-reco-one.vercel.app address:
-- that one only 307-redirects here, and pg_net does not follow redirects.

CREATE OR REPLACE FUNCTION app_cron.base_url()
  RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT 'https://auto-reco.cityfurnish.com' $$;
