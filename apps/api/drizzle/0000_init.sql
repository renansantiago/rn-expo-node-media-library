CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`category_id` text NOT NULL,
	`duration_sec` integer NOT NULL,
	`thumbnail_url` text,
	`stream_url` text NOT NULL,
	`required_tier` text DEFAULT 'free' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `items_created_at_id_idx` ON `items` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `items_category_created_at_id_idx` ON `items` (`category_id`,`created_at`,`id`);