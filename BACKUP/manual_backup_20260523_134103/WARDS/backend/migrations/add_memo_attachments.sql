-- Migration: Add attachment support to memos table
-- Date: 2024-04-27
-- Database: MySQL

-- Add attachment_path and attachment_filename columns to memos table
ALTER TABLE memos 
ADD COLUMN attachment_path VARCHAR(255) NULL,
ADD COLUMN attachment_filename VARCHAR(255) NULL;
