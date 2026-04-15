ALTER TABLE "activities" ADD COLUMN "sport_type" text;
UPDATE "activities" SET "sport_type" = "raw_data"->>'sport_type' WHERE "raw_data" IS NOT NULL;