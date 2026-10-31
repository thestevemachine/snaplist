# Validation — 2026-10-31

## Implemented and verified
- OpenCV detector, candidate front selection, existing Gemini selection reuse.
- Scale conversion, rotation compensation, independent bridge/asymmetry checks.
- Overlay, editable points, result persistence/cache, JSON export.
- 12 automatic tests passed: synthetic known dimensions, rotation, reference missing/invalid, missing outer contour, contradictory bridge, asymmetric openings, invalid/missing points, blank image, synthetic detection, cache invalidation.
- Headless Chrome flow passed: actual photo upload → OpenCV → rejected uncertain result → manual point correction → save → upload same inputs → restored correction. No JavaScript errors.

## Real available image
Original `IMG_7758.JPG`, noego. 4032×3024; processed at 1400×1050. Calibration lens width 50 mm, known bridge 19 mm (user-provided Kastenmaß). SHA256 is recorded by `evaluate.py`. Original photo is not added to this prototype's Git files.

| Independent dimension | Known | Predicted | Deviation | Outcome |
|---|---:|---:|---:|---|
| Bridge width (validation, not calibration) | 19 mm | 11.8 mm | −7.2 mm / −37.9% | Rejected |
| Lens height | Not independently measured | Withheld | Not evaluable | No accuracy claim |
| Complete frame width | Not independently measured | Withheld | Not evaluable | No accuracy claim |

The detector picked a pair of closed contours incorporating parts of the transparent frame. Symmetry passed but the independent bridge check caught the wrong boundaries. This is exactly why symmetric-looking points alone must not enable automatic listing transfer.

Earlier Gemini-only 44 mm height / 140 mm width are NOT ground truth. They are not used to validate this prototype. The previously supplied Face à Face example (54–18, manually about 28 mm height and 144 mm width) cannot currently be evaluated because its original local image path no longer exists. Reconstructing it from a screenshot would change the evidence and was not done.

**Reached physical accuracy: not yet demonstrated.** Known synthetic geometry: exact after integer rounding. Real image: rejection due to independent −7.2 mm bridge error. One real photo cannot establish performance across eyewear types.

## Required next evidence
At minimum restore the original Face à Face photo and provide paired real original photos + manual height/complete width measurements. Then refine inner-edge detection on training examples and measure the release gate on held-out examples. Keep results preliminary and the automatic listing transfer disabled until this succeeds.

## Second real example — IMG_7769.JPG (prototype v3)
User-confirmed approximately 37 mm height / 135 mm complete width; Kastenmaß 52–18. Colour-saturation masks were added because the bright pink metal rim disappears against the gray background in grayscale. Outer-frame detection combines the visible coloured rim with dark connected hinges/temples; it does not use the known total width as input.

| Independent dimension | Known | Predicted | Deviation |
|---|---:|---:|---:|
| Bridge | 18 mm | 19.2 mm | +1.2 mm |
| Lens height | ca. 37 mm | 35 mm | −2 mm |
| Complete width | ca. 135 mm | 135 mm | 0 mm |

This is a development example, not a held-out validation sample. No fixed offset or target-matching correction was introduced. The noego example is still rejected (bridge 11.8 vs 19 mm). All 12 engine tests still pass. Automatic listing transfer remains disabled; one successful example is insufficient for release.

## Third real example — Lindberg RUI 45, s-l1600.jpg (prototype v4, 2026-11-01)
User explicitly confirmed that 37 mm height / 130 mm complete width were manually measured. Calibration: lens width 45 mm, bridge check 22 mm. Photo SHA256: `0f3812b8e838b41290d517d9308efc91904d2c9b87a3eca4d253ac96d8e1db66`.

The bright silver bridge does not form a connected dark silhouette. Added Canny-gradient components and a separately checked left/right outer-component fallback. Reject contours touching the image edge; this caught a false table/background horizon. The fallback requires visible component continuity through the temporal lens boundary and remains explicitly provisional. It never derives full width from lens width plus bridge.

| Independent dimension | Known | Predicted | Deviation |
|---|---:|---:|---:|
| Bridge | 22 mm | 23.8 mm | +1.8 mm |
| Lens height | 37 mm | 37 mm | 0 mm |
| Complete width | 130 mm | 128 mm | −2 mm |

The pink 52–18 frame still produces 35 / 135 mm. The noego remains rejected for the 11.8 vs 19 mm bridge discrepancy. 12 automatic engine tests pass. On the two accepted development examples, mean absolute height error is 1 mm and complete-width error is 1 mm; worst observed error is 2 mm for each. This is NOT a representative or held-out accuracy claim: the algorithm was developed while viewing these examples, and one of three real examples is rejected. Automatic listing transfer remains disabled.

## Review of supplied Python code — 2026-11-01
Reviewed the complete pasted code. Reused its Otsu threshold plus 3×3 morphological closing as an additional contour candidate in prototype v5. Existing Gaussian blur and contour hierarchy already use the same basic OpenCV building blocks. Otsu is not a guarantee of a correct frame segmentation. The new candidate does not change results on the three current real images; all 12 tests still pass.

The supplied script's measurement function was also run unchanged with the independently supplied reference widths injected instead of OCR. OCR itself was NOT tested; no extra OCR dependency or paid AI request was installed/called. Output-image writes were disabled for this comparison.

| Photo | Supplied function: height / width | Current prototype: height / width | Manual comparison |
|---|---|---|---|
| Pink 52–18 | 18.1 / 179.2 mm | 35 / 135 mm | ca. 37 / 135 mm |
| Lindberg 45–22 | 18.3 / 155.5 mm | 37 / 128 mm | 37 / 130 mm |
| noego 50–19 | 21.0 / 166.7 mm | rejected | height/width unconfirmed |

Not adopted: treating the largest contour as the frame (can select background), using only one child contour as a lens, and the hardcoded fallback `lensWidthPx=frameWidthPx*0.39` / `lensHeightPx=frameHeightPx*0.85`. These can produce plausible numbers without observed glass boundaries and violate the no-invented-measurement rule. Its OCR regex also needs full Kastenmaß separators (including □ and []), plausible ranges, provenance and ambiguity checks before it could replace the already available Gemini text extraction. For now the lab continues reusing existing reference evidence, which avoids another OCR stage and calls.

The user's accepted target is approximately ±2 mm for height and complete width. Current two accepted development examples meet that observed error, but this is not independent validation; the noego rejection remains unresolved.

## New unseen photo — blue Lindberg 076, s-l1600-1.jpg (frozen prototype v5)
SHA256 `6575f6a7c7394a56c0d81771352adfbdc9b817a2eb64d60ecbfe429369aa4af9`. Existing unmodified v5 ran before any tuning on this photo. Screenshot provides 46–17, height 39 mm and width 124 mm; independent manual confirmation of the last two values is pending.

| Dimension | Screenshot comparison | Predicted | Difference |
|---|---:|---:|---:|
| Bridge | 17 mm | 16.2 mm | −0.8 mm |
| Height | 39 mm | 34 mm | −5 mm |
| Complete width | 124 mm | 114 mm | −10 mm |

This does not meet the ±2 mm target. The independent bridge and lens-symmetry tests passed despite incorrect temporal lens boundaries; a bridge check alone cannot establish accurate contour detection. Candidate inspection shows rear-temple/frame contours extending into the opening bounding boxes. No new algorithm tuning or target-based correction was applied. The automatic listing transfer remains disabled. Confirm the screenshot dimensions were independently measured before treating them as ground truth.

## Gradient refinement after manual confirmation — prototype v6
The user explicitly confirmed the blue Lindberg values 39 / 124 mm were measured. Retained the v5 failure above as the unmodified baseline. Added a classical-CV radial gradient path around each candidate opening: Sobel image evidence plus angular continuity, rather than trusting the entire threshold component (which can include rear temples). No physical target measurements are passed to this refinement. Fewer than 70% supported angular samples leaves the seed unchanged; no invented edge points. Algorithm version changes the cache key.

All confirmed development examples rerun:

| Photo | Calibration / bridge check | Manual height / width | v6 height / width | Error height / width |
|---|---|---|---|---|
| Pink IMG_7769 | 52 / 18 mm | ca. 37 / 135 mm | 37 / 134 mm | 0 / −1 mm |
| Red Lindberg RUI | 45 / 22 mm | 37 / 130 mm | 36 / 129 mm | −1 / −1 mm |
| Blue Lindberg 076 | 46 / 17 mm | 39 / 124 mm | 37 / 124 mm | −2 / 0 mm |

Mean absolute errors on these three development examples: height 1 mm, width 0.67 mm. Maximum observed height error 2 mm, width 1 mm. The noego now yields candidate 40 / 144 mm with a 20.6 vs 19 mm bridge check; its height/width remain unconfirmed, so it is NOT counted as an accuracy success. All samples were seen during development; independent validation and rimless/semi-rimless coverage are still outstanding. No auto-transfer enabled.

14 automatic tests pass, including a synthetic front ellipse with a rear-temple extension and a no-edge blank-input test. The visible overlay now labels provisional mm values on the projection lines and hides stale values while points are being edited. Headless Chrome verified the actual blue-photo response (37 / 124), point correction, persistence and cached restoration. No model/API call is required for this measurement.
