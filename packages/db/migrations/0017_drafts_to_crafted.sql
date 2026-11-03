-- Craft now ends in Crafted; there is no separate Drafted step. Cards waiting there move on.
INSERT INTO "application_event" ("application_id", "action", "from_status", "to_status", "actor_type", "note")
SELECT "id", 'keepDraft', 'drafted', 'crafted', 'system', 'Drafted step removed: drafts are Crafted now'
FROM "application" WHERE "status" = 'drafted';--> statement-breakpoint
UPDATE "application" SET "status" = 'crafted' WHERE "status" = 'drafted';
