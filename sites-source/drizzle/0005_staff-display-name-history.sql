CREATE TABLE `staff_name_changes` (
  `id` text PRIMARY KEY NOT NULL,
  `staff_id` text NOT NULL,
  `actor_id` text NOT NULL,
  `before_name` text NOT NULL,
  `after_name` text NOT NULL,
  `changed_at` text NOT NULL
);
