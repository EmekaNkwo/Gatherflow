CREATE TABLE "activity" (
	"church_id" text NOT NULL,
	"id" text NOT NULL,
	"category" text NOT NULL,
	"visibility" text NOT NULL,
	"at" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "activity_church_id_id_pk" PRIMARY KEY("church_id","id")
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"church_id" text NOT NULL,
	"id" text NOT NULL,
	"session_id" text NOT NULL,
	"person_id" text NOT NULL,
	"status" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "attendance_church_id_id_pk" PRIMARY KEY("church_id","id")
);
--> statement-breakpoint
CREATE TABLE "care_records" (
	"church_id" text NOT NULL,
	"id" text NOT NULL,
	"person_id" text NOT NULL,
	"assignee_id" text,
	"status" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "care_records_church_id_id_pk" PRIMARY KEY("church_id","id")
);
--> statement-breakpoint
CREATE TABLE "church_settings" (
	"church_id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "churches" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"schema_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communications" (
	"church_id" text NOT NULL,
	"id" text NOT NULL,
	"person_id" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"at" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "communications_church_id_id_pk" PRIMARY KEY("church_id","id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"church_id" text NOT NULL,
	"id" text NOT NULL,
	"active" boolean NOT NULL,
	"involves_minors" boolean NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "groups_church_id_id_pk" PRIMARY KEY("church_id","id")
);
--> statement-breakpoint
CREATE TABLE "households" (
	"church_id" text NOT NULL,
	"id" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "households_church_id_id_pk" PRIMARY KEY("church_id","id")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"church_id" text NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"email" text,
	"phone" text,
	"household_id" text,
	"opted_out" boolean NOT NULL,
	"permission_granted" boolean NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "people_church_id_id_pk" PRIMARY KEY("church_id","id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"church_id" text NOT NULL,
	"id" text NOT NULL,
	"date" text NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "sessions_church_id_id_pk" PRIMARY KEY("church_id","id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"church_id" text NOT NULL,
	"id" text NOT NULL,
	"person_id" text NOT NULL,
	"assignee_id" text,
	"status" text NOT NULL,
	"due_date" text NOT NULL,
	"automation_key" text,
	"data" jsonb NOT NULL,
	CONSTRAINT "tasks_church_id_id_pk" PRIMARY KEY("church_id","id")
);
--> statement-breakpoint
CREATE TABLE "team" (
	"church_id" text NOT NULL,
	"id" text NOT NULL,
	"role" text NOT NULL,
	"active" boolean NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "team_church_id_id_pk" PRIMARY KEY("church_id","id")
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"church_id" text NOT NULL,
	"id" text NOT NULL,
	"category" text NOT NULL,
	"built_in" boolean NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "templates_church_id_id_pk" PRIMARY KEY("church_id","id")
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_records" ADD CONSTRAINT "care_records_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "church_settings" ADD CONSTRAINT "church_settings_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_church_visibility_at_idx" ON "activity" USING btree ("church_id","visibility","at");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_session_person_unique" ON "attendance" USING btree ("church_id","session_id","person_id");--> statement-breakpoint
CREATE INDEX "attendance_church_person_idx" ON "attendance" USING btree ("church_id","person_id");--> statement-breakpoint
CREATE INDEX "care_church_status_idx" ON "care_records" USING btree ("church_id","status");--> statement-breakpoint
CREATE INDEX "communications_church_person_at_idx" ON "communications" USING btree ("church_id","person_id","at");--> statement-breakpoint
CREATE INDEX "people_church_kind_idx" ON "people" USING btree ("church_id","kind");--> statement-breakpoint
CREATE INDEX "people_church_email_idx" ON "people" USING btree ("church_id","email");--> statement-breakpoint
CREATE INDEX "sessions_church_date_idx" ON "sessions" USING btree ("church_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_automation_key_unique" ON "tasks" USING btree ("church_id","automation_key") WHERE automation_key is not null;--> statement-breakpoint
CREATE INDEX "tasks_church_status_due_idx" ON "tasks" USING btree ("church_id","status","due_date");--> statement-breakpoint
CREATE INDEX "tasks_church_assignee_idx" ON "tasks" USING btree ("church_id","assignee_id");