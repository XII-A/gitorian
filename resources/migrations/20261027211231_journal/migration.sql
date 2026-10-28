CREATE TABLE `acquisition_checkpoints` (
	`key` text PRIMARY KEY,
	`status` text NOT NULL,
	`retryAt` text,
	`provider` text NOT NULL,
	`repositoryId` text,
	`cursor` text NOT NULL,
	CONSTRAINT `fk_acquisition_checkpoints_repositoryId_repositories_id_fk` FOREIGN KEY (`repositoryId`) REFERENCES `repositories`(`id`) ON DELETE CASCADE,
	CONSTRAINT "acquisition_status" CHECK("status" IN ('idle','running','paused','error','cancelled')),
	CONSTRAINT "acquisition_cursor" CHECK(json_valid("cursor")),
	CONSTRAINT "acquisition_source" CHECK(("provider"='notion' AND "repositoryId" IS NULL) OR ("provider" IN ('git','github') AND "repositoryId" IS NOT NULL))
) STRICT;
--> statement-breakpoint
CREATE TABLE `acquisition_versions` (
	`key` text NOT NULL,
	`sourceId` text NOT NULL,
	`version` text NOT NULL,
	CONSTRAINT `acquisition_versions_pk` PRIMARY KEY(`key`, `sourceId`),
	CONSTRAINT `fk_acquisition_versions_key_acquisition_checkpoints_key_fk` FOREIGN KEY (`key`) REFERENCES `acquisition_checkpoints`(`key`) ON DELETE CASCADE
) STRICT;
--> statement-breakpoint
CREATE TABLE `activities` (
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
	CONSTRAINT "activity_kind" CHECK("kind" IN ('commit','pr','review','opened','merged')),
	CONSTRAINT "activity_disposition" CHECK("disposition" IN ('inbox','deferred','dismissed')),
	CONSTRAINT "activity_flags" CHECK("explicit" IN (0,1) AND "filesLoaded" IN (0,1) AND "journaled" IN (0,1))
) STRICT;
--> statement-breakpoint
CREATE TABLE `activity_branches` (
	`activityId` text NOT NULL,
	`name` text NOT NULL,
	`deleted` integer NOT NULL,
	CONSTRAINT `activity_branches_pk` PRIMARY KEY(`activityId`, `name`),
	CONSTRAINT `fk_activity_branches_activityId_activities_id_fk` FOREIGN KEY (`activityId`) REFERENCES `activities`(`id`) ON DELETE CASCADE
) STRICT;
--> statement-breakpoint
CREATE TABLE `activity_dates` (
	`activityId` text NOT NULL,
	`instant` integer NOT NULL,
	`kind` text NOT NULL,
	CONSTRAINT `activity_dates_pk` PRIMARY KEY(`activityId`, `kind`, `instant`),
	CONSTRAINT `fk_activity_dates_activityId_activities_id_fk` FOREIGN KEY (`activityId`) REFERENCES `activities`(`id`) ON DELETE CASCADE
) STRICT;
--> statement-breakpoint
CREATE TABLE `activity_files` (
	`activityId` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`status` text NOT NULL,
	`previousName` text,
	`additions` integer,
	`deletions` integer,
	`binary` integer NOT NULL,
	CONSTRAINT `activity_files_pk` PRIMARY KEY(`activityId`, `name`),
	CONSTRAINT `fk_activity_files_activityId_activities_id_fk` FOREIGN KEY (`activityId`) REFERENCES `activities`(`id`) ON DELETE CASCADE,
	CONSTRAINT "file_counts" CHECK(("additions" IS NULL OR "additions">=0) AND ("deletions" IS NULL OR "deletions">=0))
) STRICT;
--> statement-breakpoint
CREATE TABLE `entry_coverage` (
	`id` integer PRIMARY KEY,
	`activityId` text NOT NULL,
	`revision` text,
	`entryId` text NOT NULL,
	CONSTRAINT `fk_entry_coverage_activityId_activities_id_fk` FOREIGN KEY (`activityId`) REFERENCES `activities`(`id`),
	CONSTRAINT `fk_entry_coverage_entryId_entries_id_fk` FOREIGN KEY (`entryId`) REFERENCES `entries`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_entry_coverage_activityId_revision_activity_revisions_activityId_id_fk` FOREIGN KEY (`activityId`,`revision`) REFERENCES `activity_revisions`(`activityId`,`id`)
) STRICT;
--> statement-breakpoint
CREATE TABLE `draft_selections` (
	`draftId` text NOT NULL,
	`activityId` text NOT NULL,
	`revision` text,
	`position` integer NOT NULL,
	CONSTRAINT `draft_selections_pk` PRIMARY KEY(`draftId`, `activityId`),
	CONSTRAINT `fk_draft_selections_draftId_drafts_id_fk` FOREIGN KEY (`draftId`) REFERENCES `drafts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_draft_selections_activityId_activities_id_fk` FOREIGN KEY (`activityId`) REFERENCES `activities`(`id`),
	CONSTRAINT `fk_draft_selections_activityId_revision_activity_revisions_activityId_id_fk` FOREIGN KEY (`activityId`,`revision`) REFERENCES `activity_revisions`(`activityId`,`id`)
) STRICT;
--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY,
	`week` text NOT NULL UNIQUE,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`updatedAt` text NOT NULL,
	`publishedEntryId` text,
	`version` integer NOT NULL,
	CONSTRAINT `fk_drafts_publishedEntryId_entries_id_fk` FOREIGN KEY (`publishedEntryId`) REFERENCES `entries`(`id`),
	CONSTRAINT "draft_body" CHECK(json_valid("body")),
	CONSTRAINT "draft_version" CHECK("version">0)
) STRICT;
--> statement-breakpoint
CREATE TABLE `entries` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`date` text NOT NULL,
	`url` text NOT NULL,
	`body` text NOT NULL,
	`refreshedAt` text NOT NULL,
	`excerpt` text NOT NULL,
	`searchText` text NOT NULL,
	CONSTRAINT "entry_body" CHECK(json_valid("body"))
) STRICT;
--> statement-breakpoint
CREATE TABLE `git_history` (
	`repositoryId` text PRIMARY KEY,
	`configuration` text NOT NULL,
	`refs` text NOT NULL,
	`nextOffset` integer,
	`excludedTips` text,
	CONSTRAINT `fk_git_history_repositoryId_repositories_id_fk` FOREIGN KEY (`repositoryId`) REFERENCES `repositories`(`id`) ON DELETE CASCADE
) STRICT;
--> statement-breakpoint
CREATE TABLE `git_history_items` (
	`repositoryId` text NOT NULL,
	`activityId` text NOT NULL,
	CONSTRAINT `git_history_items_pk` PRIMARY KEY(`repositoryId`, `activityId`),
	CONSTRAINT `fk_git_history_items_repositoryId_git_history_repositoryId_fk` FOREIGN KEY (`repositoryId`) REFERENCES `git_history`(`repositoryId`) ON DELETE CASCADE,
	CONSTRAINT `fk_git_history_items_activityId_activities_id_fk` FOREIGN KEY (`activityId`) REFERENCES `activities`(`id`) ON DELETE CASCADE
) STRICT;
--> statement-breakpoint
CREATE TABLE `document_images` (
	`owner` text NOT NULL,
	`imageId` text NOT NULL,
	CONSTRAINT `document_images_pk` PRIMARY KEY(`owner`, `imageId`),
	CONSTRAINT `fk_document_images_imageId_images_id_fk` FOREIGN KEY (`imageId`) REFERENCES `images`(`id`)
) STRICT;
--> statement-breakpoint
CREATE TABLE `images` (
	`id` text PRIMARY KEY,
	`mime` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`bytes` blob NOT NULL,
	CONSTRAINT "image_dimensions" CHECK("width">0 AND "height">0)
) STRICT;
--> statement-breakpoint
CREATE TABLE `journal` (
	`id` integer PRIMARY KEY,
	`generation` text NOT NULL,
	`sequence` integer NOT NULL,
	`settings` text NOT NULL,
	`lastRefreshed` text,
	`lastRefreshAttempt` text,
	`refreshError` text,
	`repositoryImport` text,
	CONSTRAINT "journal_singleton" CHECK("id"=1),
	CONSTRAINT "settings_json" CHECK(json_valid("settings"))
) STRICT;
--> statement-breakpoint
CREATE TABLE `patches` (
	`id` text PRIMARY KEY,
	`content` text NOT NULL,
	`accessedAt` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE TABLE `publication_selections` (
	`publicationId` text NOT NULL,
	`activityId` text NOT NULL,
	`revision` text,
	`position` integer NOT NULL,
	CONSTRAINT `publication_selections_pk` PRIMARY KEY(`publicationId`, `activityId`),
	CONSTRAINT `fk_publication_selections_publicationId_publication_attempts_id_fk` FOREIGN KEY (`publicationId`) REFERENCES `publication_attempts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_publication_selections_activityId_activities_id_fk` FOREIGN KEY (`activityId`) REFERENCES `activities`(`id`),
	CONSTRAINT `fk_publication_selections_activityId_revision_activity_revisions_activityId_id_fk` FOREIGN KEY (`activityId`,`revision`) REFERENCES `activity_revisions`(`activityId`,`id`)
) STRICT;
--> statement-breakpoint
CREATE TABLE `publication_attempts` (
	`id` text PRIMARY KEY,
	`draftId` text NOT NULL,
	`status` text NOT NULL,
	`marker` text NOT NULL UNIQUE,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`destination` text NOT NULL,
	`createdAt` text NOT NULL,
	`week` text,
	`entryId` text,
	`replacedBlockIds` text,
	`updateExisting` integer,
	`error` text,
	`imageUploads` text,
	CONSTRAINT `fk_publication_attempts_draftId_drafts_id_fk` FOREIGN KEY (`draftId`) REFERENCES `drafts`(`id`),
	CONSTRAINT "publication_status" CHECK("status" IN ('pending','unknown','failed','confirmed')),
	CONSTRAINT "publication_documents" CHECK(json_valid("body") AND json_valid("destination"))
) STRICT;
--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`remote` text NOT NULL,
	`base` text NOT NULL,
	`trackingStart` text NOT NULL,
	`available` integer NOT NULL,
	`removed` integer NOT NULL,
	`branchBases` text NOT NULL,
	`remotes` text NOT NULL,
	CONSTRAINT "repository_flags" CHECK("available" IN (0,1) AND "removed" IN (0,1))
) STRICT;
--> statement-breakpoint
CREATE TABLE `repository_branches` (
	`repositoryId` text NOT NULL,
	`name` text NOT NULL,
	CONSTRAINT `repository_branches_pk` PRIMARY KEY(`repositoryId`, `name`),
	CONSTRAINT `fk_repository_branches_repositoryId_repositories_id_fk` FOREIGN KEY (`repositoryId`) REFERENCES `repositories`(`id`) ON DELETE CASCADE
) STRICT;
--> statement-breakpoint
CREATE TABLE `repository_emails` (
	`repositoryId` text NOT NULL,
	`email` text NOT NULL,
	CONSTRAINT `repository_emails_pk` PRIMARY KEY(`repositoryId`, `email`),
	CONSTRAINT `fk_repository_emails_repositoryId_repositories_id_fk` FOREIGN KEY (`repositoryId`) REFERENCES `repositories`(`id`) ON DELETE CASCADE
) STRICT;
--> statement-breakpoint
CREATE TABLE `activity_revisions` (
	`id` text PRIMARY KEY,
	`activityId` text NOT NULL,
	`base` text NOT NULL,
	`head` text NOT NULL,
	`fingerprint` text,
	`patchId` text,
	CONSTRAINT `fk_activity_revisions_activityId_activities_id_fk` FOREIGN KEY (`activityId`) REFERENCES `activities`(`id`),
	CONSTRAINT `fk_activity_revisions_patchId_patches_id_fk` FOREIGN KEY (`patchId`) REFERENCES `patches`(`id`)
) STRICT;
--> statement-breakpoint
CREATE TABLE `transport_pauses` (
	`scope` text PRIMARY KEY,
	`until` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE INDEX `activity_repository_date` ON `activities` (`repositoryId`,`occurredAt`,`id`);--> statement-breakpoint
CREATE INDEX `activity_date` ON `activities` (`occurredAt`,`id`);--> statement-breakpoint
CREATE INDEX `activity_pr` ON `activities` (`repositoryId`,`prId`);--> statement-breakpoint
CREATE INDEX `activity_inbox` ON `activities` (`disposition`,`deferUntil`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `branch_activity` ON `activity_branches` (`name`,`activityId`);--> statement-breakpoint
CREATE INDEX `event_date` ON `activity_dates` (`instant`,`activityId`);--> statement-breakpoint
CREATE INDEX `covered_revision` ON `entry_coverage` (`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `coverage_commit` ON `entry_coverage` (`activityId`,`entryId`) WHERE "entry_coverage"."revision" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `coverage_revision` ON `entry_coverage` (`activityId`,`revision`,`entryId`) WHERE "entry_coverage"."revision" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `selected_revision` ON `draft_selections` (`revision`);--> statement-breakpoint
CREATE INDEX `entry_date` ON `entries` (`date`,`id`);--> statement-breakpoint
CREATE INDEX `image_owners` ON `document_images` (`imageId`);--> statement-breakpoint
CREATE INDEX `patch_access` ON `patches` (`accessedAt`);--> statement-breakpoint
CREATE INDEX `publication_revision` ON `publication_selections` (`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_unresolved_publication` ON `publication_attempts` (`draftId`) WHERE "publication_attempts"."status" IN ('pending','unknown');--> statement-breakpoint
CREATE UNIQUE INDEX `repository_path` ON `repositories` (`path`) WHERE "repositories"."path"<>'';--> statement-breakpoint
CREATE UNIQUE INDEX `revision_owner` ON `activity_revisions` (`activityId`,`id`);--> statement-breakpoint
CREATE INDEX `revision_fingerprint` ON `activity_revisions` (`activityId`,`fingerprint`);