CREATE TYPE "public"."quarantine_decision" AS ENUM('verified', 'reported', 'keep');--> statement-breakpoint
CREATE TABLE "quarantine_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"day" date NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"decision" "quarantine_decision" NOT NULL,
	"note" text,
	"reviewer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quarantine_reviews" ADD CONSTRAINT "quarantine_reviews_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantine_reviews" ADD CONSTRAINT "quarantine_reviews_reviewer_id_builders_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."builders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quarantine_reviews_row_idx" ON "quarantine_reviews" USING btree ("device_id","day","provider","model");