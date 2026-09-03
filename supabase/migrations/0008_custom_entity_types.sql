-- Let people name their own entity types. The original CHECK locked every
-- entity to property/farmstand/other, which breaks the moment someone runs
-- an orchard, a bakery, a workshop, or an Airbnb cabin they think of by name.
--
-- Deliberately free text rather than a lookup table: the set of types is
-- small, per-person, and only ever used as a label. A second table would
-- mean another RLS policy and a join on every entity read, to enforce
-- nothing the app actually needs enforced. The picker offers the built-in
-- three plus whatever that user has already typed, so the values stay tidy
-- in practice without the database policing them.

alter table entities drop constraint entities_entity_type_check;

alter table entities add constraint entities_entity_type_not_blank
  check (length(trim(entity_type)) > 0);
