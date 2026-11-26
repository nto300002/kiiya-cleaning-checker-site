CREATE TABLE `staff_role_changes` (
  `id` text PRIMARY KEY NOT NULL,
  `staff_id` text NOT NULL,
  `actor_id` text NOT NULL,
  `before_role` text NOT NULL,
  `after_role` text NOT NULL,
  `changed_at` text NOT NULL
);
