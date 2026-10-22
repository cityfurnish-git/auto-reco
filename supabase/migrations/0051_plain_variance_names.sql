-- 0051_plain_variance_names.sql
--
-- Rename variance_name on every stored row to the plain-language names
-- (lib/engine/variance-names.ts, rewritten 22 Oct 2026).
--
-- WHY THE DATA AND NOT JUST THE DISPLAY. lib/ui/variance-phrases.ts was built
-- in September precisely to avoid this migration: it showed a readable sentence
-- beside a cryptic stored name, on the argument that renaming the constants
-- would leave 4,000+ rows speaking an older language. On 22 Oct the owner read
-- the names, could not follow them, and asked for the history to be revised
-- too — so the names were rewritten at the source and the rows are brought
-- along. One language on the screen, in the exports and in the table.
--
-- APPLY TOGETHER WITH THE CODE DEPLOY. A re-run then emits the same new name
-- and upserts the migrated row rather than inserting a second one. If the code
-- lands first, rows written in between carry the new name already and these
-- statements simply match nothing; if this lands first, the old code's next run
-- re-creates an old-named row and the next deploy's re-check supersedes it.
--
-- variance_name is free text (no CHECK), so no constraint change. The unique
-- key is (business_date, city, direction, barcode, variance_name): every target
-- below is a string that has never been stored, so a rename cannot collide with
-- an existing row — EXCEPT where two old spellings fold onto one new name,
-- which the nine statements at the end do. Checked against all 36,647 rows on
-- 22 Oct 2026: no key carried two of the spellings being merged. The NOT EXISTS
-- guard makes that a fact rather than an assumption, so a row written between
-- the check and the apply is skipped instead of failing the whole migration.
--
-- Human resolution — status, closure_reason, approvals, assignment — is
-- untouched, exactly as 0010 left it.

begin;

-- ── the 30 names the engine produced until today ──────────────────────────

update public.variances set variance_name = 'Wrong barcode scanned in DT'
  where variance_name = 'Wrong Barcode Scanned in DT';
update public.variances set variance_name = 'Not in Odoo — the floor and DT saw it'
  where variance_name = 'Moved on Floor + DT — Not Posted in Odoo';
update public.variances set variance_name = 'Not in DT or Odoo — Guard and MS saw it'
  where variance_name = 'Gate + Ops Confirm — No DT Scan or Odoo Post';
update public.variances set variance_name = 'Only the Guard saw it'
  where variance_name = 'Gate Register Only — No Ops / DT / Odoo Record';
update public.variances set variance_name = 'Only MS has it'
  where variance_name = 'Ops Sheet Only — No Gate / DT / Odoo Record';
update public.variances set variance_name = 'Odoo receipt still open — Guard and DT saw the pickup'
  where variance_name = 'Pickup Logged (Gate + DT) — Odoo Receipt Open';
update public.variances set variance_name = 'Only DT saw it'
  where variance_name = 'DT Only — No Floor or Odoo Record';
update public.variances set variance_name = 'Same unit out and back today — confirm swap'
  where variance_name = 'Same Unit In + Out Today — Confirm Replacement';
update public.variances set variance_name = 'Delivery failed — unit never came back in'
  where variance_name = 'Failed Delivery — Return Not Logged Inward';
update public.variances set variance_name = 'MS says not delivered — DT and Odoo say done'
  where variance_name = 'Ops Sheet Says Not Delivered — Posted Done in DT/Odoo';
update public.variances set variance_name = 'Only Odoo has it, and it was typed today'
  where variance_name = 'Odoo Entry Created Today — No Gate / Ops / DT Record';
update public.variances set variance_name = 'Order transfer — needs manual mapping'
  where variance_name = 'OT CASE — Order Transfer in Odoo, Map Manually';
update public.variances set variance_name = 'Moved at an odd hour'
  where variance_name = 'ODD HOUR TRIP — Movement at a Time the Gate Rarely Sees';
update public.variances set variance_name = 'Odoo posted after the deadline'
  where variance_name = 'Odoo Entry Made Late — Past the Posting Deadline';
update public.variances set variance_name = 'Arrived over 24 hours ago, still no barcode'
  where variance_name = 'Received Without a Barcode — Not Assigned Within 24 Hours';
update public.variances set variance_name = 'No Guard scan — the other three agree'
  where variance_name = 'Sheet + DT + Odoo Confirm — Missing from Gate Register';
update public.variances set variance_name = 'No MS line — the other three agree'
  where variance_name = 'Gate + DT + Odoo Confirm — Missing from Ops Sheet';
update public.variances set variance_name = 'No Guard scan — MS and Odoo saw it'
  where variance_name = 'Ops + Odoo Confirm — Missing from Gate Register';
update public.variances set variance_name = 'Logged on the wrong day'
  where variance_name = 'Entry Dated Wrong Day — Unit Logged on Adjacent Day';
update public.variances set variance_name = 'Only Odoo has it'
  where variance_name = 'Odoo Posting Only — No Gate / Ops / DT Record';
update public.variances set variance_name = 'Odoo posted the next day'
  where variance_name = 'Odoo Entry Made Late — Posted Next Day';
update public.variances set variance_name = 'Odoo posted a few days late'
  where variance_name = 'Odoo Entry Made Late — Posted a Few Days On';
update public.variances set variance_name = 'In transit — Odoo not yet validated'
  where variance_name = 'Items In Transit — Odoo Out Not Yet Validated';
update public.variances set variance_name = 'No DT job — MS and Odoo saw it'
  where variance_name = 'Ops + Odoo Confirm — No DT Scan';
update public.variances set variance_name = 'No MS line — DT and Odoo saw it'
  where variance_name = 'DT + Odoo Confirm — Missing from Ops Sheet';
update public.variances set variance_name = 'No DT job — the other three agree'
  where variance_name = 'Gate + Ops + Odoo Confirm — DT Scan Pending';
update public.variances set variance_name = 'Not in MS or DT — Guard and Odoo saw it'
  where variance_name = 'Gate + Odoo Confirm — No Ops Sheet or DT Scan';
update public.variances set variance_name = 'Not in Odoo yet — MS and DT saw it'
  where variance_name = 'Ops + DT Confirm — Odoo Posting Pending';
update public.variances set variance_name = 'All four agree — barcode typed differently'
  where variance_name = 'All Sources Agree — Barcode Text Differs (OCR/Typo)';
update public.variances set variance_name = 'Same barcode scanned twice'
  where variance_name = 'Duplicate Scan — Same Barcode Logged Twice';

-- ── spellings no code has produced for months, folded onto their successors ──
-- Left behind by migration 0010 and the versions before it. 767 rows across
-- nine spellings; variance-phrases.ts has been translating them for the reader
-- since September, and they may as well say it themselves.
update public.variances v set variance_name = 'Only Odoo has it'
  where v.variance_name = 'Odoo-Only Entry — No Floor Record'  -- 372 rows on 22 Oct 2026
    and not exists (
      select 1 from public.variances w
      where w.business_date = v.business_date and w.city = v.city
        and w.direction = v.direction and w.barcode = v.barcode
        and w.variance_name = 'Only Odoo has it'
    );
update public.variances v set variance_name = 'Not in Odoo — the floor and DT saw it'
  where v.variance_name = 'Register/DT Logged — Not in Odoo'  -- 207 rows on 22 Oct 2026
    and not exists (
      select 1 from public.variances w
      where w.business_date = v.business_date and w.city = v.city
        and w.direction = v.direction and w.barcode = v.barcode
        and w.variance_name = 'Not in Odoo — the floor and DT saw it'
    );
update public.variances v set variance_name = 'No DT job — MS and Odoo saw it'
  where v.variance_name = 'DT Missing — Ops & Odoo Agree'  -- 66 rows on 22 Oct 2026
    and not exists (
      select 1 from public.variances w
      where w.business_date = v.business_date and w.city = v.city
        and w.direction = v.direction and w.barcode = v.barcode
        and w.variance_name = 'No DT job — MS and Odoo saw it'
    );
update public.variances v set variance_name = 'Only MS has it'
  where v.variance_name = 'Sheet-Only Dispatch — No Trail'  -- 38 rows on 22 Oct 2026
    and not exists (
      select 1 from public.variances w
      where w.business_date = v.business_date and w.city = v.city
        and w.direction = v.direction and w.barcode = v.barcode
        and w.variance_name = 'Only MS has it'
    );
update public.variances v set variance_name = 'Only DT saw it'
  where v.variance_name = 'DT-Only — Fake Scan Risk'  -- 36 rows on 22 Oct 2026
    and not exists (
      select 1 from public.variances w
      where w.business_date = v.business_date and w.city = v.city
        and w.direction = v.direction and w.barcode = v.barcode
        and w.variance_name = 'Only DT saw it'
    );
update public.variances v set variance_name = 'Same barcode scanned twice'
  where v.variance_name = 'Duplicate Scan / Multi-Source Mismatch'  -- 28 rows on 22 Oct 2026
    and not exists (
      select 1 from public.variances w
      where w.business_date = v.business_date and w.city = v.city
        and w.direction = v.direction and w.barcode = v.barcode
        and w.variance_name = 'Same barcode scanned twice'
    );
update public.variances v set variance_name = 'No MS line — DT and Odoo saw it'
  where v.variance_name = 'Ops Sheet Missing — DT & Odoo Agree'  -- 18 rows on 22 Oct 2026
    and not exists (
      select 1 from public.variances w
      where w.business_date = v.business_date and w.city = v.city
        and w.direction = v.direction and w.barcode = v.barcode
        and w.variance_name = 'No MS line — DT and Odoo saw it'
    );
update public.variances v set variance_name = 'Not in MS or DT — Guard and Odoo saw it'
  where v.variance_name = 'Physical + Odoo Agree — No Register/DT'  -- 1 rows on 22 Oct 2026
    and not exists (
      select 1 from public.variances w
      where w.business_date = v.business_date and w.city = v.city
        and w.direction = v.direction and w.barcode = v.barcode
        and w.variance_name = 'Not in MS or DT — Guard and Odoo saw it'
    );
update public.variances v set variance_name = 'All four agree — barcode typed differently'
  where v.variance_name = 'All-Source Field Mismatch'  -- 1 rows on 22 Oct 2026
    and not exists (
      select 1 from public.variances w
      where w.business_date = v.business_date and w.city = v.city
        and w.direction = v.direction and w.barcode = v.barcode
        and w.variance_name = 'All four agree — barcode typed differently'
    );

commit;

-- Left deliberately: any row still carrying an old spelling after this (one
-- written mid-rollout, or restored from a backup) is readable, because
-- lib/ui/variance-phrases.ts keeps every spelling above mapped to the same
-- sentence as its successor. The screen never shows a blank.
