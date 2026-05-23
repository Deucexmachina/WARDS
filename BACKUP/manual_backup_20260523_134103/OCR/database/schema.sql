-- WARDS Queue Management System Database Schema
-- MySQL Database

-- Create database
CREATE DATABASE IF NOT EXISTS wards_queue_system;
USE wards_queue_system;

-- Users table for admin authentication
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role ENUM('admin', 'staff') DEFAULT 'staff',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP NULL,
    INDEX idx_username (username),
    INDEX idx_role (role)
);

-- Services table
CREATE TABLE IF NOT EXISTS services (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    counter INT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_counter (counter),
    INDEX idx_active (is_active)
);

-- Queue entries table
CREATE TABLE IF NOT EXISTS queue_entries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    queue_number VARCHAR(20) UNIQUE NOT NULL,
    service_id INT NOT NULL,
    client_name VARCHAR(100) NOT NULL,
    priority_tag ENUM('PWD', 'Senior', 'Pregnant') NULL,
    status ENUM('waiting', 'serving', 'completed', 'no_show', 'skipped') DEFAULT 'waiting',
    position INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    called_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    served_by INT NULL,
    notes TEXT NULL,
    FOREIGN KEY (service_id) REFERENCES services(id),
    FOREIGN KEY (served_by) REFERENCES users(id),
    INDEX idx_queue_number (queue_number),
    INDEX idx_service_status (service_id, status),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
);

-- Announcements table
CREATE TABLE IF NOT EXISTS announcements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    priority ENUM('low', 'medium', 'high') DEFAULT 'medium',
    is_active BOOLEAN DEFAULT TRUE,
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id),
    INDEX idx_active (is_active),
    INDEX idx_priority (priority)
);

-- Activity log for audit trail
CREATE TABLE IF NOT EXISTS activity_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50),
    entity_id INT,
    description TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_user_action (user_id, action),
    INDEX idx_created_at (created_at)
);

-- Insert default admin user (password: admin123)
-- Password hash for 'admin123' using bcrypt
INSERT INTO users (username, password_hash, full_name, role) VALUES
('admin', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYqVr/9Oi5S', 'System Administrator', 'admin');

-- Insert default services
INSERT INTO services (name, counter, description) VALUES
('Real Property Tax', 1, 'Payment of real property taxes'),
('Business Tax', 2, 'Payment of business taxes'),
('Miscellaneous Tax', 3, 'Other miscellaneous payments');

-- Insert sample announcements
INSERT INTO announcements (title, content, priority, created_by) VALUES
('Office Hours', 'Monday to Friday, 8:00 AM - 5:00 PM', 'high', 1),
('Payment Methods', 'We accept cash and online payments', 'medium', 1);

-- =================================================
-- Receipts table (OCR + Manual Records)
-- =================================================
CREATE TABLE IF NOT EXISTS receipts (
    id INT AUTO_INCREMENT PRIMARY KEY,

    category ENUM('RPT', 'BUSINESS', 'MISC') NOT NULL,

    taxpayer_name VARCHAR(150) NOT NULL,

    transaction_date VARCHAR(50) NULL,

    tax_declaration_no VARCHAR(100) NULL,
    nature_of_collection VARCHAR(150) NULL,

    amount_paid DECIMAL(10,2) NOT NULL,

    image_path VARCHAR(255) NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_receipt_category (category),
    INDEX idx_receipt_taxpayer (taxpayer_name),
    INDEX idx_receipt_created (created_at)
);

-- =================================================
-- Taxpayer signup tables (email verification + OTP)
-- =================================================
CREATE TABLE IF NOT EXISTS taxpayers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email_verified BOOLEAN DEFAULT TRUE,
    email_verified_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_taxpayer_email (email)
);

CREATE TABLE IF NOT EXISTS taxpayer_otps (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    otp_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_taxpayer_otp_email (email),
    INDEX idx_taxpayer_otp_expiry (expires_at),
    INDEX idx_taxpayer_otp_created (created_at)
);

