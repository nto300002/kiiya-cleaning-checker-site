CREATE TABLE `staff_registration_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `email` text NOT NULL,
  `display_name` text NOT NULL,
  `first_seen_at` text NOT NULL,
  `last_seen_at` text NOT NULL,
  `approval_id` text,
  `approved_by` text,
  `approved_at` text
);
