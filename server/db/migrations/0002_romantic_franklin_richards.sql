CREATE TABLE "email_suppression" (
	"church_id" text NOT NULL,
	"email" text NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"event_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_suppression_church_id_email_pk" PRIMARY KEY("church_id","email")
);
--> statement-breakpoint
CREATE TABLE "message_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"church_id" text NOT NULL,
	"communication_id" text NOT NULL,
	"person_id" text NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"html_part" text NOT NULL,
	"text_part" text NOT NULL,
	"custom_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"mailjet_message_id" text,
	"mailjet_message_uuid" text,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_outbox_custom_id_unique" UNIQUE("custom_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event" text NOT NULL,
	"outbox_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_suppression" ADD CONSTRAINT "email_suppression_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suppression_email_idx" ON "email_suppression" USING btree ("email");--> statement-breakpoint
CREATE INDEX "outbox_due_idx" ON "message_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "outbox_church_idx" ON "message_outbox" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "outbox_communication_idx" ON "message_outbox" USING btree ("communication_id");--> statement-breakpoint
CREATE INDEX "webhook_events_outbox_idx" ON "webhook_events" USING btree ("outbox_id");