CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"church_id" text NOT NULL,
	"user_id" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_id" text,
	"outcome" text NOT NULL,
	"code" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_church_at_idx" ON "audit_log" USING btree ("church_id","at");