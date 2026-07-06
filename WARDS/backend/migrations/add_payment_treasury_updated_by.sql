-- Migration: Add treasury_updated_by column to payments table
-- Date: 2026-07-07
-- Description: Tracks the branch staff member who verified or declined a payment
-- Database: MySQL

ALTER TABLE payments ADD COLUMN treasury_updated_by VARCHAR(255) NULL AFTER treasury_updated_at;

-- Verify the change
SELECT id, ref_number, treasury_updated_by, treasury_updated_at
FROM payments
ORDER BY created_at DESC
LIMIT 5;
