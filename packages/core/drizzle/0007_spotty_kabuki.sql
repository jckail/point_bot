CREATE TABLE "user_setting" (
	"user_id" varchar(255) PRIMARY KEY NOT NULL,
	"display_currency" varchar(3) NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
