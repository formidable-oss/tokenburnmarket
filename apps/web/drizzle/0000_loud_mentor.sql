CREATE TABLE "builders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" text NOT NULL,
	"handle" text NOT NULL,
	"avatar_url" text,
	"x_handle" text,
	"country" char(2),
	"credit_balance" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "builders_github_id_unique" UNIQUE("github_id"),
	CONSTRAINT "builders_handle_unique" UNIQUE("handle")
);
