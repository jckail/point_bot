CREATE TABLE "user_provider_valuation" (
	"user_id" varchar(255) NOT NULL,
	"provider_id" varchar(64) NOT NULL,
	"cents_per_point_milli" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_provider_valuation_user_id_provider_id_pk" PRIMARY KEY("user_id","provider_id")
);
