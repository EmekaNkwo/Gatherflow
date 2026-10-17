CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"church_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"team_member_id" text,
	"invited_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" text
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_church_idx" ON "invitations" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree ("email");