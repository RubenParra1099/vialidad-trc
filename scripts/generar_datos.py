#!/usr/bin/env python3
"""Genera public/data/omega.json a partir del Excel operativo (omega 2023.xlsx).

Uso:
    pip install pandas openpyxl numpy
    python scripts/generar_datos.py "ruta/omega 2023.xlsx"

Incluye la geolocalización por domicilio de "eventos y apoyos" y "bitácora",
usando como referencia las direcciones con coordenadas de las demás hojas.
"""
import sys, os, re, json, math, unicodedata, datetime as dt
from collections import Counter, defaultdict
import pandas as pd, numpy as np

XLSX = sys.argv[1] if len(sys.argv) > 1 else 'omega 2023.xlsx'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data', 'omega.json')
print('Leyendo', XLSX)
x = pd.read_excel(XLSX, sheet_name=None)

# ---- Referencia de direcciones con coordenadas
import pickle,re,unicodedata,json
import pandas as pd, numpy as np
def nrm(s):
    s=unicodedata.normalize('NFD',str(s).upper()); s=''.join(c for c in s if unicodedata.category(c)!='Mn')
    s=re.sub(r'[^A-Z0-9 ]',' ',s); return re.sub(r'\s+',' ',s).strip()
def geo(v):
    try:
        a,b=[float(t) for t in str(v).split(',')[:2]]
        if 25.3<a<25.8 and -103.65<b<-103.1: return (a,b)
    except: pass
pairs=[]
for sh,tc,gc in [('accidentes viales','UBICACION','GEORREFERENCIACIÓN'),('vehiculos mal estacionados','DOMICILIO','GEOREFERENCIACIÓN'),('vehiculos al corralon','DOMICILIO INFRACCIÓN','GEOREFERENCIACIÓN'),('detenidos','UBICACIÓN DEL VEHICULO','GEOREFERENCIACIÓN')]:
    df=x[sh]
    for t,g in zip(df[tc],df[gc]):
        p=geo(g)
        if p and isinstance(t,str) and t.strip(): pairs.append((nrm(t),p))
gaz={}
for t,p in pairs: gaz.setdefault(t,[]).append(p)
gaz={k:(float(np.median([a for a,b in v])),float(np.median([b for a,b in v])),len(v)) for k,v in gaz.items()}

# ---- Normalización de calles y cruces
PFX=r'^(BLVD|BOULEVARD|BULEVAR|BOULEVAR|AV|AVE|AVENIDA|CALZ|CALZADA|C|CALLE|CARR|CARRETERA|PROL|PROLONGACION|PRIV|PRIVADA|PERIF|PERIFERICO|CJON|CALLEJON|PASEO|PSO|BLV|ANDADOR|CIRCUITO|CTO|CIRC|ANTIGUA|ANT|LIBRAMIENTO|LIB|PTE|PUENTE|DIAG|DIAGONAL|DEL|DE LA|DE LOS|DE LAS|DE|LA|EL|LOS|LAS)\s+'
def core(s):
    s=s.strip()
    s=re.split(r'\b(FTE|FRENTE|ALTURA|A LA ALTURA|COL|COLONIA|CP|NUM|NO|ENTRE|ESQ|ESQUINA|INT|EXT)\b',s)[0].strip()
    prev=None
    while prev!=s:
        prev=s; s=re.sub(PFX,'',s).strip()
    s=re.sub(r'^(\d+)\s*(OTE|PTE|SUR|NTE|NORTE|ORIENTE|PONIENTE)?$',r'CALLE \1',s) if re.match(r'^\d+',s) else s
    return s
def split2(t):
    m=re.split(r'\s+(?:Y|E|ESQ|ESQUINA|CON|A|HACIA|AL)\s+',t)
    m=[core(p) for p in m if p.strip()]
    return [p for p in m if p]
pairkey={}
for t,(a,b,n) in gaz.items():
    ps=split2(t)
    if len(ps)>=2:
        k=frozenset(ps[:2])
        if len(k)==2: pairkey.setdefault(k,[]).append((a,b,n))
single={}
for t,(a,b,n) in gaz.items():
    ps=split2(t)
    if len(ps)==1: single.setdefault(ps[0],[]).append((a,b,n))
def agg(v):
    w=sum(n for *_,n in v); return (sum(a*n for a,b,n in v)/w, sum(b*n for a,b,n in v)/w, w)
pairkey={k:agg(v) for k,v in pairkey.items()}; single={k:agg(v) for k,v in single.items()}

# ---- Geolocalización por domicilio
STOP=set('DE LA EL LOS LAS Y A EN AL DEL POR CON E O ENTRE FTE FRENTE ALTURA COL CALLE AV BLVD CALZ C SUR NORTE OTE PTE NTE HACIA CARRIL CARRILES LATERAL CENTRALES TORREON GOMEZ'.split())
keys=list(gaz.keys())
toks=[set(t for t in k.split() if t not in STOP and len(t)>1) for k in keys]
df=Counter(t for s in toks for t in s); N=len(keys)
idf={t:math.log(N/(1+c)) for t,c in df.items()}
inv=defaultdict(list)
for i,s in enumerate(toks):
    for t in s: inv[t].append(i)
def fuzzy(t):
    q=set(w for w in t.split() if w not in STOP and len(w)>1)
    q={w for w in q if w in idf}
    if not q: return None
    sc=defaultdict(float)
    for w in q:
        for i in inv[w]: sc[i]+=idf[w]
    if not sc: return None
    qn=sum(idf[w] for w in q)
    best=None;bs=0
    for i,s in sc.items():
        kn=sum(idf[w] for w in toks[i])
        score=s/ math.sqrt(qn*kn)
        score*= (1+0.02*min(gaz[keys[i]][2],10))
        if score>bs: bs=score;best=i
    if bs>=0.62: return gaz[keys[best]][:2],bs
    return None
cache={}
BLACK={'NO INDICA','DSPM','CARRUSEL','SIN DOMICILIO','NO ESPECIFICA','SIN DATO','INSTALACIONES DE DSPM'}
PLACES={'VILLA FLORIDA':(25.58555,-103.40990),'AZULEJOS':(25.64180,-103.36980)}
def locate_route(raw):
    t=nrm(raw) if isinstance(raw,str) else ''
    if not t or t in BLACK: return None
    m=re.match(r'^(.+?)\s+A\s+(.+)$',t)
    if m and ' Y ' not in t:
        o=m.group(1).strip()
        if o in PLACES: return (*PLACES[o],2)
        return None
    return locate(t)
def locate(raw):
    t=nrm(raw) if isinstance(raw,str) else ''
    if not t or t in BLACK: return None
    if t in cache: return cache[t]
    r=None
    if t in gaz: r=(gaz[t][0],gaz[t][1],1)
    else:
        ps=split2(t)
        if len(ps)>=2 and frozenset(ps[:2]) in pairkey: a=pairkey[frozenset(ps[:2])]; r=(a[0],a[1],1)
        elif len(ps)==1 and ps[0] in single: a=single[ps[0]]; r=(a[0],a[1],1)
        else:
            f=fuzzy(t)
            if f: r=(f[0][0],f[0][1],2)
    cache[t]=r; return r
out={}
for sh,key,fn in [('eventos y apoyos','eve',locate),('bitacora','bit',locate_route)]:
    d=x[sh]; d=d[d['FECHA'].notna()]
    res=[fn(v) for v in d['DOMICILIO']]
    c=Counter(r[2] if r else 0 for r in res); print(key,len(res),c)
    out[key]=[[round(r[0],5),round(r[1],5),r[2]] if r else None for r in res]
G=out

# ---- Bases operativas
import pickle, re, json, datetime as dt
import pandas as pd, numpy as np


BASE = pd.Timestamp('2023-01-01')

def norm(v):
    if v is None or (isinstance(v, float) and np.isnan(v)): return 'SIN DATO'
    s = re.sub(r'\s+', ' ', str(v)).strip().upper()
    if s in ('', 'NAN', 'NONE', 'NAT', '-', '0'): return 'SIN DATO'
    return s

def colonia(v):
    s = norm(v)
    s = re.sub(r',\s*\d{5}.*$', '', s).strip()
    return s or 'SIN DATO'

def fecha(series):
    d = pd.to_datetime(series, errors='coerce')
    idx = (d - BASE).dt.days
    return idx.where((idx >= 0) & (idx < 365), -1).fillna(-1).astype(int).tolist()

def hora(v):
    if v is None or (isinstance(v, float) and np.isnan(v)): return -1
    if isinstance(v, (dt.time, dt.datetime)): return v.hour
    m = re.match(r'^\s*(\d{1,2})[:.]', str(v))
    if m and int(m.group(1)) < 24: return int(m.group(1))
    return -1

def geo(v):
    try:
        a, b = [float(t) for t in str(v).replace(';', ',').split(',')[:2]]
        if 25.3 < a < 25.8 and -103.65 < b < -103.1: return [round(a, 4), round(b, 4)]
    except Exception: pass
    return None

def num(series):
    return pd.to_numeric(series, errors='coerce').fillna(0).clip(lower=0).astype(int).tolist()

def edad_bucket(v):
    try: e = float(v)
    except Exception: return 'SIN DATO'
    if not (10 <= e <= 99): return 'SIN DATO'
    for lo, hi in [(10,17),(18,24),(25,34),(35,44),(45,54),(55,64)]:
        if lo <= e <= hi: return f'{lo}-{hi}'
    return '65+'

def topn(vals, n, other='OTROS'):
    vc = pd.Series(vals).value_counts()
    keep = set(vc.index[:n])
    return [v if v in keep else other for v in vals]

def encode(cols):
    """cols: dict name -> list. strings become dictionary-coded."""
    out = {'n': len(next(iter(cols.values()))), 'dims': {}, 'vals': {}}
    for k, arr in cols.items():
        if arr and isinstance(arr[0], str):
            vc = pd.Series(arr).value_counts()
            dic = list(vc.index)
            pos = {v: i for i, v in enumerate(dic)}
            out['dims'][k] = {'dict': dic, 'c': [pos[v] for v in arr]}
        else:
            out['vals'][k] = arr
    return out

D = {}

# ---------- Accidentes viales
a = x['accidentes viales']
a = a[a['FECHA'].notna() | a['HORA'].notna()].copy()
g = [geo(v) for v in a['GEORREFERENCIACIÓN']]
motivo = [norm(v) for v in a['MOTIVO NO ATENDIDO']]
D['acc'] = encode({
    'fecha': fecha(a['FECHA']),
    'hora': [hora(v) for v in a['HORA']],
    'sector': [norm(v) for v in a['SECTOR']],
    'jurisdiccion': [norm(v) for v in a['JURISDICCION']],
    'origen': [norm(v) for v in a['ORIGEN']],
    'grupo': [norm(v) for v in a['GRUPO']],
    'tipo': [norm(v) for v in a['TIPO']],
    'danos': [norm(v) for v in a['DAÑOS']],
    'causa': [norm(v) for v in a['CAUSA']],
    'motivo': motivo,
    'estatus': ['ATENDIDO' if m == 'SIN DATO' else 'NO ATENDIDO' for m in motivo],
    'colonia': topn([colonia(v) for v in a['COLONIA']], 300),
    'vehiculo': [norm(v) for v in a['CLASIFICACION 1']],
    'servicio': [norm(v) for v in a['TIPO SERVICIO 1']],
    'sexo': [norm(v) for v in a['SEXO 1']],
    'edad': [edad_bucket(v) for v in a['EDAD 1']],
    'les': num(a['TOTAL LESIONADOS']),
    'fal': num(a['TOTAL FALLECIDOS']),
    'lesM': num(a['LESIONADO MASCULINO']), 'lesF': num(a['LESIONADO FEMENINO']),
    'falM': num(a['FALLECIDO MASCULINO']), 'falF': num(a['FALLECIDO FEMENINO']),
    'nveh': num(a['CANTIDAD DE VEHICULOS PARTICIPANTES']),
    'lat': [p[0] if p else None for p in g], 'lng': [p[1] if p else None for p in g],
})

# ---------- Eventos y apoyos
e = x['eventos y apoyos']
e = e[e['FECHA'].notna()].copy()
D['eve'] = encode({
    'fecha': fecha(e['FECHA']),
    'hora': [hora(v) for v in e['HORA']],
    'dependencia': [norm(v) for v in e['DEPENDENCIA']],
    'accion': [norm(v) for v in e['ACCIONES']],
    'grupo': [norm(v) for v in e['GRUPO ']],
    'sector': [norm(v) for v in e['SECTOR']],
    'origen': [norm(v) for v in e['ORIGEN']],
})

# ---------- Bitácora
b = x['bitacora']
b = b[b['FECHA'].notna()].copy()
raz = [norm(v) for v in b['RAZONAMIENTO']]
D['bit'] = encode({
    'fecha': fecha(b['FECHA']),
    'hora': [hora(v) for v in b['HORA']],
    'unidad': [norm(v) for v in b['UNIDAD']],
    'grupo': [norm(v) for v in b['GRUPO']],
    'clave': topn(raz, 14),
})

# ---------- Corralón
c = x['vehiculos al corralon']
c = c[c['FECHA'].notna()].copy()
g = [geo(v) for v in c['GEOREFERENCIACIÓN']]
tipo = [norm(v) for v in c['TIPO']]
tipo = [t if t in ('MOTO','SEDAN','CAMIONETA','CAMION CARGA','AUTOBUS','REMOLQUE','MOTOCICLETA','TRAILER') else 'SIN DATO' for t in tipo]
tipo = ['MOTO' if t == 'MOTOCICLETA' else t for t in tipo]
def anio(v):
    try:
        y = int(float(v)); return str(y) if 1960 <= y <= 2024 else 'SIN DATO'
    except Exception: return 'SIN DATO'
def antig(v):
    y = anio(v)
    if y == 'SIN DATO': return y
    y = int(y)
    return '2020-2024' if y >= 2020 else '2015-2019' if y >= 2015 else '2010-2014' if y >= 2010 else '2000-2009' if y >= 2000 else 'ANTES 2000'
def grua(v):
    s = norm(v)
    return s.split(' ')[0] if s != 'SIN DATO' else s
D['cor'] = encode({
    'fecha': fecha(c['FECHA']),
    'tipo': tipo,
    'marca': topn([norm(v) for v in c['MARCA']], 25),
    'modelo': [antig(v) for v in c['AÑO']],
    'grua': topn([grua(v) for v in c['GRÚA']], 8),
    'lat': [p[0] if p else None for p in g], 'lng': [p[1] if p else None for p in g],
})

# ---------- Mal estacionados
m = x['vehiculos mal estacionados']
m = m[m['FECHA'].notna()].copy()
g = [geo(v) for v in m['GEOREFERENCIACIÓN']]
mot = [norm(v) for v in m['MOTIVO NO ATENDIDO']]
D['mal'] = encode({
    'fecha': fecha(m['FECHA']),
    'hora': [hora(v) for v in m['HORA']],
    'evento': [norm(v) for v in m['EVENTO']],
    'sector': [norm(v) for v in m['SECTOR']],
    'grupo': [norm(v) for v in m['GRUPO ']],
    'motivo': mot,
    'estatus': ['ATENDIDO' if v == 'SIN DATO' else 'NO ATENDIDO' for v in mot],
    'origen': [norm(v) for v in m['ORIGEN']],
    'colonia': topn([colonia(v) for v in m['COLONIA']], 200),
    'lat': [p[0] if p else None for p in g], 'lng': [p[1] if p else None for p in g],
})

# ---------- Detenidos
d = x['detenidos']
d = d[d['FECHA'].notna()].copy()
g = [geo(v) for v in d['GEOREFERENCIACIÓN']]
def etil(v):
    s = norm(v)
    if s == 'SIN DATO': return s
    if 'OVER' in s: return 'OVER (>LÍMITE)'
    try: f = float(s)
    except Exception: return 'SIN DATO'
    return '<0.40' if f < .4 else '0.40-0.79' if f < .8 else '0.80-1.49' if f < 1.5 else '≥1.50'
dtipo = [norm(v) for v in d['TIPO']]
dtipo = ['MOTO' if t == 'MOTOCICLETA' else t for t in dtipo]
D['det'] = encode({
    'fecha': fecha(d['FECHA']),
    'hora': [hora(v) for v in d['HORA REMISIÓN']],
    'edad': [edad_bucket(v) for v in d['EDAD']],
    'etilico': [etil(v) for v in d['GRADO ETILICO']],
    'tipo': dtipo,
    'marca': topn([norm(v) for v in d['MARCA']], 20),
    'autoridad': [norm(v) for v in d['AUTORIDAD']],
    'grua': topn([grua(v) for v in d['GRUAS']], 8),
    'lat': [p[0] if p else None for p in g], 'lng': [p[1] if p else None for p in g],
})


# ---- Campos completos, participantes y coordenadas por domicilio
import re
def txt(v):
    if v is None or (isinstance(v,float) and np.isnan(v)): return ''
    if isinstance(v,float) and v.is_integer(): v=int(v)
    if isinstance(v,(dt.time,)): return v.strftime('%H:%M')
    if isinstance(v,(dt.datetime,pd.Timestamp)): return v.strftime('%d/%m/%Y %H:%M')
    s=re.sub(r'\s+',' ',str(v)).strip()
    return '' if s.upper() in ('NAN','NONE','NAT') else s
def hm(v):
    if isinstance(v,(dt.time,dt.datetime)): return v.strftime('%H:%M')
    s=txt(v); m=re.match(r'^(\d{1,2}):(\d{2})',s)
    return f'{int(m.group(1)):02d}:{m.group(2)}' if m else ''
def enc_txt(cols):
    out={}
    for k,arr in cols.items():
        vc=pd.Series(arr).value_counts(); dic=list(vc.index); pos={v:i for i,v in enumerate(dic)}
        out[k]={'dict':dic,'c':[pos[v] for v in arr]}
    return out
def T(df,col): return [txt(v) for v in df[col]]

D['acc']['txt']=enc_txt({'hm':[hm(v) for v in a['HORA']],'ubicacion':T(a,'UBICACION'),'colonia_full':T(a,'COLONIA'),
  'agentes':T(a,'AGENTE(S)'),'unidades':T(a,'UNIDAD (ES)'),'operador':T(a,'OPERADOR EN TURNO'),'razonamiento':T(a,'RAZONAMIENTO')})
# participantes
P={k:[] for k in ['acc','n','nombre','domicilio','tel','sexo','edad','servicio','tiposerv','clasif','marca','modelo','placas','color']}
cols=list(a.columns)
for ri,(_,r) in enumerate(a.iterrows()):
    for n in range(1,17):
        nom=f'NOMBRE COMPLETO {n}'
        if nom not in cols: continue
        g=lambda base: txt(r.get(f'{base} {n}')) if f'{base} {n}' in cols else ''
        serv = g('TIPO SERVICIO') if n==1 else g('SERVICIO')
        tser = txt(r.get('TIPO SERVICIO')) if n==1 else g('TIPO SERVICIO')
        vals=[g('NOMBRE COMPLETO'),g('DOMICILIO'),g('TELEFONO'),g('SEXO'),g('EDAD'),serv,tser,g('CLASIFICACION'),g('MARCA'),g('TIPO'),g('PLACAS'),g('COLOR')]
        if not any(vals): continue
        P['acc'].append(ri);P['n'].append(n)
        for k,v in zip(['nombre','domicilio','tel','sexo','edad','servicio','tiposerv','clasif','marca','modelo','placas','color'],vals): P[k].append(v)
D['accp']={'n':len(P['acc']),'acc':P['acc'],'num':P['n'],'txt':enc_txt({k:v for k,v in P.items() if k not in('acc','n')})}
D['eve']['txt']=enc_txt({'hm':[hm(v) for v in e['HORA']],'domicilio':T(e,'DOMICILIO'),'unidades':T(e,'UNIDADES'),'agentes':T(e,'AGENTE(S)'),'operador':T(e,'OPERADOR'),'razonamiento':T(e,'RAZONAMIENTO')})
D['bit']['txt']=enc_txt({'hm':[hm(v) for v in b['HORA']],'domicilio':T(b,'DOMICILIO'),'operador':T(b,'OPERADOR'),'razonamiento':T(b,'RAZONAMIENTO')})
D['cor']['txt']=enc_txt({'domicilio':T(c,'DOMICILIO INFRACCIÓN'),'marca_full':T(c,'MARCA'),'submarca':T(c,'SUB MARCA'),'anio':T(c,'AÑO'),'color':T(c,'COLOR'),'placas':T(c,'PLACAS'),'serie':T(c,'SERIE'),
  'infraccion':T(c,'INFRACCION '),'numeral':T(c,'NUMERAL'),'inventario':T(c,'INVENTARIO'),'agentes':T(c,'AGENTE(S)'),'unidad':T(c,'UNIDAD'),'grua_full':T(c,'GRÚA'),'observaciones':T(c,'OBSERVACIONES (FOLIO 911 Y HORA)'),'operador':T(c,'OPERADOR')})
D['mal']['txt']=enc_txt({'hm':[hm(v) for v in m['HORA']],'domicilio':T(m,'DOMICILIO'),'colonia_full':T(m,'COLONIA'),'unidades':T(m,'UNIDAD (ES)'),'agentes':T(m,'AGENTE(S)'),'razonamiento':T(m,'RAZONAMIENTO'),'operador':T(m,'OPERADOR EN TURNO')})
D['det']['txt']=enc_txt({'hm':[hm(v) for v in d['HORA REMISIÓN']],'nombre':T(d,'NOMBRE DEL CONDUCTOR'),'direccion':T(d,'DIRECCION DEL CONDUCTOR'),'ingreso':T(d,'TIPO DE INGRESO'),'edad_n':T(d,'EDAD'),'grado':T(d,'GRADO ETILICO'),
  'folio911':T(d,'FOLIO DE LLAMADA 911'),'remision':T(d,'N° DE REMISION'),'ubicacion':T(d,'UBICACIÓN DEL VEHICULO'),'marca_full':T(d,'MARCA'),'submarca':T(d,'SUB MARCA'),'anio':T(d,'AÑO'),'color':T(d,'COLOR'),'placas':T(d,'PLACAS'),
  'infraccion':T(d,'INFRACCION'),'numerales':T(d,'NUMERALES'),'inventario':T(d,'INVENTARIO'),'agentes':T(d,'AGENTE'),'unidad':T(d,'UNIDAD'),'grua_full':T(d,'GRUAS'),'serie':T(d,'SERIE'),'rnd':T(d,'REGISTRO NACIONAL DETENIDOS'),'operador':T(d,'OPERADOR EN TURNO')})
for k in ['eve','bit']:
    g=G[k]; assert len(g)==D[k]['n'],(k,len(g),D[k]['n'])
    D[k]['vals']['lat']=[p[0] if p else None for p in g]; D[k]['vals']['lng']=[p[1] if p else None for p in g]; D[k]['vals']['geoq']=[p[2] if p else 0 for p in g]
js=json.dumps(D,ensure_ascii=False,separators=(',',':'))
open(OUT,'w',encoding='utf-8').write(js)
print(len(js)/1e6,'MB; participantes',D['accp']['n'])
for k in D: print(k, len(json.dumps(D[k],ensure_ascii=False))/1e6)

print('Listo:', OUT)
