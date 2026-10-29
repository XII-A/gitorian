PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_activities` (
	`id` text PRIMARY KEY,
	`repositoryId` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`occurredAt` integer NOT NULL,
	`author` text NOT NULL,
	`sha` text,
	`prId` text,
	`url` text,
	`description` text NOT NULL,
	`revision` text,
	`diffRevision` text,
	`patchId` text,
	`base` text,
	`head` text,
	`fingerprint` text,
	`integrationSha` text,
	`sourceVersion` text,
	`localQualified` integer DEFAULT false NOT NULL,
	`remoteIdentity` text,
	`remoteSource` text,
	`filesLoaded` integer NOT NULL,
	`disposition` text NOT NULL,
	`deferUntil` text,
	`reason` text,
	`explicit` integer NOT NULL,
	`journaled` integer NOT NULL,
	`prStatus` text,
	`openedAt` integer,
	`closedAt` integer,
	`mergedAt` integer,
	CONSTRAINT `fk_activities_repositoryId_repositories_id_fk` FOREIGN KEY (`repositoryId`) REFERENCES `repositories`(`id`),
	CONSTRAINT `fk_activities_patchId_patches_id_fk` FOREIGN KEY (`patchId`) REFERENCES `patches`(`id`),
	CONSTRAINT `activity_current_revision` FOREIGN KEY (`id`,`revision`) REFERENCES `activity_revisions`(`activityId`,`id`) DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT `activity_cached_revision` FOREIGN KEY (`id`,`diffRevision`) REFERENCES `activity_revisions`(`activityId`,`id`) DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "activity_kind" CHECK("kind" IN ('commit','change-request','review','opened','merged')),
	CONSTRAINT "activity_disposition" CHECK("disposition" IN ('inbox','deferred','dismissed')),
	CONSTRAINT "activity_flags" CHECK("explicit" IN (0,1) AND "filesLoaded" IN (0,1) AND "journaled" IN (0,1))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_activities`(`id`, `repositoryId`, `kind`, `title`, `occurredAt`, `author`, `sha`, `prId`, `url`, `description`, `revision`, `diffRevision`, `patchId`, `base`, `head`, `fingerprint`, `integrationSha`, `sourceVersion`, `localQualified`, `remoteIdentity`, `remoteSource`, `filesLoaded`, `disposition`, `deferUntil`, `reason`, `explicit`, `journaled`, `prStatus`, `openedAt`, `closedAt`, `mergedAt`) SELECT `id`, `repositoryId`, CASE WHEN `kind`='pr' THEN 'change-request' ELSE `kind` END, `title`, `occurredAt`, `author`, `sha`, `prId`, `url`, `description`, `revision`, `diffRevision`, `patchId`, `base`, `head`, `fingerprint`, `integrationSha`, `sourceVersion`, `localQualified`, `remoteIdentity`, `remoteSource`, `filesLoaded`, `disposition`, `deferUntil`, `reason`, `explicit`, `journaled`, `prStatus`, `openedAt`, `closedAt`, `mergedAt` FROM `activities`;--> statement-breakpoint
DROP TABLE `activities`;--> statement-breakpoint
ALTER TABLE `__new_activities` RENAME TO `activities`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `activity_repository_date` ON `activities` (`repositoryId`,`occurredAt`,`id`);--> statement-breakpoint
CREATE INDEX `activity_date` ON `activities` (`occurredAt`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `activity_remote_identity` ON `activities` (`repositoryId`,`remoteIdentity`);--> statement-breakpoint
CREATE INDEX `activity_pr` ON `activities` (`repositoryId`,`prId`);--> statement-breakpoint
CREATE INDEX `activity_inbox` ON `activities` (`disposition`,`deferUntil`,`occurredAt`);