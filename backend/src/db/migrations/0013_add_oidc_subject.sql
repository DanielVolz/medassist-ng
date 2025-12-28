-- Add OIDC subject column for SSO user identification
ALTER TABLE users ADD COLUMN oidc_subject TEXT;
