ALTER TABLE "communities" ADD COLUMN "markets_members_can_create" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "auto_key" text;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_auto_key_unique" UNIQUE("auto_key");