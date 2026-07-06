-- Migration: Add decline_reason columns to receipt request tables
-- Run this if the Python migration is not available.

-- receipt_requests table
ALTER TABLE receipt_requests
  ADD COLUMN IF NOT EXISTS decline_reason TEXT NULL AFTER release_copy_filename_enc,
  ADD COLUMN IF NOT EXISTS decline_reason_hash VARCHAR(255) NULL AFTER decline_reason,
  ADD COLUMN IF NOT EXISTS decline_reason_enc TEXT NULL AFTER decline_reason_hash;

-- receipt_request_history table
ALTER TABLE receipt_request_history
  ADD COLUMN IF NOT EXISTS decline_reason TEXT NULL AFTER release_copy_filename_enc,
  ADD COLUMN IF NOT EXISTS decline_reason_hash VARCHAR(255) NULL AFTER decline_reason,
  ADD COLUMN IF NOT EXISTS decline_reason_enc TEXT NULL AFTER decline_reason_hash;
