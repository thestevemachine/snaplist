"""Local-only lab. No credentials, eBay access or listing writes."""
import base64,json,os,secrets,sqlite3
from pathlib import Path
from http.server import BaseHTTPRequestHandler,HTTPServer
from engine import decode,detect,select_front,measure,cache_key
ROOT=Path(__file__).parent
DB=sqlite3.connect(os.environ.get('SNAPLIST_MEASUREMENT_DB',str(ROOT/'measurements.sqlite3')),check_same_thread=False)
DB.execute('CREATE TABLE IF NOT EXISTS measurements (id TEXT PRIMARY KEY, result TEXT NOT NULL)')
TOKEN=secrets.token_urlsafe(32)

def reference_from_analysis(analysis):
    field=(analysis or {}).get('eyewear',{}).get('fields',{}).get('lensWidth',{})
    if field.get('source')=='label' and field.get('quote') and field.get('photos'):
        try:
            mm=float(str(field['value']).replace('mm','').strip())
            if 20<=mm<=90:return {'mm':mm,'source':'label','quote':field['quote'],'photos':field['photos']}
        except (KeyError,ValueError):pass
    return None

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def send(self,status,value,mime='application/json'):
        data=value.encode() if isinstance(value,str) else json.dumps(value).encode()
        self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def do_GET(self):
        if self.headers.get('Host') not in ('127.0.0.1:8765','localhost:8765'):return self.send(403,{})
        if self.path!='/':return self.send(404,{})
        return self.send(200,(ROOT/'index.html').read_text().replace('__TOKEN__',TOKEN),'text/html; charset=utf-8')
    def do_POST(self):
        if self.headers.get('Host') not in ('127.0.0.1:8765','localhost:8765'):return self.send(403,{})
        if self.headers.get('X-Lab-Token')!=TOKEN:return self.send(403,{'error':'Lokaler Zugriff erforderlich'})
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<32_000_000:raise ValueError('Höchstens 32 MB pro Anfrage')
            body=json.loads(self.rfile.read(length))
            if self.path=='/analyze':
                photos=[base64.b64decode(s,validate=True) for s in body['photos']]
                if not 1<=len(photos)<=24:raise ValueError('1 bis 24 Fotos auswählen')
                analysis=body.get('analysis') or {};ref=reference_from_analysis(analysis)
                if body.get('bridge') is None:
                    field=analysis.get('eyewear',{}).get('fields',{}).get('bridgeWidth',{})
                    if field.get('source')=='manual' or (field.get('source')=='label' and field.get('quote') and field.get('photos')):
                        try:body['bridge']=float(str(field['value']).replace('mm','').strip())
                        except (ValueError,KeyError):pass
                if not ref and body.get('reference'):
                    ref={'mm':float(body['reference']),'source':'manual'}
                if ref and not 20<=ref['mm']<=90:raise ValueError('Glasbreite 20 bis 90 mm')
                key=cache_key(photos,ref,{'front_geometry':analysis.get('front_geometry') or analysis.get('frontMeasurement',{}).get('observation') or {},'preferredPhoto':body.get('preferredPhoto'),'bridge':body.get('bridge')})
                row=DB.execute('SELECT result FROM measurements WHERE id=?',(key,)).fetchone()
                if row:return self.send(200,{**json.loads(row[0]),'id':key,'cached':True})
                selected,results=select_front(photos,analysis)
                if isinstance(body.get('preferredPhoto'),int) and 0<=body['preferredPhoto']<len(photos):selected=body['preferredPhoto']
                if selected is None:selected=0
                if not results[selected].get('size'):
                    im=decode(photos[selected]);results[selected]['size']=[im.shape[1],im.shape[0]]
                    results[selected]['points']={}
                result={'status':'unavailable','reasons':['Kein geeignetes Frontfoto.'],'points':None,'metrics':{}} if selected is None else measure(results[selected],ref,body.get('bridge'))
                result.update({'photoIndex':None if selected is None else selected+1,'bridgeReference':body.get('bridge'),'candidates':[{'photoIndex':i+1,'status':r['status'],'rank':r['rank']} for i,r in enumerate(results)],'automaticListingTransfer':False})
            elif self.path=='/correct':
                key=body['id'];row=DB.execute('SELECT result FROM measurements WHERE id=?',(key,)).fetchone()
                if not row:raise ValueError('Messung nicht gespeichert')
                original=json.loads(row[0]);result=measure({**original,'points':body['points'],'reasons':['Messpunkte manuell korrigiert. Vorläufig.'],'correctionSource':'manual'},original.get('reference'),original.get('bridgeReference'))
            else:return self.send(404,{})
            DB.execute('INSERT OR REPLACE INTO measurements VALUES (?,?)',(key,json.dumps(result)));DB.commit()
            return self.send(200,{**result,'id':key,'cached':False})
        except Exception as e:return self.send(400,{'error':str(e)[:250]})

if __name__=='__main__':
    print('Messlabor: http://127.0.0.1:8765',flush=True)
    HTTPServer(('127.0.0.1',8765),Handler).serve_forever()
