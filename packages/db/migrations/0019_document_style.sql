ALTER TABLE "document" ADD COLUMN "style" text DEFAULT 'color' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "document_style" text DEFAULT 'color' NOT NULL;