import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const assets = {'/':'index.html','/client.js':'client.js','/style.css':'style.css'};
export const fields = ['id','title','description','service','severity','status','openedAt','resolvedAt','team','region','tags'];
const choices = {service:['Accounts','Billing','Search','Uploads','Notifications','Integrations'], status:['open','in_progress','resolved'], severity:['critical','high','medium','low']};
function parameters(p) {
  for (const key of p.keys()) if (!['q',...Object.keys(choices),'from','to','sort','direction','page','pageSize'].includes(key)) throw Error(`Unknown parameter: ${key}`);
  for (const key of ['q','from','to','sort','direction','page','pageSize']) if (p.getAll(key).length > 1) throw Error(`Repeated parameter: ${key}`);
  const result = {q:(p.get('q') || '').toLowerCase(),sort:p.get('sort') || 'openedAt',direction:p.get('direction') || 'desc',page:Number(p.get('page') || 1),pageSize:Number(p.get('pageSize') || 25)};
  if (!['openedAt','severity'].includes(result.sort) || !['asc','desc'].includes(result.direction)) throw Error('Invalid sort');
  if (!Number.isSafeInteger(result.page) || result.page < 1 || ![25,50].includes(result.pageSize)) throw Error('Invalid pagination');
  for (const [key,values] of Object.entries(choices)) {
    result[key] = p.getAll(key);
    if (result[key].some(value=>!values.includes(value))) throw Error(`Invalid ${key}`);
  }
  for (const key of ['from','to']) {
    result[key] = p.get(key) || '';
    if (result[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(result[key]) || !Number.isFinite(Date.parse(result[key])) || new Date(result[key]).toISOString().slice(0,10) !== result[key])) throw Error(`Invalid ${key} UTC date`);
  }
  if (result.from && result.to && result.from > result.to) throw Error('From date must precede to date');
  return result;
}
export function matching(data, query) {
  return data.filter(row=> (!query.q || [row.id,row.title,row.description].some(value=>value.toLowerCase().includes(query.q))) && Object.keys(choices).every(key=>!query[key].length || query[key].includes(row[key])) && (!query.from || row.openedAt.slice(0,10)>=query.from) && (!query.to || row.openedAt.slice(0,10)<=query.to)).sort((a,b)=>{
    const sign = query.direction === 'asc' ? 1 : -1;
    const first = query.sort === 'openedAt' ? a.openedAt.localeCompare(b.openedAt) : choices.severity.indexOf(b.severity)-choices.severity.indexOf(a.severity);
    return first*sign || (query.sort === 'severity' ? b.openedAt.localeCompare(a.openedAt) : 0) || a.id.localeCompare(b.id);
  });
}
export async function makeServer() {
  const data = JSON.parse(await readFile(new URL('../.runtime/incidents.json',import.meta.url),'utf8'));
  return createServer(async (request,response)=>{
    try {
      const url = new URL(request.url,'http://localhost');
      if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
      if (url.pathname === '/api/incidents' || url.pathname === '/api/export.csv') {
        const query = parameters(url.searchParams), rows = matching(data,query);
        if (url.pathname.endsWith('.csv')) {
          const cell = value=>'"'+String(value ?? '').replaceAll('"','""')+'"';
          const csv = [fields.join(','),...rows.map(row=>fields.map(key=>cell(key === 'tags' ? JSON.stringify(row[key]) : row[key])).join(','))].join('\r\n')+'\r\n';
          response.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="incidents.csv"'}); response.end(csv); return;
        }
        const pages = Math.max(1,Math.ceil(rows.length/query.pageSize)), page = Math.min(query.page,pages), days = new Map();
        for (const row of rows) { const day = row.openedAt.slice(0,10); days.set(day,(days.get(day)||0)+1); }
        const body = {rows:rows.slice((page-1)*query.pageSize,page*query.pageSize),page,pageSize:query.pageSize,pages,total:rows.length,unresolved:rows.filter(row=>row.status!=='resolved').length,highSeverity:rows.filter(row=>['critical','high'].includes(row.severity)).length,daily:[...days].sort(([a],[b])=>a.localeCompare(b)).map(([date,count])=>({date,count}))};
        response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}); response.end(JSON.stringify(body)); return;
      }
      if (url.pathname.startsWith('/api/incidents/')) {
        const row = data.find(row=>row.id===decodeURIComponent(url.pathname.slice('/api/incidents/'.length)));
        response.writeHead(row ? 200 : 404,{'Content-Type':'application/json'}); response.end(JSON.stringify(row || {error:'Incident not found'})); return;
      }
      if (assets[url.pathname]) {
        const body = await readFile(new URL(assets[url.pathname],import.meta.url));
        response.writeHead(200,{'Content-Type':url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html'}); response.end(body); return;
      }
      response.writeHead(404); response.end('Not found');
    } catch(error) { response.writeHead(400,{'Content-Type':'application/json'}); response.end(JSON.stringify({error:error.message})); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000), server = await makeServer();
  server.listen(port,'127.0.0.1',()=>console.log(`Incident explorer: http://127.0.0.1:${server.address().port}`));
  const shutdown = ()=>{server.close(()=>process.exit(0)); server.closeAllConnections();};
  process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);
}
