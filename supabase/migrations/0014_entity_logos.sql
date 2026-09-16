-- A logo per business (16 Sep 2026, Cory: "add a place to upload a logo for
-- each business added and display that on each screen so there is no
-- question where someone is at").
--
-- Public bucket, unlike transaction-attachments: a logo is shown on every
-- screen of the app, and short-lived signed URLs would mean re-signing on
-- every page load for a file that is nobody's secret. Writes are still
-- owner-only, on the same <entity_id>/<file> path convention.
insert into storage.buckets (id, name, public)
values ('entity-logos', 'entity-logos', true)
on conflict (id) do nothing;

create policy "entity logos: owner can manage own entity files"
  on storage.objects for all
  using (
    bucket_id = 'entity-logos'
    and (storage.foldername(name))[1]::uuid in (select id from entities where owner_id = auth.uid())
  )
  with check (
    bucket_id = 'entity-logos'
    and (storage.foldername(name))[1]::uuid in (select id from entities where owner_id = auth.uid())
  );

alter table entities add column if not exists logo_url text;
