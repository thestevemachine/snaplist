"""Isolated local prototype. Never writes SNAPLIST listings or calls a paid API."""
import hashlib, math
import cv2
import numpy as np
VERSION = 'opencv-boxing-prototype-v7'

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
    # Additional adaptive candidate from the supplied prototype. Otsu selects
    # a threshold; it is not evidence that the resulting contour is a lens.
    otsu=cv2.threshold(gray,0,255,cv2.THRESH_BINARY_INV+cv2.THRESH_OTSU)[1]
    masks.append(cv2.morphologyEx(otsu,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8)))
    masks += [cv2.Canny(gray,40,110),cv2.Canny(gray,75,160)]
    enhanced=cv2.createCLAHE(clipLimit=2.0,tileGridSize=(8,8)).apply(gray)
    for low,high in ((12,35),(25,65)):
        edges=cv2.Canny(enhanced,low,high)
        masks.append(cv2.morphologyEx(edges,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8)))
    # Coloured rims can disappear in grayscale against a gray background.
    # Saturation separates their actual frame band from transparent openings.
    hsv=cv2.cvtColor(image,cv2.COLOR_BGR2HSV)
    for saturation in (40,70,110,150):
        masks.append(cv2.inRange(hsv,np.array([0,saturation,30]),np.array([179,255,255])))
    for mask in masks:
        contours,hierarchy=cv2.findContours(mask,cv2.RETR_TREE,cv2.CHAIN_APPROX_SIMPLE)
        for i,c in enumerate(contours):
            x,y,bw,bh=cv2.boundingRect(c); area=cv2.contourArea(c)
            if not (.12*w<bw<.47*w and .05*h<bh<.65*h and .25<bh/bw<1.4 and area>bw*bh*.45):continue
            if x<.01*w or x+bw>.99*w or y<.01*h or y+bh>.99*h:continue
            if any(abs(x-a['box'][0])+abs(y-a['box'][1])+abs(bw-a['box'][2])+abs(bh-a['box'][3])<8 for a in found):continue
            found.append({'box':(x,y,bw,bh),'contour':c,'hole':bool(hierarchy[0][i][3]>=0)})
    return found

def refine_opening(image,candidate):
    """Follow a coherent radial image edge; never use physical target dimensions.

    The binary mask is only a seed. Rear temples can merge into it; a continuous
    gradient path around the opening is better evidence than its bounding box.
    """
    gray=cv2.GaussianBlur(cv2.cvtColor(image,cv2.COLOR_BGR2GRAY),(3,3),0).astype(np.float32)
    gx=cv2.Sobel(gray,cv2.CV_32F,1,0,ksize=3);gy=cv2.Sobel(gray,cv2.CV_32F,0,1,ksize=3)
    if not candidate.get('hole'):
        # Ignore a common background/table horizon visible at BOTH image margins.
        margin=max(5,gray.shape[1]//35)
        left=np.mean(np.abs(gy[:,:margin]),axis=1);right=np.mean(np.abs(gy[:,-margin:]),axis=1)
        horizon=np.minimum(left,right)
        peak=int(horizon.argmax())
        if horizon[peak]>25:
            gx[max(0,peak-7):peak+8]=0;gy[max(0,peak-7):peak+8]=0
    x,y,w,h=candidate['box'];cx=x+w/2;cy=y+h/2
    theta=np.linspace(0,2*np.pi,180,endpoint=False);rho=np.linspace(.68,1.12,89)
    xs=cx+np.cos(theta[:,None])*w/2*rho;ys=cy+np.sin(theta[:,None])*h/2*rho
    dx=cv2.remap(gx,xs.astype(np.float32),ys.astype(np.float32),cv2.INTER_LINEAR)
    dy=cv2.remap(gy,xs.astype(np.float32),ys.astype(np.float32),cv2.INTER_LINEAR)
    strength=np.abs(dx*np.cos(theta[:,None])+dy*np.sin(theta[:,None]))
    # Smooth angular continuity rejects isolated reflections/background horizons.
    strength=np.minimum(strength,180)/180
    cost=-strength+0.15*(rho[None,:]-1)**2
    tiled=np.tile(cost,(3,1));dp=np.zeros(len(rho));back=[]
    transitions=(np.arange(len(rho))[:,None]-np.arange(len(rho))[None,:])**2*.025
    transitions[transitions>1.6]=1e6
    for row in tiled:
        paths=dp[:,None]+transitions;prev=paths.argmin(axis=0)
        dp=row+paths[prev,np.arange(len(rho))];back.append(prev)
    path=[];state=int(dp.argmin())
    for previous in reversed(back):path.append(state);state=int(previous[state])
    path=np.array(path[::-1])[180:360]
    support=strength[np.arange(180),path]
    if np.mean(support>.12)<.7:return candidate
    points=np.stack([xs[np.arange(180),path],ys[np.arange(180),path]],axis=-1)
    contour=np.rint(points).astype(np.int32).reshape(-1,1,2)
    return {**candidate,'contour':contour,'box':cv2.boundingRect(contour),'edgeSupport':float(np.mean(support>.12)),'edgeQuality':float(np.mean(support))}

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
    score,a,b=max(pairs,key=lambda p:p[0])
    def refine(seed):
        base=cv2.GaussianBlur(cv2.cvtColor(im,cv2.COLOR_BGR2GRAY),(3,3),0).astype(np.float32)
        gradient=np.abs(cv2.Sobel(base,cv2.CV_32F,0,1,ksize=3));margin=max(5,im.shape[1]//35)
        horizon=np.minimum(gradient[:,:margin].mean(axis=1),gradient[:,-margin:].mean(axis=1));peak=int(horizon.argmax())
        sx,sy,sw,sh=seed['box']
        if horizon[peak]>25 and min(abs(sy+sh-peak),abs(sy-peak))<im.shape[0]*.03:
            seed={**seed,'hole':False,'horizonClipped':True,'extendUp':abs(sy-peak)<abs(sy+sh-peak)}
        variants=[refine_opening(im,seed)]
        if not seed['hole']:
            x,y,w,h=seed['box']
            # Open rimless outlines may stop at the background horizon. Search
            # lower visible edges, never manufacture a dimension from an aspect ratio.
            for factor in (1.3,1.6,1.9,2.2):
                nh=int(h*factor)
                ny=y-(nh-h) if seed.get('extendUp') else y
                if ny>=0 and ny+nh<im.shape[0]:variants.append(refine_opening(im,{**seed,'box':(x,ny,w,nh)}))
        return max(variants,key=lambda c:c.get('edgeQuality',-1))
    a=refine(a);b=refine(b); points={} 
    for name,c in [('left',a),('right',b)]:
        pts=c['contour'].reshape(-1,2)
        for axis,idx in [('left',np.argmin(pts[:,0])),('right',np.argmax(pts[:,0])),('top',np.argmin(pts[:,1])),('bottom',np.argmax(pts[:,1]))]:
            p=pts[idx];points[name+'_'+axis]=[float(p[0]/w),float(p[1]/h)]
    # Look for a connected outer contour enclosing both openings. Avoid extending
    # a component along table edges by restricting to the lens vertical band.
    x,y,aw,ah=a['box'];xx,yy,bw,bh=b['box']; top=max(0,min(y,yy)-int(.15*max(ah,bh)));bottom=min(h,max(y+ah,yy+bh)+int(.15*max(ah,bh)))
    gray=cv2.cvtColor(im,cv2.COLOR_BGR2GRAY); outer=[]
    hsv=cv2.cvtColor(im,cv2.COLOR_BGR2HSV)
    coloured=cv2.inRange(hsv,np.array([0,70,30]),np.array([179,255,255]))
    outer_masks=[cv2.bitwise_or(cv2.threshold(gray,t,255,cv2.THRESH_BINARY_INV)[1],coloured) for t in (45,65,85,105)]
    # Silver bridges and hinges may be brighter than the background. Their
    # gradient edges connect the two rims even when a dark mask cannot.
    for low,high in ((30,90),(60,140)):
        edges=cv2.Canny(gray,low,high)
        # A table/background horizon can join the frame to the image border.
        # Remove long horizontal background strokes before connecting frame edges.
        lines=cv2.HoughLinesP(edges,1,np.pi/180,80,minLineLength=int(w*.23),maxLineGap=8)
        if lines is not None:
            for line in lines[:,0]:
                x1,y1,x2,y2=map(int,line)
                if abs(y2-y1)<3:cv2.line(edges,(x1,y1),(x2,y2),0,3)
        outer_masks.append(cv2.bitwise_or(edges,coloured))
    for mask in outer_masks:
        mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
        mask[:top]=0;mask[bottom:]=0
        contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            ox,oy,ow,oh=cv2.boundingRect(c)
            if 2<ox<x and xx+bw<ox+ow<w-2 and .5*w<ow<.99*w and oh>.5*max(ah,bh):outer.append(c)
    reasons=[]
    if outer:
        c=max(outer,key=lambda c:cv2.boundingRect(c)[2]);pts=c.reshape(-1,2)
        for name,idx in [('outer_left',np.argmin(pts[:,0])),('outer_right',np.argmax(pts[:,0]))]:
            p=pts[idx];points[name]=[float(p[0]/w),float(p[1]/h)]
    else:
        # Disconnected silver bridge: measure each temple/rim component separately
        # in the upper lens band, away from the horizontal table boundary.
        band_top=max(0,min(y,yy)+int(.08*max(ah,bh)))
        band_bottom=min(h,min(y,yy)+int(.48*max(ah,bh)))
        edge=cv2.Canny(gray,35,100)
        extrema=[]
        for side,lo,hi,touch in [('left',0,x+int(aw*.18),x),('right',xx+bw-int(bw*.18),w,xx+bw)]:
            mask=np.zeros_like(edge);mask[band_top:band_bottom,lo:hi]=edge[band_top:band_bottom,lo:hi]
            mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
            count,labels,stats,_=cv2.connectedComponentsWithStats(mask)
            options=[]
            for k in range(1,count):
                ox,oy,ow,oh,area=stats[k]
                if ox<=2 or ox+ow>=w-2 or oh<max(8,.1*max(ah,bh)):continue
                if side=='left' and ox<touch and ox+ow>touch:options.append(k)
                if side=='right' and ox<touch and ox+ow>touch:options.append(k)
            if options:
                k=max(options,key=lambda k:stats[k,4]);ys,xs=np.where(labels==k)
                index=np.argmin(xs) if side=='left' else np.argmax(xs)
                extrema.append((side,[float(xs[index]/w),float(ys[index]/h)]))
        if len(extrema)==2:
            for side,p in extrema:points['outer_'+side]=p
            reasons.append('Getrennte äußere Konturen: Scharniere und Bügelenden visuell prüfen.')
        else:reasons.append('Äußerste Fassungsgrenzen nicht geschlossen erkennbar; Gesamtbreite fehlt.')
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
