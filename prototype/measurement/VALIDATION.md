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
