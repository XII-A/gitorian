CREATE TABLE `provider_credential_cleanup` (
	`key` text PRIMARY KEY
) STRICT;
--> statement-breakpoint
ALTER TABLE `journal` ADD `providerUpgrade` integer DEFAULT false NOT NULL;