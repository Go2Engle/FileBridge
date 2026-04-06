# Changelog

## [0.8.4](https://github.com/Go2Engle/FileBridge/compare/v0.8.3...v0.8.4) (2026-04-06)


### Bug Fixes

* handle STATUS_ACCESS_DENIED and STATUS_SHARING_VIOLATION during file move operations ([#31](https://github.com/Go2Engle/FileBridge/issues/31)) ([a46e5f4](https://github.com/Go2Engle/FileBridge/commit/a46e5f4275037dfa86f11388384f23ca89ebc3da))

## [0.8.3](https://github.com/Go2Engle/FileBridge/compare/v0.8.2...v0.8.3) (2026-03-23)


### Performance Improvements

* improve transfer engine speed for large multi-file jobs ([#28](https://github.com/Go2Engle/FileBridge/issues/28)) ([93f3517](https://github.com/Go2Engle/FileBridge/commit/93f3517ad29debb3b985cb4e2fd1f7ba50000a58))

## [0.8.2](https://github.com/Go2Engle/FileBridge/compare/v0.8.1...v0.8.2) (2026-03-23)


### Bug Fixes

* enhance post-transfer handling and verification for source files ([#26](https://github.com/Go2Engle/FileBridge/issues/26)) ([cecf87e](https://github.com/Go2Engle/FileBridge/commit/cecf87e84cd5d4cd09475eca719677351e2211ef))

## [0.8.1](https://github.com/Go2Engle/FileBridge/compare/v0.8.0...v0.8.1) (2026-03-17)


### Bug Fixes

* post transfer delete ([#24](https://github.com/Go2Engle/FileBridge/issues/24)) ([950f301](https://github.com/Go2Engle/FileBridge/commit/950f3013a7cbe4c6e2e611fb387e4648734b2ab9))

## [0.8.0](https://github.com/Go2Engle/FileBridge/compare/v0.7.3...v0.8.0) (2026-03-10)


### Features

* **sftp:** tune chunk size, concurrency, and SSH window for large-file throughput ([#22](https://github.com/Go2Engle/FileBridge/issues/22)) ([eb80c27](https://github.com/Go2Engle/FileBridge/commit/eb80c279aed7d75fda8dc0bc1a61c4e589115492))

## [0.7.3](https://github.com/Go2Engle/FileBridge/compare/v0.7.2...v0.7.3) (2026-03-09)


### Features

* archive entry filter ([#19](https://github.com/Go2Engle/FileBridge/issues/19)) ([95a18ee](https://github.com/Go2Engle/FileBridge/commit/95a18ee22e6298ebb23ee1bd262451430443cf0e))


### Bug Fixes

* improve folder group table alignment and structure ([#20](https://github.com/Go2Engle/FileBridge/issues/20)) ([9eac654](https://github.com/Go2Engle/FileBridge/commit/9eac654f782c6e6cab9756065e52b3b68ea4ed51))

## [0.7.2](https://github.com/Go2Engle/FileBridge/compare/v0.7.1...v0.7.2) (2026-03-09)


### Bug Fixes

* enhance NTLM authentication by including domain in Type 3 message ([#17](https://github.com/Go2Engle/FileBridge/issues/17)) ([284a876](https://github.com/Go2Engle/FileBridge/commit/284a8768efc60125d85139a1277f98dd3125f295))

## [0.7.1](https://github.com/Go2Engle/FileBridge/compare/v0.7.0...v0.7.1) (2026-03-03)


### Bug Fixes

* use PAT for release-please to allow downstream workflow triggers ([3f0bb9a](https://github.com/Go2Engle/FileBridge/commit/3f0bb9ab23a399c52e3cf17d278a083cc8248432))

## [0.7.0](https://github.com/Go2Engle/FileBridge/compare/v0.6.3...v0.7.0) (2026-03-03)


### Features

* add PGP key management and encryption features ([df7041d](https://github.com/Go2Engle/FileBridge/commit/df7041df403f1c16ec7f0b48a0bcdbb91a2943b1))
* add PGP key management and encryption support ([54142a1](https://github.com/Go2Engle/FileBridge/commit/54142a143eca2661d3b5995d47073ac2d5ba32b1))
* add release automation configuration and contributing guidelines ([f4fb384](https://github.com/Go2Engle/FileBridge/commit/f4fb384c37b68e06914a193fffe957e5f854b033))
* add release automation configuration and contributing guidelines ([c0836a2](https://github.com/Go2Engle/FileBridge/commit/c0836a2d91ce2498142edeb2fe0db8f670448481))
* implement PGP key rotation functionality and UI integration ([7ee25c1](https://github.com/Go2Engle/FileBridge/commit/7ee25c1efd66511ff030d791d086651e14ebb466))


### Bug Fixes

* add packages key to release-please config ([f137ad6](https://github.com/Go2Engle/FileBridge/commit/f137ad6e417a1010486b820661c5ac4cc19d5ec1))
* exclude vitest.config.ts from TypeScript compilation ([37a4e13](https://github.com/Go2Engle/FileBridge/commit/37a4e13de0b63f97b9b8a71e114ac08796fa6d3a))
* trigger release ([8abf0cb](https://github.com/Go2Engle/FileBridge/commit/8abf0cb7e61f2b3ffacd362c274dd79f710b8322))
* trigger release ([f35b4a2](https://github.com/Go2Engle/FileBridge/commit/f35b4a2b44de69ea2269ff8ea6a995c73dd50ab5))
* trigger release ([4a32567](https://github.com/Go2Engle/FileBridge/commit/4a32567b67f54ad67ef7a9e281bf9d68f7d13357))
* update color variables to use oklch for improved accessibility and consistency ([7c50a85](https://github.com/Go2Engle/FileBridge/commit/7c50a8546a882e47ade069522f2ee12bd1434b72))
* update text to use HTML entity for apostrophe in form description ([f68dee9](https://github.com/Go2Engle/FileBridge/commit/f68dee9853b5a378597f13ce4e12a9eb3239fc5f))
