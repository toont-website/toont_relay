CREATE USER IF NOT EXISTS 'smsgateway'@'%' IDENTIFIED BY 'smsgateway_password';
GRANT ALL PRIVILEGES ON sms_gateway.* TO 'smsgateway'@'%';
CREATE DATABASE IF NOT EXISTS toont_relay CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'toont'@'%' IDENTIFIED BY 'Toont2026!';
GRANT ALL PRIVILEGES ON toont_relay.* TO 'toont'@'%';
FLUSH PRIVILEGES;
