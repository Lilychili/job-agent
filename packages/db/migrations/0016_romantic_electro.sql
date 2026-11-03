ALTER TABLE "application" ADD COLUMN "form_window_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "form_url" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "form_ats" "ats";--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "form_title" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "form_via" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "form_checked_at" timestamp with time zone;