-- Same archive pattern as profiles (0006_profiles_archive.sql), for the
-- Your Entities screen. No new RLS policy needed here — entities already
-- grants its owner full CRUD ("entities: owner has full access", for
-- all), so writing this new column is already covered.

alter table entities add column is_archived boolean not null default false;
