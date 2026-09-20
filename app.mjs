import {solarSeries,timeLabel} from './solar.mjs';
const $=id=>document.getElementById(id), months=['Whole year','January','February','March','April','May','June','July','August','September','October','November','December'];
const colours=['#142dff','#06c6e5','#78e94d','#fff000','#ff970b','#a30800'];
const bins=['3.2–<8.0','8.0–<11.3','11.3–<16.1','16.1–<24.1','24.1–<32.2','≥32.2'];
let manifest, boundary, windIndex, map, marker, selected, requestVersion=0;
const cache=new Map();
async function get(url,type='json'){
 if(!cache.has(url))cache.set(url,fetch(url).then(r=>{if(!r.ok)throw Error(`${url}: HTTP ${r.status}`);return type==='json'?r.json():r.arrayBuffer()}).catch(e=>{cache.delete(url);throw e}));
 return cache.get(url);
}
function insideRing(x,y,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
 const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)yes=!yes;
}return yes;}
function inGreece(lat,lon){const g=boundary.geometry,polys=g.type==='MultiPolygon'?g.coordinates:[g.coordinates];return polys.some(p=>insideRing(lon,lat,p[0])&&!p.slice(1).some(h=>insideRing(lon,lat,h)));}
export function sampleGrid(buffer,grid,scale,lat,lon){
 const {west,south,step,nx,ny,nodata}=grid,x=(lon-west)/step,y=(lat-south)/step;
 if(x<0||y<0||x>nx-1||y>ny-1)return null;
 if(buffer.byteLength!==nx*ny*2)throw Error('Climate grid has the wrong file size');
 const a=new DataView(buffer),ix=Math.min(nx-2,Math.floor(x)),iy=Math.min(ny-2,Math.floor(y)),fx=x-ix,fy=y-iy;
 let val=0,sum=0;
 for(const [dx,dy,w]of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){
  const v=a.getInt16(((iy+dy)*nx+ix+dx)*2,true);if(v!==nodata&&w>1e-12){val+=v*w;sum+=w;}
 }return sum>0?val/sum*scale:null;
}
function distance(a,b){const r=Math.PI/180,dl=(a.latitude-b.latitude)*r,dn=(a.longitude-b.longitude)*r;
 return 12742*Math.asin(Math.min(1,Math.sqrt(Math.sin(dl/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin(dn/2)**2)));}
function pointOnCircle(cx,cy,r,angle){const a=angle*Math.PI/180;return [cx+r*Math.sin(a),cy-r*Math.cos(a)];}
function sector(r0,r1,angle){const p1=pointOnCircle(200,196,r0,angle-4),p2=pointOnCircle(200,196,r1,angle-4),p3=pointOnCircle(200,196,r1,angle+4),p4=pointOnCircle(200,196,r0,angle+4);
 return `M${p1}L${p2}A${r1},${r1} 0 0 1 ${p3}L${p4}A${r0},${r0} 0 0 0 ${p1}Z`;}
function rose(h,max){
 if(!h||!h.valid)return '<div class="empty">No valid wind observations<br>for this reference period.</div>';
 const inner=31,span=130,outer=inner+span,calm=100*h.calm/h.valid;
 let svg='<svg viewBox="0 0 400 390" role="img" aria-label="Wind rose; wind comes from the indicated direction"><rect width="400" height="390" fill="white"/>';
 for(let i=1;i<=4;i++){let r=inner+span*i/4;svg+=`<circle cx="200" cy="196" r="${r}" fill="none" stroke="#a5b3be" stroke-width=".8"/>`;}
 for(let i=0;i<8;i++){let angle=i*45,[x,y]=pointOnCircle(200,196,outer,angle);svg+=`<path d="M200,196L${x},${y}" stroke="#d6dee4" stroke-width=".6"/>`;}
 h.counts.forEach((row,d)=>{let stacked=0;row.forEach((count,k)=>{const f=count/h.valid*100;if(f>0){const r0=inner+stacked/max*span,r1=inner+(stacked+f)/max*span;
 svg+=`<path d="${sector(r0,r1,d*10)}" fill="${colours[k]}"><title>From ${d*10}° · ${bins[k]} km/h: ${f.toFixed(3)}% (${count.toLocaleString()} hours)</title></path>`;}stacked+=f;});});
 for(let i=1;i<=4;i++){const [x,y]=pointOnCircle(200,196,inner+span*i/4,25);svg+=`<text x="${x+3}" y="${y-2}" font-size="11" fill="#384e60" stroke="white" stroke-width="3" paint-order="stroke">${(max*i/4).toFixed(1)}%</text>`;}
 for(let i=0;i<8;i++){let [x,y]=pointOnCircle(200,196,outer+22,i*45);svg+=`<text x="${x}" y="${y+4}" text-anchor="middle" font-size="13" fill="#233e53">${['N','NE','E','SE','S','SW','W','NW'][i]}</text>`;}
 // Arrowheads point inward to show the meteorological FROM convention.
 for(let angle of [0,90,180,270]){const a=pointOnCircle(200,196,outer-7,angle),b=pointOnCircle(200,196,outer+8,angle-1.5),c=pointOnCircle(200,196,outer+8,angle+1.5);svg+=`<path d="M${a}L${b}L${c}Z" fill="white" stroke="#667985" stroke-width="1"/>`;}
 svg+=`<circle cx="200" cy="196" r="${inner}" fill="white" stroke="#617584"/><text x="200" y="193" text-anchor="middle" font-size="12">Calm</text><text x="200" y="208" text-anchor="middle" font-size="12">${calm.toFixed(1)}%</text></svg>`;return svg;
}
function windEmpty(message){for(const key of ['old','new']){$('rose-'+key).innerHTML='<div class="empty"></div>';$('rose-'+key).firstChild.textContent=message;$('wind-'+key).textContent='';}$('wind-location').textContent='';}
async function drawWind(p,month,version){
 if(!manifest.wind){windEmpty('Wind climatology has not been added yet.');return;}
 try{
  windIndex ||= await get('data/wind/index.json');
  const candidates=windIndex.points.map(q=>({...q,distance:distance(p,q)})).sort((a,b)=>a.distance-b.distance),q=candidates[0];
  if(version!==requestVersion)return;
  if(!q){windEmpty('No ERA5 wind point is available.');return;}
  const data=await get(`data/wind/${String(q.id).padStart(3,'0')}.json`);if(version!==requestVersion)return;
  const a=data.periods['1961-1990'][month],b=data.periods['2010-2025'][month];
  let max=Math.max(1,...[a,b].flatMap(h=>h.valid?h.counts.map(r=>r.reduce((s,v)=>s+v,0)/h.valid*100):[0]));max=Math.ceil(max/2)*2;
  const far=windIndex.recommended_max_distance_km&&q.distance>windIndex.recommended_max_distance_km
   ?' This is farther than the recommended '+windIndex.recommended_max_distance_km+' km; interpret it as the nearest regional estimate.' :'';
  $('wind-location').textContent=`Nearest available ERA5 point: ${q.latitude.toFixed(3)}° N, ${q.longitude.toFixed(3)}° E · ${q.distance.toFixed(1)} km from your selection. Months use UTC.${far}`;
  for(const [key,h]of [['old',a],['new',b]]){
   $('rose-'+key).innerHTML=rose(h,max);
   $('wind-'+key).textContent=`${h.valid.toLocaleString()} valid hours · ${(h.coverage*100).toFixed(1)}% coverage · Mean ${h.mean_mps===null?'—':(h.mean_mps*3.6).toFixed(1)+' km/h'} · ${h.missing.toLocaleString()} missing values + ${h.absent_timestamps.toLocaleString()} absent hours`;
  }
 }catch(e){if(version===requestVersion)windEmpty('Wind data could not be loaded. '+e.message);}
}
function drawSolar(){
 if(!selected)return;
 const year=+$('year').value,month=+$('month').value;
 const rows=solarSeries(year,month,selected.latitude,selected.longitude,{zone:$('clock').value});
 $('solar-year-label').textContent=`${months[month]} · ${year}`;
 const W=800,H=310,L=58,T=16,R=16,B=38,ph=H-T-B,pw=W-L-R;
 const x=i=>L+i/(rows.length-1)*pw;
 let y,s;
 if(month){
  const finite=a=>a.filter(Number.isFinite), dawns=finite(rows.map(r=>r.dawn)), rises=finite(rows.map(r=>r.sunrise)), sets=finite(rows.map(r=>r.sunset)), dusks=finite(rows.map(r=>r.dusk));
  const earlyMin=Math.max(0,Math.floor((Math.min(...dawns,...rises)-30)/60)*60);
  const earlyMax=Math.min(720,Math.ceil((Math.max(...rises)+60)/60)*60);
  const lateMin=Math.max(720,Math.ceil((Math.min(...sets)-60)/60)*60);
  const lateMax=Math.min(1440,Math.ceil((Math.max(...sets,...dusks)+30)/60)*60);
  const gap=28,half=(ph-gap)/2,split=T+half;
  y=v=>v<=earlyMax ? split+gap+(earlyMax-v)/(earlyMax-earlyMin)*half : T+(lateMax-v)/(lateMax-lateMin)*half;
  s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily civil dawn, sunrise, sunset and civil dusk; middle daytime hours are omitted"><rect x="${L}" y="${T}" width="${pw}" height="${half}" fill="#f3f7fa"/><rect x="${L}" y="${split+gap}" width="${pw}" height="${half}" fill="#f3f7fa"/>`;
  for(const [a,b]of [[lateMin,lateMax],[earlyMin,earlyMax]])for(let v=Math.ceil(a/60)*60;v<=b;v+=60)s+=`<line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" stroke="#d7e1e7"/><text x="${L-9}" y="${y(v)+4}" text-anchor="end" font-size="12" fill="#657888">${timeLabel(v)}</text>`;
  const gy=split+gap/2;
  s+=`<rect x="${L}" y="${split}" width="${pw}" height="${gap}" fill="white"/><path d="M${L-6},${gy-5}l6,5 6,-5m-12,10l6,5 6,-5M${W-R-6},${gy-5}l6,5 6,-5m-12,10l6,5 6,-5" fill="none" stroke="#8799a6" stroke-width="1.4"/><text x="${L+18}" y="${gy+4}" font-size="11" fill="#718593">Daytime hours omitted (${timeLabel(earlyMax)}–${timeLabel(lateMin)})</text>`;
  $('solar-axis-note').hidden=false;
  $('solar-axis-note').textContent=`Monthly view uses a broken time axis: ${timeLabel(earlyMax)}–${timeLabel(lateMin)} is omitted so daily changes are visible.`;
 }else{
  y=v=>T+(1440-v)/1440*ph;
  s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily civil dawn, sunrise, sunset and civil dusk"><rect x="${L}" y="${T}" width="${pw}" height="${ph}" fill="#f3f7fa"/>`;
  const band=rows.map((r,i)=>`${x(i)},${y(r.sunrise)}`).join(' ')+' '+rows.map((r,i)=>`${x(i)},${y(r.sunset)}`).reverse().join(' ');
  s+=`<polygon points="${band}" fill="#fff0cc" opacity=".75"/>`;
  for(let v=0;v<=1440;v+=240)s+=`<line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" stroke="#d7e1e7"/><text x="${L-9}" y="${y(v)+4}" text-anchor="end" font-size="12" fill="#657888">${v===1440?'24:00':timeLabel(v)}</text>`;
  $('solar-axis-note').hidden=true;
 }
 const lines=[['dawn','#7994aa'],['sunrise','#dd941a'],['sunset','#c56735'],['dusk','#354c73']];
 for(const [key,col]of lines)s+=`<polyline points="${rows.map((r,i)=>`${x(i)},${y(r[key])}`).join(' ')}" fill="none" stroke="${col}" stroke-width="2.4"/>`;
 let ticks=month?[0,Math.round((rows.length-1)/4),Math.round((rows.length-1)/2),Math.round((rows.length-1)*3/4),rows.length-1]:rows.map((r,i)=>r.date.endsWith('-01')?i:-1).filter(i=>i>=0);
 for(const i of ticks){let label=month?String(i+1):months[+rows[i].date.slice(5,7)].slice(0,3);s+=`<text x="${x(i)}" y="${H-12}" text-anchor="middle" font-size="12" fill="#657888">${label}</text>`;}
 s+=`<line id="solar-cursor" x1="${L}" x2="${L}" y1="${T}" y2="${T+ph}" stroke="#456275" stroke-dasharray="3 4"/><rect id="solar-hit" x="${L}" y="${T}" width="${pw}" height="${ph}" fill="transparent"/></svg>`;
 $('solar-chart').innerHTML=s;
 function show(i){const r=rows[i];$('solar-readout').textContent=`${r.date} · Dawn ${timeLabel(r.dawn)} · Sunrise ${timeLabel(r.sunrise)} · Noon ${timeLabel(r.noon)} · Sunset ${timeLabel(r.sunset)} · Dusk ${timeLabel(r.dusk)} · Daylight ${Math.floor(Math.round(r.daylight)/60)}h ${Math.round(r.daylight)%60}m`;
 $('solar-cursor').setAttribute('x1',x(i));$('solar-cursor').setAttribute('x2',x(i));}
 $('solar-hit').addEventListener('pointermove',e=>{const svg=$('solar-chart').querySelector('svg'),rect=svg.getBoundingClientRect();show(Math.max(0,Math.min(rows.length-1,Math.round(((e.clientX-rect.left)*W/rect.width-L)/pw*(rows.length-1)))));});
 show(0);
 $('solar-table').innerHTML=rows.map(r=>`<tr><td>${r.date}</td>${['dawn','sunrise','noon','sunset','dusk'].map(k=>`<td>${timeLabel(r[k])}</td>`).join('')}<td>${Math.floor(Math.round(r.daylight)/60)}h ${Math.round(r.daylight)%60}m</td></tr>`).join('');
}
async function selectPoint(lat,lon,focus=false){
 if(!manifest||!boundary){$('status').textContent='The atlas is still loading.';return;}
 if(!inGreece(lat,lon)){$('status').textContent='Choose a land location inside Greece. The coastline is approximate.';return;}
 selected={latitude:lat,longitude:lon};$('lat').value=lat.toFixed(5);$('lon').value=lon.toFixed(5);
 if(marker)marker.setLatLng([lat,lon]);else marker=L.circleMarker([lat,lon],{radius:7,color:'#123a50',weight:3,fillColor:'#fff',fillOpacity:1}).addTo(map);
 $('panel').hidden=false;$('status').textContent='Select another point to compare locations.';
 if(window.innerWidth>760){
  const pt=map.latLngToContainerPoint([lat,lon]);
  const targetX=$('panel').getBoundingClientRect().left/2;
  const targetY=Math.max(470,map.getSize().y*.65);
  map.panBy([pt.x-targetX,pt.y-Math.min(targetY,map.getSize().y-60)],{animate:false});
 }
 const month=+$('month').value,version=++requestVersion;
 $('period-title').textContent=months[month].toUpperCase();$('location-title').textContent=`${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E`;
 if(focus)$('location-title').focus();
 $('rain-title').textContent=month?'Monthly precipitation':'Annual precipitation';
 for(const key of ['tmodern','told','precip'])$(key).textContent='…';
 $('climate-note').textContent='';$('availability').hidden=true;
 drawSolar();windEmpty('Loading wind statistics…');const windTask=drawWind(selected,month,version);
 const missing=[];let errors=[];
 await Promise.all(['tmodern','told','precip'].map(async key=>{
  try{const f=manifest.fields[key];if(!f){missing.push(key);if(version===requestVersion)$(key).textContent='Unavailable';return;}
   const buffer=await get('data/'+f.pattern.replace('{period}',month),'binary');
   const v=sampleGrid(buffer,manifest.grid,f.scale,lat,lon);
   if(version!==requestVersion)return;
   $(key).textContent=v===null?'No coverage':`${v.toFixed(1)} ${key==='precip'?'mm':'°C'}`;
  }catch(e){errors.push(e.message);if(version===requestVersion)$(key).textContent='Load error';}
 }));
 if(version!==requestVersion)return;
 const labels={tmodern:'modern temperature',told:'historical temperature',precip:'precipitation'};
 if(missing.length||!manifest.wind||errors.length){$('availability').hidden=false;$('availability').textContent=(missing.length||!manifest.wind?'Not yet included in this dataset: '+[...missing.map(k=>labels[k]),...(!manifest.wind?['wind climatology']:[])].join(', ')+'. ':'')+errors.join('; ');}
 $('climate-note').textContent=`Grid: ${manifest.grid?.step.toFixed(3)||'—'}°. Values are spatial estimates. The 1961–1990 temperature is reconstructed, not a measured historical normal.`;
 await windTask;
}
async function init(){
 for(let y=1901;y<=2099;y++)$('year').add(new Option(y,y,y===2026,y===2026));
 $('wind-legend').innerHTML=bins.map((b,i)=>`<span style="--swatch:${colours[i]}">${b} km/h</span>`).join('');
 if(typeof L==='undefined')throw Error('The map library could not be loaded. Check vendor/leaflet.js.');
 map=L.map('map',{zoomControl:true,minZoom:5,maxZoom:18}).setView([38.5,24.0],6);
 const tiles=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
 let tileWarning=false;tiles.on('tileerror',()=>{if(!tileWarning){tileWarning=true;$('status').textContent='Background map tiles unavailable; use the country outline or coordinates.';}});
 map.on('click',e=>selectPoint(e.latlng.lat,e.latlng.lng));
 $('coordinates').addEventListener('submit',e=>{e.preventDefault();selectPoint(+$('lat').value,+$('lon').value,true);});
 $('month').addEventListener('change',()=>{if(selected)selectPoint(selected.latitude,selected.longitude);});
 for(const id of ['year','clock'])$(id).addEventListener('change',drawSolar);
 function close(){$('panel').hidden=true;$('lat').focus();}
 $('close').addEventListener('click',close);document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
 [manifest,boundary]=await Promise.all([get('data/manifest.json'),get('data/greece.geojson')]);
 L.geoJSON(boundary,{style:{color:'#367c95',weight:1,fillColor:'#379ab1',fillOpacity:.13},interactive:false}).addTo(map);
 $('status').textContent='Ready · click Greek land or enter coordinates.';
}
init().catch(e=>{$('status').textContent='Unable to load the atlas: '+e.message+'. Open through a local HTTP server or GitHub Pages.';console.error(e);});
