CREATE TYPE "public"."credit_reason" AS ENUM('signup', 'mint', 'buy', 'sell', 'payout', 'refund');--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"builder_id" uuid NOT NULL,
	"delta" numeric(14, 4) NOT NULL,
	"reason" "credit_reason" NOT NULL,
	"ref_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "builder_days" ALTER COLUMN "credits_minted" SET DATA TYPE numeric(14, 4);--> statement-breakpoint
ALTER TABLE "builders" ALTER COLUMN "credit_balance" SET DATA TYPE numeric(14, 4);--> statement-breakpoint
ALTER TABLE "builder_days" ADD COLUMN "mint_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_builder_id_builders_id_fk" FOREIGN KEY ("builder_id") REFERENCES "public"."builders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_ref_idx" ON "credit_ledger" USING btree ("builder_id","reason","ref_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_builder_created_idx" ON "credit_ledger" USING btree ("builder_id","created_at");