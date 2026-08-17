CREATE TYPE "public"."community_visibility" AS ENUM('public', 'unlisted');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TABLE "communities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"bio" text,
	"visibility" "community_visibility" DEFAULT 'public' NOT NULL,
	"owner_id" uuid NOT NULL,
	"invite_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communities_slug_unique" UNIQUE("slug"),
	CONSTRAINT "communities_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"community_id" uuid NOT NULL,
	"builder_id" uuid NOT NULL,
	"role" "membership_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_community_id_builder_id_pk" PRIMARY KEY("community_id","builder_id")
);
--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_owner_id_builders_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."builders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_builder_id_builders_id_fk" FOREIGN KEY ("builder_id") REFERENCES "public"."builders"("id") ON DELETE cascade ON UPDATE no action;