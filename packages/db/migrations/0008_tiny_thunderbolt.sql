CREATE TABLE "rejected_posting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"canonical_url" text NOT NULL,
	"match_score" integer NOT NULL,
	CONSTRAINT "rejected_posting_canonicalUrl_unique" UNIQUE("canonical_url")
);
