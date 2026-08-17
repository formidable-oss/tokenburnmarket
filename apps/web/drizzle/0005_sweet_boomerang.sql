CREATE INDEX "builder_days_day_builder_idx" ON "builder_days" USING btree ("day","builder_id");--> statement-breakpoint
CREATE INDEX "builders_country_idx" ON "builders" USING btree ("country");