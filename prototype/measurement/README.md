# Isolated SNAPLIST measurement lab

**Prototype only; not integrated or deployed in the listing workflow.** No credentials, API calls, eBay access, title/specific updates, or draft changes. Python runs only on localhost. OpenCV 4.12.0.88 supplies image decoding, Canny edges, thresholding and closed contour hierarchy. OpenCV is Apache-2.0 licensed: https://opencv.org/license/ . Contour reference: https://docs.opencv.org/4.10.0/df/d0d/tutorial_find_contours.html . OpenCV.js was also reviewed (https://github.com/TechStark/opencv-js); Python keeps this experiment out of the current browser bundle.

## Run

Use Python 3.11+ in a separate virtual environment; install `requirements.txt`, then run `python server.py` in this folder. Open http://127.0.0.1:8765 . Current local environment: `/tmp/snaplist-cv-venv/bin/python prototype/measurement/server.py` from repository root.

Select existing photos and optionally the existing Gemini analysis/saved draft JSON. The lab reuses `front_geometry.photoIndex` or `frontMeasurement.observation.photoIndex`; no new model call. CV ranks existing images when this hint is unavailable. A stored `eyewear.fields.lensWidth` with label provenance (quote and photo numbers) supplies calibration. A user-confirmed manual width is allowed for prototype evaluation. Read bridge provenance for an independent check. Other photos do not block listing generation because the lab is a separate process.

Lens openings are searched at several gray thresholds and two Canny thresholds. Pairs are ranked by size, closed-hole evidence, symmetry and alignment. A radial Sobel-gradient path with angular continuity refines each seeded opening to avoid rear-temple extensions; it requires visible gradient support and never consumes the physical comparison targets. Complete-frame connected contours enclosing both openings provide candidate outer extrema. No `2*A+DBL` substitution. Rotation about the camera axis is approximately levelled using lens centres. Yaw, depth/parallax and hidden edges cannot be recovered reliably from one scale value; symmetric contours do not prove absence of perspective. Rimless and semi-rimless openings can be missing or falsely connected; the lab rejects or requires point corrections rather than inventing them.

Display normalized contour points and boxing projection lines; drag a point or edit its x/y fields. All eight glass extrema are required. Outer points are independently optional: missing outer points must never yield frame width. Corrected points are recomputed and remain provisional. JSON export includes reference, image hash based cache identifier, algorithm version, points, checks and values.

SQLite stores local experiment results, reference and manual corrections keyed by original photo hashes, reference, selection and algorithm version. Re-uploading the same inputs restores results instead of measuring again. Photos and keys are not persisted in the database. Changing the reference or image invalidates the cache. For a future account deployment, store the same record under the signed-in account and immutable photo IDs; never share this localhost database across accounts.

## Evaluation and release gate

See `VALIDATION.md`. Run `python -m unittest discover -s prototype/measurement -p 'test_*.py' -v`. `evaluate.py PHOTO --lens-width 50 --bridge 19 --height ACTUAL --total-width ACTUAL` produces an independent error record. Do not count the reference lens width as an accuracy check: it is used for calibration.

Before listing integration, require a separate held-out sample of at least 10 real original front photos spanning acetate, metal, rimless/semi-rimless and moderate rotation, with independently measured height and complete frame width. Proposed gate: accepted-case absolute error <=2 mm height and <=2 mm width, plus report rejection rate and worst error. User approval of this gate and real evidence remain necessary; synthetic tests do not establish physical accuracy. Until then `automaticListingTransfer=false` is unconditional. Do not wire this lab to title generation, existing automatic fields, or paid reanalysis.

Future hook: after the current analysis has saved its reference and selected photo ID, enqueue this independent module; keep listing generation proceeding. Merge only a validated, account-scoped, versioned measurement record. Reference/photo changes invalidate measurements; reanalysing text alone does not. This hook is intentionally not enabled before the accuracy gate.
