-- Add the ITAD contextual link kind to the database constraint used by
-- games_links.kind. Directus field choices do not update this PostgreSQL check.
BEGIN;

ALTER TABLE games_links
  DROP CONSTRAINT IF EXISTS games_links_kind_canonical_check;

ALTER TABLE games_links
  ADD CONSTRAINT games_links_kind_canonical_check
  CHECK (kind IN ('download', 'walkthrough', 'gamestorylog', 'text-note', 'other', 'itad'));

COMMIT;
