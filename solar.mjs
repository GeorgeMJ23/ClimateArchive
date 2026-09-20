/* NOAA/Meeus high-precision solar geometry for sunrise, sunset, solar noon,
   civil dawn and civil dusk. Longitudes are east-positive. */
const D=Math.PI/180, sin=x=>Math.sin(x*D), cos=x=>Math.cos(x*D), tan=x=>Math.tan(x*D);
export function solarParameters(jd){
 const t=(jd-2451545)/36525;
 const L=((280.46646+t*(36000.76983+.0003032*t))%360+360)%360;
 const M=357.52911+t*(35999.05029-.0001537*t);
 const e=.016708634-t*(.000042037+.0000001267*t);
 const C=sin(M)*(1.914602-t*(.004817+.000014*t))+sin(2*M)*(.019993-.000101*t)+sin(3*M)*.000289;
 const omega=125.04-1934.136*t, apparent=L+C-.00569-.00478*sin(omega);
 const obliq=23+(26+(21.448-t*(46.815+t*(.00059-t*.001813)))/60)/60+.00256*cos(omega);
 const declination=Math.asin(sin(obliq)*sin(apparent))/D;
 const y=tan(obliq/2)**2;
 const eqtime=4/D*(y*sin(2*L)-2*e*sin(M)+4*e*y*sin(M)*cos(2*L)-.5*y*y*sin(4*L)-1.25*e*e*sin(2*M));
 return {declination,eqtime};
}
function hourAngle(lat,dec,zenith){
 const q=cos(zenith)/(cos(lat)*cos(dec))-tan(lat)*tan(dec);
 return Math.abs(q)>1?NaN:Math.acos(q)/D;
}
// Exact two-pass structure used by VBA calcDawnUTC/calcDuskUTC:
// estimate sunrise/sunset first, then evaluate the selected twilight angle.
export function eventUTC(jd,lat,lon,zenith,rising){
 let p=solarParameters(jd), sign=rising?-1:1;
 let minutes=720-4*lon+sign*4*hourAngle(lat,p.declination,90.833)-p.eqtime;
 p=solarParameters(jd+minutes/1440);
 return 720-4*lon+sign*4*hourAngle(lat,p.declination,zenith)-p.eqtime;
}
export function offsetMinutes(date,zone='Europe/Athens'){
 if(zone==='UTC')return 0;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
 const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 return (Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-date.getTime())/60000;
}
export function solarDay(year,month,day,lat,lon,{zone='Europe/Athens'}={}){
 const base=Date.UTC(year,month-1,day), jd=base/86400000+2440587.5;
 const rise=eventUTC(jd,lat,lon,90.833,true),set=eventUTC(jd,lat,lon,90.833,false);
 const noon=720-4*lon-solarParameters(jd+.5-lon/360).eqtime;
 const dawn=eventUTC(jd,lat,lon,96,true),dusk=eventUTC(jd,lat,lon,96,false);
 function local(t){return t+offsetMinutes(new Date(base+t*60000),zone);}
 return {date:new Date(base).toISOString().slice(0,10),dawn:local(dawn),sunrise:local(rise),noon:local(noon),sunset:local(set),dusk:local(dusk),daylight:set-rise};
}
export function solarSeries(year,month,lat,lon,options){
 const out=[],first=month||1,last=month||12;
 for(let m=first;m<=last;m++)for(let d=1;d<=new Date(Date.UTC(year,m,0)).getUTCDate();d++)out.push(solarDay(year,m,d,lat,lon,options));
 return out;
}
export function timeLabel(minutes){
 if(!Number.isFinite(minutes))return '—';
 const v=((Math.round(minutes)%1440)+1440)%1440;
 return `${String(Math.floor(v/60)).padStart(2,'0')}:${String(v%60).padStart(2,'0')}`;
}
