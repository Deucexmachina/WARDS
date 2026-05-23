-- Migration: Add title and notification tracking to discrepancy_reports table
-- Date: 2026-05-02
-- Description: Adds title field (required) and last_viewed_by_branch field for notification tracking

-- Add title column (required field)
ALTER TABLE discrepancy_reports ADD COLUMN title VARCHAR NOT NULL DEFAULT 'Untitled Report';

-- Add last_viewed_by_branch column for notification tracking
ALTER TABLE discrepancy_reports ADD COLUMN last_viewed_by_branch DATETIME;

-- Update existing records to have a default title based on discrepancy type
UPDATE discrepancy_reports 
SET title = discrepancy_type || ' - Report #' || id
WHERE title = 'Untitled Report';

-- Optional: Remove the default constraint after updating existing records
-- This ensures new records must provide a title
-- ALTER TABLE discrepancy_reports ALTER COLUMN title DROP DEFAULT;

-- Verify the changes
SELECT id, title, discrepancy_type, last_viewed_by_branch, created_at 
FROM discrepancy_reports 
ORDER BY created_at DESC 
LIMIT 5;
