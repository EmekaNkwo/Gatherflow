CREATE TABLE "webhook_inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"body" jsonb NOT NULL,
	"events" integer DEFAULT 0 NOT NULL,
	"applied" integer DEFAULT 0 NOT NULL,
	"ignored" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"opted_out" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE INDEX "webhook_inbox_received_idx" ON "webhook_inbox" USING btree ("received_at");