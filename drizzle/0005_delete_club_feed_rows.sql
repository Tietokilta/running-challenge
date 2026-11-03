-- Rows from the earlier club-feed poller have no athlete, so "Remove my data" cannot reach
-- them, they are not counted and their retention period has passed.
DELETE FROM "activities" WHERE "athlete_id" IS NULL;
