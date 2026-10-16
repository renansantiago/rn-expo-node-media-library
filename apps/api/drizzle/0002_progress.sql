CREATE TABLE `playback_progress` (
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`position_sec` real NOT NULL,
	`client_recorded_at` integer NOT NULL,
	`device_id` text NOT NULL,
	`last_event_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `playback_progress_user_recorded_idx` ON `playback_progress` (`user_id`,`client_recorded_at`);--> statement-breakpoint
CREATE TABLE `progress_events` (
	`user_id` text NOT NULL,
	`event_id` text NOT NULL,
	`item_id` text NOT NULL,
	`position_sec` real NOT NULL,
	`client_recorded_at` integer NOT NULL,
	`device_id` text NOT NULL,
	`received_at` integer NOT NULL,
	`outcome` text NOT NULL,
	PRIMARY KEY(`user_id`, `event_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `progress_events_received_at_idx` ON `progress_events` (`received_at`);