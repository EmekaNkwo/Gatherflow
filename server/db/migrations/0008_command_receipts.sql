CREATE TABLE "command_receipts" (
	"church_id" text NOT NULL,
	"request_id" text NOT NULL,
	"user_id" text NOT NULL,
	"command" text NOT NULL,
	"status" text NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "command_receipts_church_id_request_id_pk" PRIMARY KEY("church_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "command_receipts" ADD CONSTRAINT "command_receipts_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "command_receipts_created_idx" ON "command_receipts" USING btree ("created_at");