# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-01-09

### Features
- PDF document processing integration with GenShare API
- JWT-based authentication system for all routes
- Role-based access control with allow/block lists per route
- User-specific rate limiting with configurable thresholds
- AWS S3 integration for complete request traceability
- Google Sheets integration for summary logging
- Health monitoring for all dependent services (GenShare, GROBID, DataStet)
- Comprehensive logging system with Winston and Morgan
- Script-based user and permissions management

### Security
- JWT authentication required for all routes
- Route-specific access control through permissions system
- Secure token storage and management
- User-specific rate limiting to prevent abuse
- Complete request traceability in S3 storage

### Added
- Command-line tools for user management
- Command-line tools for permission management
- Log analysis utilities
- Health check endpoints for all services
- Automated S3 storage for all processing requests
- Google Sheets integration for process tracking
- Docker support with multi-stage builds
- CI/CD workflows for development and production

### Documentation
- Complete API documentation
- Installation and configuration guides
- Deployment instructions
- Security considerations
- Contributing guidelines
- Script usage examples

[1.0.0]: https://github.com/DataSeer/snapshot-api/releases/tag/v1.0.0