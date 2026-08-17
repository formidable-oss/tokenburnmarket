CREATE TYPE "public"."market_scope" AS ENUM('community', 'country', 'global');--> statement-breakpoint
CREATE TYPE "public"."market_status" AS ENUM('open', 'closed', 'resolved', 'voided');--> statement-breakpoint
CREATE TYPE "public"."market_type" AS ENUM('top_burner', 'threshold', 'head_to_head', 'model_race');--> statement-breakpoint
CREATE TYPE "public"."trade_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "market_scope" NOT NULL,
	"community_id" uuid,
	"country" char(2),
	"type" "market_type" NOT NULL,
	"question" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"b" numeric(14, 4) NOT NULL,
	"opens_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"resolves_at" timestamp with time zone NOT NULL,
	"status" "market_status" DEFAULT 'open' NOT NULL,
	"winning_outcome_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"label" text NOT NULL,
	"ref" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"shares_outstanding" numeric(14, 4) DEFAULT 0 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"market_id" uuid NOT NULL,
	"outcome_id" uuid NOT NULL,
	"builder_id" uuid NOT NULL,
	"shares" numeric(14, 4) DEFAULT 0 NOT NULL,
	"cost_basis" numeric(14, 4) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positions_market_id_outcome_id_builder_id_pk" PRIMARY KEY("market_id","outcome_id","builder_id")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"outcome_id" uuid NOT NULL,
	"builder_id" uuid NOT NULL,
	"side" "trade_side" NOT NULL,
	"shares" numeric(14, 4) NOT NULL,
	"credits" numeric(14, 4) NOT NULL,
	"price_after" numeric(9, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_created_by_builders_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."builders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_outcome_id_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_builder_id_builders_id_fk" FOREIGN KEY ("builder_id") REFERENCES "public"."builders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_outcome_id_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_builder_id_builders_id_fk" FOREIGN KEY ("builder_id") REFERENCES "public"."builders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "markets_status_closes_idx" ON "markets" USING btree ("status","closes_at");--> statement-breakpoint
CREATE INDEX "markets_community_idx" ON "markets" USING btree ("community_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "outcomes_market_sort_idx" ON "outcomes" USING btree ("market_id","sort");--> statement-breakpoint
CREATE INDEX "positions_builder_idx" ON "positions" USING btree ("builder_id");--> statement-breakpoint
CREATE INDEX "trades_market_created_idx" ON "trades" USING btree ("market_id","created_at");