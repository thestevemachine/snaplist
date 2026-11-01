"""Evaluate real photos against independent known measurements. No photo copies."""
import argparse,json,hashlib
from pathlib import Path
from engine import detect,measure
p=argparse.ArgumentParser();p.add_argument('photo');p.add_argument('--lens-width',type=float,required=True);p.add_argument('--bridge',type=float);p.add_argument('--height',type=float);p.add_argument('--total-width',type=float);a=p.parse_args()
data=Path(a.photo).read_bytes();result=measure(detect(data),{'mm':a.lens_width,'source':'manual'},a.bridge)
checks=result.get('checks',{});metrics=result.get('metrics',{})
comparisons=[]
for name,truth,prediction in [('bridgeMm',a.bridge,checks.get('bridgeMm')),('lensHeightMm',a.height,metrics.get('lensHeightMm')),('totalWidthMm',a.total_width,metrics.get('totalWidthMm'))]:
 comparisons.append({'dimension':name,'confirmedMm':truth,'predictedMm':prediction,'errorMm':round(prediction-truth,2) if truth is not None and prediction is not None else None})
print(json.dumps({'imageSha256':hashlib.sha256(data).hexdigest(),'referenceIsCalibrationNotAccuracyEvidence':True,'comparisons':comparisons,'result':result},ensure_ascii=False,indent=2))
