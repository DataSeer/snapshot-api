# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [3.8.0](https://github.com/DataSeer/snapshot-api/compare/v3.7.0...v3.8.0) (2026-01-06)


### Features

* implement S3 Manager updates ([24ae4fa](https://github.com/DataSeer/snapshot-api/commits/24ae4fa7d4ece1312c9fc10716654e78e1d8efb4))

## [3.7.0](https://github.com/DataSeer/snapshot-api/compare/v3.6.1...v3.7.0) (2025-12-16)


### Features

* add genshare versions aliases ([7ac9889](https://github.com/DataSeer/snapshot-api/commits/7ac988993c3d6e5822c230a8003aa6ff8181cae6))


### Bug Fixes

* npm audit fix ([8def50e](https://github.com/DataSeer/snapshot-api/commits/8def50e01fcd46602174200f1c87898f87c66670))


### Documentation

* update user documentation (add 'das_url_details') ([0cc95c7](https://github.com/DataSeer/snapshot-api/commits/0cc95c7dd5cdef9e6180442672e2619499e6f199))

### [3.6.1](https://github.com/DataSeer/snapshot-api/compare/v3.5.1...v3.6.1) (2025-11-27)

## [3.6.0](https://github.com/DataSeer/snapshot-api/compare/v3.5.0...v3.6.0) (2025-11-25)


### Features

* add Google Sheets logs for users ([59977f6](https://github.com/DataSeer/snapshot-api/commits/59977f653fea90968c9fb7e3ecb7fa60c032de50))
* improve Google Sheets logging (manage 'article_id' on errors) ([0541c7d](https://github.com/DataSeer/snapshot-api/commits/0541c7dbe1f68a94668c983e2f5c3c2720c9e974))

## [3.5.0](https://github.com/DataSeer/snapshot-api/compare/v3.4.0...v3.5.0) (2025-11-21)


### Features

* add PDF validation in the genshare processPDF function ([bb3db98](https://github.com/DataSeer/snapshot-api/commits/bb3db987c1682b5417670408d1a92b91d639822f))
* implement ScholarOne API & Notification System ([081e92e](https://github.com/DataSeer/snapshot-api/commits/081e92e97e751640909121cb6c01cd2dedc6497e))
* implement ScholarOne API & Notification System ([e410838](https://github.com/DataSeer/snapshot-api/commits/e410838419ecbc71789d787f84c57477c4dfde25))
* implement ScholarOne API & Notification System ([c6e9353](https://github.com/DataSeer/snapshot-api/commits/c6e9353aa14189d1934bea5f0faa51dbd9ac46ee))
* manage KWG editorial policy when it is missing ([06dec14](https://github.com/DataSeer/snapshot-api/commits/06dec14ad014b8b4b9bfcf9ae5d5205ba1122443))
* update IP address management ([3540e8f](https://github.com/DataSeer/snapshot-api/commits/3540e8faecb34df87dedac37fe66fb3361f1eec7))


### Bug Fixes

* fix getSubmissionsByDateRange() fucntion ([7bb53cb](https://github.com/DataSeer/snapshot-api/commits/7bb53cbc7fb592a99bb6489070ef25bb867ae62a))
* manage case the main file is not a PDF & fix error management ([2354731](https://github.com/DataSeer/snapshot-api/commits/235473178e5dc0130674efea76d4c2fbb0d06ca4))
* replace 'user_id' by 'userId' in the 'genshareManager.appendToSummary()' data ([9b3574f](https://github.com/DataSeer/snapshot-api/commits/9b3574fa84319da0cb25076ab811de067a896eae))


### Documentation

* update README.md ([3dc7f29](https://github.com/DataSeer/snapshot-api/commits/3dc7f29f97d6d15c58a34de493d9b6af637df5c4))
* update USER_DOCUMENTATION.md ([648ca79](https://github.com/DataSeer/snapshot-api/commits/648ca794f4aec69d606b54c27ae61e6b2b1ef42b))
* update USER_DOCUMENTATION.md add data_in_reference and accepted_license fields ([a2ee5c2](https://github.com/DataSeer/snapshot-api/commits/a2ee5c2007081e7e39704d0801be7c3897a7f6a8))
* update USER_DOCUMENTATION.md change some details about data_in_reference and accepted_license ([e6d13e0](https://github.com/DataSeer/snapshot-api/commits/e6d13e05c26337160f2559b9405f2b6be80ab989))

## [3.4.0](https://github.com/DataSeer/snapshot-api/compare/v3.3.0...v3.4.0) (2025-11-04)


### Features

* update genshare options management ('graph' -> 'editorial_policy', add 'journal_name') ([f1d9b0b](https://github.com/DataSeer/snapshot-api/commits/f1d9b0b3c7e020d08c2e0527ed0c6edf1565dae9))

## [3.3.0](https://github.com/DataSeer/snapshot-api/compare/v3.2.1...v3.3.0) (2025-10-24)


### Features

* sort response depending on user configuration ([7911b3c](https://github.com/DataSeer/snapshot-api/commits/7911b3c1ba19abb5047bbf619edff9d11c60a8e7))


### Documentation

* update README.md file ([e58e985](https://github.com/DataSeer/snapshot-api/commits/e58e9857950ff51bf82ef3cc461432e387cac5a1))
* update USER_DOCUMENTATION.md file ([8f5b7a1](https://github.com/DataSeer/snapshot-api/commits/8f5b7a10c2906bab4492a2ae34bf198db9761604))
* update USER_DOCUMENTATION.md file ([6f77a4a](https://github.com/DataSeer/snapshot-api/commits/6f77a4a2ce6b5960ec529b420be59a0fdde6f52d))

## [3.2.1](https://github.com/DataSeer/snapshot-api/compare/v3.2.0...v3.2.1) (2025-10-14)

### Bug Fixes

* fix the retry system (manage 'retrying' case) ([b15b847](https://github.com/DataSeer/snapshot-api/commits/b15b8473bf67aa5eb0b86dc238e265c1d9673c06))
* fix multiple DS logs on error case ([7bb44fa](https://github.com/DataSeer/snapshot-api/commits/7bb44fa6cfd1a7c4c9e260e4a8dfe39d4f6c4a7d))
* fix the remove files management ([936570a](https://github.com/DataSeer/snapshot-api/commits/936570aa3ead9af0f3e7f882abe5125dfe48a23e))


## [3.2.0](https://github.com/DataSeer/snapshot-api/compare/v3.1.0...v3.2.0) (2025-10-09)

### Features

* manage graph policy traversal llm in genshare and EM ([57277b9](https://github.com/DataSeer/snapshot-api/commits/57277b9b42868c7707e65b3ccb664961cbe0d1fc))
* add 'graph' value management for EM ([10c204a](https://github.com/DataSeer/snapshot-api/commits/10c204a0378a6fee01ff2aff2a07a81ad46a3cdd))
* improve graph value management ([62fe0f7](https://github.com/DataSeer/snapshot-api/commits/62fe0f72b82703a9eccc28dbc42356f319766462))
* manage report kind based on journal_code when request come from EM ([fc71a73](https://github.com/DataSeer/snapshot-api/commits/fc71a7394df62f9c6ff3709c328f95b38c1e36db))
* manage custom options from snapshot-mails ([784608c](https://github.com/DataSeer/snapshot-api/commits/784608ca507e8465b2843c262c0f34e2145b7558))
* improve Snapshot Response management ([8c5b90e](https://github.com/DataSeer/snapshot-api/commits/8c5b90e38977052dac42a22fd6479ce72d5c25a9))
* update EM scores with the 'action_required' value if available ([165a213](https://github.com/DataSeer/snapshot-api/commits/165a213aa00a0146090878d15243ea4760e02db1))
* manage snapshot-mails ([2450477](https://github.com/DataSeer/snapshot-api/commits/24504773318f7ebf1aaa68f2980e3565a1f3b844))


### Bug Fixes

* fix Report Version logged in DS Logs ([11e0b98](https://github.com/DataSeer/snapshot-api/commits/11e0b98b97e235a1c9f6b059aa66fc26584dbc13))
* fix package-lock.json file ([4738514](https://github.com/DataSeer/snapshot-api/commits/4738514db031f8a72ebb16506ed845e89cdbd76c))
* remove wrong file ([5940faa](https://github.com/DataSeer/snapshot-api/commits/5940faa6e998ef7eae7e729313fb00426eb3c174))


### Documentation

* update documentation ([0a698a6](https://github.com/DataSeer/snapshot-api/commits/0a698a69df706ae64abf342b4e6cf788d2d90a5b))


## [3.1.0](https://github.com/DataSeer/snapshot-api/compare/v3.0.0...v3.1.0) (2025-06-26)


### Features

* add refresh ds logs script ([ef3ec41](https://github.com/DataSeer/snapshot-api/commits/ef3ec41a7368b1e6fc353da85b0474256e1cdc5d))
* update Docker part ([46912a4](https://github.com/DataSeer/snapshot-api/commits/46912a4eaa7023ff8d747acc4bb245430fe1a536))


## [3.0.0](https://github.com/DataSeer/snapshot-api/compare/v2.0.1...v3.0.0) (2025-06-23)


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