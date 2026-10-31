CREATE TYPE "public"."actor_type" AS ENUM('owner', 'system', 'agent');--> statement-breakpoint
CREATE TYPE "public"."agent_role" AS ENUM('extractor', 'scout', 'pen', 'shipper');--> statement-breakpoint
CREATE TYPE "public"."answer_kind" AS ENUM('text', 'choice', 'number', 'date', 'consent');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('found', 'shortlisted', 'crafting', 'crafted', 'approved', 'applying', 'awaiting_submit', 'applied', 'replied', 'interview', 'rejected', 'withdrawn', 'archived');--> statement-breakpoint
CREATE TYPE "public"."ats" AS ENUM('greenhouse', 'lever', 'ashby');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('cv', 'cover_letter');--> statement-breakpoint
CREATE TYPE "public"."evidence_type" AS ENUM('prefill_screenshot', 'submission', 'confirmation_text', 'email');--> statement-breakpoint
CREATE TYPE "public"."job_remote" AS ENUM('onsite', 'hybrid', 'remote', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."remote_preference" AS ENUM('onsite', 'hybrid', 'remote', 'any');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'paused', 'succeeded', 'failed', 'superseded');--> statement-breakpoint
CREATE TABLE "agent_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" "agent_role" NOT NULL,
	"job_name" text NOT NULL,
	"application_id" uuid,
	"parent_run_id" uuid,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"prompt_version" text,
	"model" text,
	"input" jsonb,
	"output" jsonb,
	"checkpoint" jsonb,
	"logs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "answer_bank" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"question_key" text NOT NULL,
	"question_variants" text[] DEFAULT '{}'::text[] NOT NULL,
	"answer" text NOT NULL,
	"kind" "answer_kind" DEFAULT 'text' NOT NULL,
	"reusable" boolean DEFAULT true NOT NULL,
	"application_id" uuid,
	"source_blocker_id" uuid,
	CONSTRAINT "answer_bank_questionKey_unique" UNIQUE("question_key")
);
--> statement-breakpoint
CREATE TABLE "application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_id" uuid NOT NULL,
	"status" "application_status" DEFAULT 'found' NOT NULL,
	"approved_cv_doc_id" uuid,
	"approved_letter_doc_id" uuid,
	"has_open_blocker" boolean DEFAULT false NOT NULL,
	"last_error" text,
	CONSTRAINT "application_jobId_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "application_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_status" "application_status",
	"to_status" "application_status" NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"agent_run_id" uuid,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocker" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"application_id" uuid NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"question" text NOT NULL,
	"question_key" text NOT NULL,
	"field_context" jsonb NOT NULL,
	"answer" text,
	"answered_at" timestamp with time zone,
	"saved_to_answer_bank" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"application_id" uuid NOT NULL,
	"kind" "document_kind" NOT NULL,
	"version" integer NOT NULL,
	"html_source" text NOT NULL,
	"pdf_path" text NOT NULL,
	"sha256" text NOT NULL,
	"fact_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"profile_version" integer NOT NULL,
	"agent_run_id" uuid,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"application_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"type" "evidence_type" NOT NULL,
	"file_path" text,
	"text" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ats" "ats" NOT NULL,
	"source_url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"company" text NOT NULL,
	"company_norm" text NOT NULL,
	"title" text NOT NULL,
	"title_norm" text NOT NULL,
	"location" text,
	"remote" "job_remote" DEFAULT 'unknown' NOT NULL,
	"salary" text DEFAULT 'not stated' NOT NULL,
	"raw_posting" text DEFAULT '' NOT NULL,
	"match_score" integer,
	"match_reasons" jsonb,
	"archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locations" text[] DEFAULT '{}'::text[] NOT NULL,
	"remote" "remote_preference" DEFAULT 'any' NOT NULL,
	"salary_floor" integer,
	"salary_currency" text,
	"stack_must_have" text[] DEFAULT '{}'::text[] NOT NULL,
	"stack_nice_to_have" text[] DEFAULT '{}'::text[] NOT NULL,
	"exclusions" jsonb DEFAULT '{"companies":[],"keywords":[],"seniority":[]}'::jsonb NOT NULL,
	"company_boards" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_file_path" text,
	"confirmed" boolean DEFAULT false NOT NULL,
	"contact" jsonb NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"encrypted_api_key" text,
	"api_key_last4" text,
	"default_model" text,
	"worker_last_seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_event" ADD CONSTRAINT "application_event_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocker" ADD CONSTRAINT "blocker_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_one_active_per_application_uq" ON "agent_run" USING btree ("application_id") WHERE status in ('queued', 'running', 'paused') and application_id is not null;--> statement-breakpoint
CREATE INDEX "agent_run_application_idx" ON "agent_run" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "application_status_idx" ON "application" USING btree ("status");--> statement-breakpoint
CREATE INDEX "application_event_application_idx" ON "application_event" USING btree ("application_id","at");--> statement-breakpoint
CREATE INDEX "blocker_open_idx" ON "blocker" USING btree ("application_id") WHERE answered_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "document_app_kind_version_uq" ON "document" USING btree ("application_id","kind","version");--> statement-breakpoint
CREATE INDEX "evidence_application_type_idx" ON "evidence" USING btree ("application_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "job_canonical_url_uq" ON "job" USING btree ("canonical_url");--> statement-breakpoint
CREATE UNIQUE INDEX "job_company_title_live_uq" ON "job" USING btree ("company_norm","title_norm") WHERE archived = false;