CREATE TABLE `writing_documents` (
	`draftId` text NOT NULL,
	`field` text NOT NULL,
	`document` text NOT NULL,
	`steps` text NOT NULL,
	`clients` text NOT NULL,
	CONSTRAINT `writing_documents_pk` PRIMARY KEY(`draftId`, `field`),
	CONSTRAINT `fk_writing_documents_draftId_drafts_id_fk` FOREIGN KEY (`draftId`) REFERENCES `drafts`(`id`) ON DELETE CASCADE
) STRICT;
