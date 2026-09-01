-- Receipt/statement attachments on transactions. Private bucket - files are
-- only ever served via short-lived signed URLs, never a public link.
-- Path convention: <entity_id>/<random>-<original filename>, which is what
-- lets the storage policy below scope access to entities the caller owns
-- without needing a join table.

insert into storage.buckets (id, name, public)
values ('transaction-attachments', 'transaction-attachments', false)
on conflict (id) do nothing;

create policy "attachments: owner can manage own entity files"
  on storage.objects for all
  using (
    bucket_id = 'transaction-attachments'
    and (storage.foldername(name))[1]::uuid in (select id from entities where owner_id = auth.uid())
  )
  with check (
    bucket_id = 'transaction-attachments'
    and (storage.foldername(name))[1]::uuid in (select id from entities where owner_id = auth.uid())
  );

alter table transactions add column attachment_path text;
