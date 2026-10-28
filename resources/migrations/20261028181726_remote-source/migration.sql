PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_acquisition_checkpoints` (
	`key` text PRIMARY KEY,
	`status` text NOT NULL,
	`retryAt` text,
	`provider` text NOT NULL,
	`repositoryId` text,
	`cursor` text NOT NULL,
	CONSTRAINT `fk_acquisition_checkpoints_repositoryId_repositories_id_fk` FOREIGN KEY (`repositoryId`) REFERENCES `repositories`(`id`) ON DELETE CASCADE,
	CONSTRAINT "acquisition_status" CHECK("status" IN ('idle','running','paused','error','cancelled')),
	CONSTRAINT "acquisition_cursor" CHECK(json_valid("cursor")),
	CONSTRAINT "acquisition_source" CHECK(("provider"='notion' AND "repositoryId" IS NULL) OR ("provider" IN ('git','remote') AND "repositoryId" IS NOT NULL))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_acquisition_checkpoints`(`key`, `status`, `retryAt`, `provider`, `repositoryId`, `cursor`) SELECT CASE WHEN `provider`='github' THEN 'remote:' || `repositoryId` ELSE `key` END, `status`, `retryAt`, CASE WHEN `provider`='github' THEN 'remote' ELSE `provider` END, `repositoryId`, `cursor` FROM `acquisition_checkpoints`;--> statement-breakpoint
DROP TABLE `acquisition_checkpoints`;--> statement-breakpoint
ALTER TABLE `__new_acquisition_checkpoints` RENAME TO `acquisition_checkpoints`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
UPDATE acquisition_versions SET key='remote:' || substr(key,8) WHERE key LIKE 'github:%';
