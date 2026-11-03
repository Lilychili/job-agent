-- Craft now ends in Crafted; there is no separate Drafted step. Cards waiting there move on.
-- A fresh database runs every migration in one transaction, and Postgres won't use an enum value in
-- the transaction that added it. So the status is compared as text, and the statements that write
-- enum values run only when there are drafted cards, which a fresh database never has.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "application" WHERE "status"::text = 'drafted') THEN
    EXECUTE $sql$
      INSERT INTO "application_event" ("application_id", "action", "from_status", "to_status", "actor_type", "note")
      SELECT "id", 'keepDraft', 'drafted', 'crafted', 'system', 'Drafted step removed: drafts are Crafted now'
      FROM "application" WHERE "status"::text = 'drafted'
    $sql$;
    EXECUTE $sql$ UPDATE "application" SET "status" = 'crafted' WHERE "status"::text = 'drafted' $sql$;
  END IF;
END
$$;
