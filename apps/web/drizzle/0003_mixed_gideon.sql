CREATE TYPE "public"."trust_level" AS ENUM('verified', 'reported', 'quarantined');--> statement-breakpoint
CREATE TABLE "builder_days" (
	"builder_id" uuid NOT NULL,
	"day" date NOT NULL,
	"cost_usd" numeric(14, 6) DEFAULT 0 NOT NULL,
	"total_tokens" bigint DEFAULT 0 NOT NULL,
	"trust_level_min" "trust_level" NOT NULL,
	"credits_minted" integer DEFAULT 0 NOT NULL,
	"mint_version" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "builder_days_builder_id_day_pk" PRIMARY KEY("builder_id","day")
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"device_id" uuid NOT NULL,
	"builder_id" uuid NOT NULL,
	"day" date NOT NULL,
	"hash" "bytea" NOT NULL,
	CONSTRAINT "receipts_device_id_hash_pk" PRIMARY KEY("device_id","hash")
);
--> statement-breakpoint
CREATE TABLE "usage_days" (
	"device_id" uuid NOT NULL,
	"builder_id" uuid NOT NULL,
	"day" date NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"cached_input_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_write_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"reasoning_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_usd" numeric(14, 6) DEFAULT 0 NOT NULL,
	"trust_level" "trust_level" NOT NULL,
	"quarantine_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"receipt_count" integer DEFAULT 0 NOT NULL,
	"duplicate_of_device_id" uuid,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_days_device_id_day_provider_model_pk" PRIMARY KEY("device_id","day","provider","model")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "last_synced_day" date;--> statement-breakpoint
ALTER TABLE "builder_days" ADD CONSTRAINT "builder_days_builder_id_builders_id_fk" FOREIGN KEY ("builder_id") REFERENCES "public"."builders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_builder_id_builders_id_fk" FOREIGN KEY ("builder_id") REFERENCES "public"."builders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_days" ADD CONSTRAINT "usage_days_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_days" ADD CONSTRAINT "usage_days_builder_id_builders_id_fk" FOREIGN KEY ("builder_id") REFERENCES "public"."builders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_days" ADD CONSTRAINT "usage_days_duplicate_of_device_id_devices_id_fk" FOREIGN KEY ("duplicate_of_device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipts_builder_hash_idx" ON "receipts" USING btree ("builder_id","hash");--> statement-breakpoint
CREATE INDEX "receipts_builder_day_idx" ON "receipts" USING btree ("builder_id","day");--> statement-breakpoint
CREATE INDEX "usage_days_builder_day_idx" ON "usage_days" USING btree ("builder_id","day");