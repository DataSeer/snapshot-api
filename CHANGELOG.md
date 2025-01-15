# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [2.0.0](https://github.com/DataSeer/snapshot-api/compare/v1.0.0...v2.0.0) (2025-01-15)


### Features

* add script to manually sync the version ([013d2c4](https://github.com/DataSeer/snapshot-api/commits/013d2c433d33a263eeb5ab528b6871e3d65c2f50))
* **api:** add version endpoint & version management in the app (logs) ([0908b28](https://github.com/DataSeer/snapshot-api/commits/0908b28765e6cb6bceda3ece087f2f500e4608b4))
* update all dependencies ([c3e9004](https://github.com/DataSeer/snapshot-api/commits/c3e9004429640db3c499de6d87c1136e9bce9e4e))
* update permissions for /versions API route ([1ecc20d](https://github.com/DataSeer/snapshot-api/commits/1ecc20d922da9672f26981961530cd000673d726))


### Styling

* update first comment (file path) ([1c4e867](https://github.com/DataSeer/snapshot-api/commits/1c4e86783153b9c2885869c84b5a874b82ba82df))


### Documentation

* add first version of changelog ([80bcb09](https://github.com/DataSeer/snapshot-api/commits/80bcb09aa1a043b2042c86059c2689ac9e184423))
* fix first version of changelog ([36488a8](https://github.com/DataSeer/snapshot-api/commits/36488a8e8314fff6e49abac5173844a5ffa4e4f6))
* update documentation ([0e71734](https://github.com/DataSeer/snapshot-api/commits/0e7173409087ce493ad4bf1db1985d357efa3a05))
* update documentation ([4ef89bf](https://github.com/DataSeer/snapshot-api/commits/4ef89bf917ee6472327d7354d34129becd5dc602))


### Chores

* **release:** 1.1.0 [skip ci] ([7798d4f](https://github.com/DataSeer/snapshot-api/commits/7798d4f8b07ccea2b4962a852e26ce47e41c9b21))


### Continuous Integration

* add husky hooks & commit management files ([08b4270](https://github.com/DataSeer/snapshot-api/commits/08b427001aa5e9bd5d0f2fd2c38ab15866c174a2))
* update release commit comment ([d705d5f](https://github.com/DataSeer/snapshot-api/commits/d705d5f05294b98f544013a081bf96b776cfcfb2))

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