# Local measurement integration — 2026-11-01

Working copy: /tmp/snaplist-cv-integration, branch codex/opencv-measurement-prototype.

After a normal listing reaches done, Workspace queues one local measurement at a time. The existing analysis selects the front photo; its index is mapped through evidencePhotoIds. No guessed first-image fallback. OpenCV runs in a worker, never an additional model call. Missing scale/photo or worker failures do not fail listing generation. Measurements remain explicitly uncertain.

The persisted record contains photo IDs, reference/version key, normalized glass and outer points, image size and timestamp. Text reanalysis preserves records for unchanged photos/reference. Changes to bridge evidence invalidate the key too. Results are applied only to the same unmodified unpublished listing in the same account. Manual values and clears use existing field projection protections. Existing populated specifics are preserved. The separate local button allows retry/photo selection.

Worker-only CSP permits Emscripten dynamic bindings; the document policy is unchanged. Worker connect-src is none. Generated public/cv/opencv.js is ignored; predev/prebuild copies the pinned npm dependency.

Validation: 606 unit tests passed; production build passed; real Chrome worker test passed with synthetic glass contours and no model requests. Repository-wide tsc includes pre-existing test fixture typing errors; Next production application typecheck passes.

Outstanding: end-to-end automatic listing/persistence/account-switch browser scenarios, representative unseen real-photo accuracy validation, visible point correction overlay. Known prototype rimless width error remains about -5 mm. Do not claim +/-2 mm accuracy or production readiness. Nothing deployed.
