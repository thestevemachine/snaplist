"""Isolated local prototype. Never writes SNAPLIST listings or calls a paid API."""
import hashlib, math
import cv2
import numpy as np
VERSION = 'opencv-boxing-prototype-v1'

def decode(data):
    image=cv2.imdecode(np.frombuffer(data,np.uint8),cv2.IMREAD_COLOR)
    if image is None: raise ValueError('Bild nicht lesbar')
    if image.shape[0]*image.shape[1]>30_000_000: raise ValueError('Bild zu groß (höchstens 30 Megapixel)')
    scale=min(1,1400/max(image.shape[:2]))
    return cv2.resize(image,None,fx=scale,fy=scale) if scale<1 else image

def candidates(image):
    gray=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY); gray=cv2.GaussianBlur(gray,(5,5),0)
    h,w=gray.shape; found=[]
    # Multiple thresholds, plus Canny. Retain actual closed contours, not guessed boxes.
    masks=[cv2.threshold(gray,t,255,cv2.THRESH_BINARY_INV)[1] for t in (45,65,85,105,125,145,165)]
    masks += [cv2.Canny(gray,40,110),cv2.Canny(gray,75,160)]
    for mask in masks:
        contours,hierarchy=cv2.findContours(mask,cv2.RETR_TREE,cv2.CHAIN_APPROX_SIMPLE)
        for i,c in enumerate(contours):
            x,y,bw,bh=cv2.boundingRect(c); area=cv2.contourArea(c)
            if not (.12*w<bw<.47*w and .05*h<bh<.65*h and .25<bh/bw<1.4 and area>bw*bh*.45):continue
            if x<.01*w or x+bw>.99*w or y<.01*h or y+bh>.99*h:continue
            if any(abs(x-a['box'][0])+abs(y-a['box'][1])+abs(bw-a['box'][2])+abs(bh-a['box'][3])<8 for a in found):continue
            found.append({'box':(x,y,bw,bh),'contour':c,'hole':bool(hierarchy[0][i][3]>=0)})
    return found

def detect(data):
    im=decode(data);h,w=im.shape[:2]; cs=candidates(im); pairs=[]
    for a in cs:
        for b in cs:
            x,y,aw,ah=a['box'];xx,yy,bw,bh=b['box']
            if x>=xx or x+aw>=xx or not .025*w<xx-x-aw<.25*w:continue
            wd=abs(aw-bw)/max(aw,bw);hd=abs(ah-bh)/max(ah,bh);dy=abs(y+ah/2-yy-bh/2)/max(ah,bh)
            if wd>.18 or hd>.18 or dy>.25:continue
            # Prefer enclosed openings and the largest symmetric pair. Parent contours
            # are not accepted as proof of a rimless lens edge.
            score=(aw*bw)**.5/w - wd-hd-dy + .1*(a['hole']+b['hole'])
            pairs.append((score,a,b))
    if not pairs:return {'version':VERSION,'status':'unavailable','reasons':['Keine zwei geschlossenen Glasöffnungen gefunden. Randlose, Halbrand- oder verdeckte Konturen bitte manuell markieren.'],'points':None,'rank':-1}
    score,a,b=max(pairs,key=lambda p:p[0]); points={}
    for name,c in [('left',a),('right',b)]:
        pts=c['contour'].reshape(-1,2)
        for axis,idx in [('left',np.argmin(pts[:,0])),('right',np.argmax(pts[:,0])),('top',np.argmin(pts[:,1])),('bottom',np.argmax(pts[:,1]))]:
            p=pts[idx];points[name+'_'+axis]=[float(p[0]/w),float(p[1]/h)]
    # Look for a connected outer contour enclosing both openings. Avoid extending
    # a component along table edges by restricting to the lens vertical band.
    x,y,aw,ah=a['box'];xx,yy,bw,bh=b['box']; top=max(0,min(y,yy)-int(.15*max(ah,bh)));bottom=min(h,max(y+ah,yy+bh)+int(.15*max(ah,bh)))
    gray=cv2.cvtColor(im,cv2.COLOR_BGR2GRAY); outer=[]
    for t in (45,65,85,105):
        mask=cv2.threshold(gray,t,255,cv2.THRESH_BINARY_INV)[1]; mask[:top]=0;mask[bottom:]=0
        contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            ox,oy,ow,oh=cv2.boundingRect(c)
            if ox<x and ox+ow>xx+bw and .5*w<ow<.99*w and oh>.5*max(ah,bh):outer.append(c)
    reasons=[]
    if outer:
        c=min(outer,key=lambda c:cv2.boundingRect(c)[2]);pts=c.reshape(-1,2)
        for name,idx in [('outer_left',np.argmin(pts[:,0])),('outer_right',np.argmax(pts[:,0]))]:
            p=pts[idx];points[name]=[float(p[0]/w),float(p[1]/h)]
    else: reasons.append('Äußerste Fassungsgrenzen nicht geschlossen erkennbar; Gesamtbreite fehlt.')
    if not(a['hole'] and b['hole']):reasons.append('Glaskanten können Fassungsränder sein; prüfen.')
    reasons.append('Symmetrie allein beweist keine unverzerrte Perspektive. Vorläufig, keine Listing-Übernahme.')
    return {'version':VERSION,'status':'preliminary','points':points,'reasons':reasons,'rank':round(score,4),'size':[w,h],'closedOpenings':a['hole'] and b['hole']}

def measure(result, reference, bridge=None):
    out={**result,'reference':reference,'metrics':{}}
    if not reference or not 20<=reference.get('mm',0)<=90 or reference.get('source') not in ('label','manual'):
        out['reasons']=[*result.get('reasons',[]),'Keine belegte Glasbreite.'];return out
    p=result.get('points');size=result.get('size')
    if not p or not size:return out
    required={n+'_'+e for n in ('left','right') for e in ('left','right','top','bottom')}
    if not required.issubset(p):
        out['reasons']=[*result.get('reasons',[]),'Bitte alle acht Glaskanten markieren.'];return out
    w,h=size
    for value in p.values():
        if len(value)!=2 or not all(isinstance(v,(int,float)) and math.isfinite(v) and 0<=v<=1 for v in value):raise ValueError('Messpunkte außerhalb des Bildes')
    # Level by the centres of the two boxes. Work in pixel coordinates, not square
    # normalized coordinates; otherwise height is distorted for 4:3 photographs.
    def pixel(k):return np.array([p[k][0]*w,p[k][1]*h])
    lc=(pixel('left_left')+pixel('left_right'))/2;rc=(pixel('right_left')+pixel('right_right'))/2
    angle=math.atan2(*(rc-lc)[::-1]);c,s=math.cos(angle),math.sin(angle)
    def q(k):
        x,y=pixel(k);return np.array([x*c+y*s,-x*s+y*c])
    widths=[q(n+'_right')[0]-q(n+'_left')[0] for n in ('left','right')]
    heights=[q(n+'_bottom')[1]-q(n+'_top')[1] for n in ('left','right')]
    if min(widths)<=0 or min(heights)<=0:raise ValueError('Widersprüchliche Messpunkte')
    scale=reference['mm']/(sum(widths)/2);gap=(q('right_left')[0]-q('left_right')[0])*scale
    out['checks']={'widthDifferencePct':round(abs(widths[0]-widths[1])/max(widths)*100,1),'heightDifferencePct':round(abs(heights[0]-heights[1])/max(heights)*100,1),'rotationDegrees':round(math.degrees(angle),1),'bridgeMm':round(gap,1)}
    failures=[]
    if abs(math.degrees(angle))>12:failures.append('Starke Fassungsrotation; nicht automatisch messbar.')
    if out['checks']['widthDifferencePct']>12 or out['checks']['heightDifferencePct']>12:failures.append('Glasöffnungen unterscheiden sich deutlich: Perspektive oder Konturen prüfen.')
    if not 5<=gap<=40:failures.append('Unplausibler Abstand zwischen den Gläsern.')
    if bridge and abs(gap-bridge)>max(3,bridge*.15):failures.append('Berechneter Steg passt nicht zum gelesenen Kastenmaß.')
    if failures:out['reasons']=[*result.get('reasons',[]),*failures];out['status']='uncertain';return out
    height=sum(heights)/2*scale
    if not 10<=height<=90:
        out['reasons']=[*result.get('reasons',[]),'Unplausible Glashöhe.'];out['status']='uncertain';return out
    out['metrics']['lensHeightMm']=round(height)
    if 'outer_left' in p and 'outer_right' in p:
        span=(q('outer_right')[0]-q('outer_left')[0])*scale
        if 80<=span<=220:out['metrics']['totalWidthMm']=round(span)
    out['status']='preliminary';out['automaticListingTransfer']=False
    return out

def select_front(photos, analysis=None):
    # Reuse Gemini's existing choice. No fresh model call. Validate that image
    # through CV; a CV fallback ranks existing photos when the choice is absent.
    hinted=((analysis or {}).get('front_geometry') or (analysis or {}).get('frontMeasurement',{}).get('observation') or {}).get('photoIndex')
    results=[detect(data) for data in photos]
    valid=[i for i,r in enumerate(results) if r.get('points')]
    if not valid:return None,results
    chosen=hinted-1 if isinstance(hinted,int) and hinted-1 in valid else max(valid,key=lambda i:results[i]['rank'])
    return chosen,results

def cache_key(photos,reference,analysis):
    import json
    return hashlib.sha256(VERSION.encode()+b''.join(hashlib.sha256(p).digest() for p in photos)+json.dumps([reference,analysis],sort_keys=True).encode()).hexdigest()
