CREATE TABLE `writing_steps` (
	`draftId` text NOT NULL,
	`field` text NOT NULL,
	`version` integer NOT NULL,
	`client` text NOT NULL,
	`step` text NOT NULL,
	CONSTRAINT `writing_steps_pk` PRIMARY KEY(`draftId`, `field`, `version`),
	CONSTRAINT `fk_writing_steps_draftId_field_writing_documents_draftId_field_fk` FOREIGN KEY (`draftId`,`field`) REFERENCES `writing_documents`(`draftId`,`field`) ON DELETE CASCADE
) STRICT;
--> statement-breakpoint
INSERT INTO writing_steps (draftId, field, version, client, step)
SELECT d.draftId, d.field, CAST(j.key AS INTEGER), json_extract(d.clients, '$[' || j.key || ']'), j.value
FROM writing_documents d, json_each(d.steps) j;
--> statement-breakpoint
ALTER TABLE `writing_documents` ADD `version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE writing_documents SET version = json_array_length(steps);
--> statement-breakpoint
ALTER TABLE `writing_documents` DROP COLUMN `steps`;--> statement-breakpoint
ALTER TABLE `writing_documents` DROP COLUMN `clients`;