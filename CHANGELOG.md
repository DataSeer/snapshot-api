# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [2.1.0](https://github.com/DataSeer/snapshot-api/compare/v2.0.1...v2.1.0) (2025-06-23)


### Features

* add 'fake' EM endpoints ([90d5e0c](https://github.com/DataSeer/snapshot-api/commits/90d5e0c8f065736a74ded8686f03ca9e353c2adb))
* add 'Report' feature ([f85b81d](https://github.com/DataSeer/snapshot-api/commits/f85b81dc8a613aba7d8f0fba6a8c37adfff67461))
* add authentication API route to get temporary JWT (for 'Editorial Manager') ([99d8e55](https://github.com/DataSeer/snapshot-api/commits/99d8e550888b4e848b2501c0fd40e2c0f51ac738))
* add multiple GenShare versions management ([cd3d202](https://github.com/DataSeer/snapshot-api/commits/cd3d202e9a9ba4cc0dee431fe9a6a31e09938fbf))
* add skip options for 'reportCompleteNotification' process ([155bc79](https://github.com/DataSeer/snapshot-api/commits/155bc7948872c2c67bb24519b003e155915543d7))
* clean snapshot response fields name returned to the client ([003ec9e](https://github.com/DataSeer/snapshot-api/commits/003ec9e95091d76af9178048c59209d4bf22cca0))
* implement snapshot-reports service ([5e6b1b0](https://github.com/DataSeer/snapshot-api/commits/5e6b1b038e4850d811c9b6d5e3232bcc2b01550a))
* improve EM integration ([e814957](https://github.com/DataSeer/snapshot-api/commits/e814957ee804c58df2dfa10bac97572ba1b20a71))
* improve logs about GenShare versions matching (requested vs returned) ([8436c05](https://github.com/DataSeer/snapshot-api/commits/8436c054d11197b53060e495b68e4646eb2a30a5))
* manage all EM endpoints ([85c7156](https://github.com/DataSeer/snapshot-api/commits/85c715626d8015b751294b7ef479e58bce0af5be))
* remove unused key in the EM conf ([7cfe210](https://github.com/DataSeer/snapshot-api/commits/7cfe21090c6edd811ec64bed0d5b3a1868d48865))
* set a default 'scores' in the EM submissions process ([a16800e](https://github.com/DataSeer/snapshot-api/commits/a16800ecc1e622126946bd8239b461806b227846))
* upgrade S3 npm package version ([1fb820d](https://github.com/DataSeer/snapshot-api/commits/1fb820d9f1e6a21f682956f7458ffd78fcecbcd0))
* use emConfig to store scores & flag values ([fd169b7](https://github.com/DataSeer/snapshot-api/commits/fd169b719e402269efe6eef2f60ebe10d0fbaac1))


### Bug Fixes

* fix custom_questions EM integration ([19eab0f](https://github.com/DataSeer/snapshot-api/commits/19eab0f20912ae1cafd0fa7223c339e9403cc60d))
* fix manage_genshare_versions script ([46c47d1](https://github.com/DataSeer/snapshot-api/commits/46c47d100820a0c7a746495673aa47420ffe3d4c))
* fix the 'report complete' process ([c272c1e](https://github.com/DataSeer/snapshot-api/commits/c272c1e58502da67aad47d299de9249ad001ac9b))
* increase multer version used ([df76b60](https://github.com/DataSeer/snapshot-api/commits/df76b608bf5253335023d65c811c7807bca32391))
* manage multipart form data requests on EM route /reportLink ([28ff550](https://github.com/DataSeer/snapshot-api/commits/28ff5500259028c44da577c7640feb2f62c9dd3f))
* remove PDF mimetype check before genshare process ([2c08e73](https://github.com/DataSeer/snapshot-api/commits/2c08e734dcd5919c6b1de9df6c74f9434ea1e93d))
* upgrade axios vulnerability ([c5b6f6e](https://github.com/DataSeer/snapshot-api/commits/c5b6f6e65ee689ce5551ff82fa359babdfaf9cf3))


### Documentation

* update README documentation ([3a869cf](https://github.com/DataSeer/snapshot-api/commits/3a869cf5943a54ca77ede2ade2f75c0e484570c2))
* update snapshot user documentation ([7cd6a97](https://github.com/DataSeer/snapshot-api/commits/7cd6a9730a5f4135e08f3b9b89ed2dd71b75eac0))
* update snapshot user documentation ([803fe4e](https://github.com/DataSeer/snapshot-api/commits/803fe4e0cd293faa68ae89e16b0f7f9c9f02eeba))

### [2.0.1](https://github.com/DataSeer/snapshot-api/compare/v2.0.0...v2.0.1) (2025-02-13)


### Features

* add durations (ms) in HTTP logs, for grafana charts ([5cc660c](https://github.com/DataSeer/snapshot-api/commits/5cc660cd03e0da98e07c25618c3319298091e626))


### Bug Fixes

* ping API route (/ping) must return HTTP status 200 even if a service check health status failed ([db53d4d](https://github.com/DataSeer/snapshot-api/commits/db53d4dd21d4ad7a771d2d82cfdfe02f7ed1676f))


### Documentation

* update the 'user documentation' (cumulated score) ([46d7868](https://github.com/DataSeer/snapshot-api/commits/46d7868d99e059f08c769c7b1b42c2a5ea4731cb))

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