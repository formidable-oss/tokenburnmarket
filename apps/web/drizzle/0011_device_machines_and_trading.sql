ALTER TABLE "devices" ADD COLUMN "machine_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "can_trade" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Devices approved before this column existed could already place bets
-- through the MCP server. They keep that; only new Devices start without it.
UPDATE "devices" SET "can_trade" = true;
