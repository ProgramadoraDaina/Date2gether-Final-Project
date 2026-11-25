CREATE TABLE "call_summaries" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"summary" text NOT NULL,
	"model" varchar(80) NOT NULL,
	"language" varchar(2) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_summaries" ADD CONSTRAINT "call_summaries_session_id_call_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."call_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_summaries" ADD CONSTRAINT "call_summaries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;