ALTER TABLE `activities` ADD `localQualified` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `activities` ADD `remoteIdentity` text;--> statement-breakpoint
CREATE UNIQUE INDEX `activity_remote_identity` ON `activities` (`repositoryId`,`remoteIdentity`);