CREATE TABLE "athletes" (
	"id" bigint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "strava_activity_id" bigint;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "athlete_id" bigint;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "start_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_strava_activity_id_unique" UNIQUE("strava_activity_id");