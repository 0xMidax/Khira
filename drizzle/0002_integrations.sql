CREATE TABLE "workspace_integration" (
	"kind" text PRIMARY KEY NOT NULL,
	"secrets" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connected_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_integration" ADD CONSTRAINT "workspace_integration_connected_by_user_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;