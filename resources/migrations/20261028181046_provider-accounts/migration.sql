CREATE TABLE `provider_accounts` (
	`id` text PRIMARY KEY,
	`identity` text NOT NULL UNIQUE,
	`metadata` text NOT NULL
) STRICT;
--> statement-breakpoint
CREATE TABLE `provider_preparations` (
	`id` text PRIMARY KEY,
	`metadata` text NOT NULL
) STRICT;
--> statement-breakpoint
ALTER TABLE `activities` ADD `remoteSource` text;--> statement-breakpoint
ALTER TABLE `repositories` ADD `accountId` text;--> statement-breakpoint
ALTER TABLE `repositories` ADD `accountGeneration` integer;--> statement-breakpoint
ALTER TABLE `repositories` ADD `assignment` text;