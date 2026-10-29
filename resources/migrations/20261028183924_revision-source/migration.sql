ALTER TABLE `activities` ADD `revisionSource` text;
--> statement-breakpoint
UPDATE activities SET revisionSource=json_object('base',json_extract(sourceVersion,'$[1]'),'head',json_extract(sourceVersion,'$[2]'),'mergedAt',json_extract(sourceVersion,'$[3]'),'integrationSha',json_extract(sourceVersion,'$[4]')) WHERE CASE WHEN json_valid(sourceVersion) THEN json_type(sourceVersion)='array' ELSE 0 END;
--> statement-breakpoint
CREATE TEMP TABLE provider_migration_integrity (violations INTEGER CHECK(violations=0));
--> statement-breakpoint
INSERT INTO provider_migration_integrity SELECT COUNT(*) FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE provider_migration_integrity;
