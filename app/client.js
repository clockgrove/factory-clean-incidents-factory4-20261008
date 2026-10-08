const $ = id=>document.getElementById(id);
const defaults = ()=>({q:'',service:[],status:[],severity:[],from:'',to:'',sort:'openedAt',direction:'desc',page:1,pageSize:25});
const choices = {service:['Accounts','Billing','Search','Uploads','Notifications','Integrations'],status:['open','in_progress','resolved'],severity:['critical','high','medium','low']};
let query = defaults(), revision = 0, detailRevision = 0, detailId = null, result = null, resultRevision = -1;
let bounds = null;
let foreground = null, retry = null, queryAbort, detailAbort, returnPosition = 0, returnFocus = null;
let views = {};
try { const stored = JSON.parse(localStorage.getItem('incident-views') || '{}'); if (stored && typeof stored==='object' && !Array.isArray(stored)) views = stored; } catch {}
function node(tag,text,className) {const element=document.createElement(tag); element.textContent=text; if(className)element.className=className; return element;}
function params(state=query) {const p=new URLSearchParams(); for(const [key,value] of Object.entries(state)) {if(Array.isArray(value))value.forEach(v=>p.append(key,v));else if(value !== '')p.set(key,value);}return p;}
function owns(owner) {return foreground===owner && (owner.kind==='query' ? owner.revision===revision && detailId===null : owner.revision===detailRevision && owner.id===detailId);}
function begin(owner) {foreground=owner;retry=null;$('error').hidden=true;$('loading').hidden=false;return owner;}
function failure(owner,error) {if(!owns(owner))return; retry=owner;$('errorText').textContent=`Unable to load ${owner.kind==='query'?'results':'incident'}. ${error.message}`;$('error').hidden=false;}
async function json(url,signal) {const response=await fetch(url,{signal});if(!response.ok){const body=await response.json();throw Error(body.error||`HTTP ${response.status}`);}return response.json();}
async function loadQuery() {
  queryAbort?.abort(); queryAbort=new AbortController();const current=revision,snapshot=structuredClone(query);
  const owner=begin({kind:'query',revision:current});
  try {const data=await json('/api/incidents?'+params(snapshot),queryAbort.signal);if(current!==revision)return;result=data;resultRevision=current;bounds=data.pages;query.page=data.page;if(detailId===null)renderResults();}
  catch(error){if(error.name!=='AbortError')failure(owner,error);}
  finally {if(owns(owner)){$('loading').hidden=true;foreground=null;}}
}
function supersedeDetail() {detailRevision++;detailAbort?.abort();detailId=null;$('detail').hidden=true;$('results').hidden=false;}
function changed() {bounds=null;revision++;pagination();supersedeDetail();renderControls();loadQuery();}
function renderControls() {
  for(const key of ['q','from','to','sort','direction','pageSize'])$(key).value=query[key];
  for(const key of Object.keys(choices))document.querySelectorAll(`input[name="${key}"]`).forEach(input=>input.checked=query[key].includes(input.value));
  const selections=[query.q&&`Search: ${query.q}`,...Object.keys(choices).flatMap(key=>query[key].map(v=>`${key}: ${v}`)),query.from&&`From ${query.from} UTC`,query.to&&`Through ${query.to} UTC`].filter(Boolean);
  $('active').textContent=selections.length?selections.join(' · '):'All services, statuses, severities and dates';
}
function renderResults() {
  if(!result)return;
  for(const key of ['total','unresolved','highSeverity'])$(key).textContent=result[key].toLocaleString();
  $('rows').replaceChildren();
  for(const row of result.rows){const tr=node('tr',''),first=node('td',''),button=node('button',row.id);button.onclick=()=>openDetail(row.id,button);first.append(button,node('small',row.title));tr.append(first,node('td',row.service));const severity=node('td','');severity.append(node('span',row.severity,'badge '+row.severity));tr.append(severity,node('td',row.status.replaceAll('_',' ')),node('td',row.openedAt.replace('T',' ').slice(0,16)));$('rows').append(tr);}
  $('empty').hidden=result.total!==0;
  $('pageInfo').textContent=`${result.total} incidents · ${result.pageSize} per page`;
  pagination();$('bars').replaceChildren();$('daily').replaceChildren();
  const maximum=Math.max(1,...result.daily.map(day=>day.count));
  for(const day of result.daily){const bar=node('div','');bar.style.height=`${day.count/maximum*100}%`;bar.title=`${day.date}: ${day.count}`;$('bars').append(bar);$('daily').append(node('li',`${day.date}: ${day.count} incidents`));}
  $('chartRange').textContent=result.daily.length?`${result.daily[0].date} — ${result.daily.at(-1).date} · UTC`:'No matching dates';
  if(!result.daily.length)$('daily').append(node('li','No incidents in this selection.'));
}
function pagination() {const pages=bounds||1;$('pageLabel').textContent=`Page ${query.page} of ${pages}`;$('previous').disabled=query.page<=1;$('next').disabled=query.page>=pages;}
function movePage(delta) {if(!result || !bounds || detailId!==null)return;const pages=bounds,page=Math.max(1,Math.min(pages,query.page+delta));if(page===query.page)return;query.page=page;revision++;pagination();loadQuery();}
async function openDetail(id,button) {
  if(detailId===null){returnPosition=window.scrollY;returnFocus=button;}
  detailRevision++;detailAbort?.abort();detailAbort=new AbortController();detailId=id;
  $('results').hidden=true;$('detail').hidden=false;$('detailFields').replaceChildren();$('detailHeading').textContent=`Incident ${id}`;$('detailHeading').focus();const index=result?.rows.findIndex(row=>row.id===id);$('detailPrevious').disabled=!(index>0);$('detailNext').disabled=!(index>=0 && index<result.rows.length-1);
  const owner=begin({kind:'detail',id,revision:detailRevision});
  try {const row=await json('/api/incidents/'+encodeURIComponent(id),detailAbort.signal);if(!owns(owner))return;for(const [key,value] of Object.entries(row))$('detailFields').append(node('dt',key),node('dd',Array.isArray(value)?value.join(', '):value??'Not resolved'));}
  catch(error){if(error.name!=='AbortError')failure(owner,error);}
  finally {if(owns(owner)){$('loading').hidden=true;foreground=null;}}
}
function back() {supersedeDetail();foreground=null;retry=null;$('loading').hidden=true;$('error').hidden=true;renderResults();window.scrollTo(0,returnPosition);returnFocus?.focus({preventScroll:true});if(resultRevision!==revision)loadQuery();}
for(const [key,values] of Object.entries(choices)){const fieldset=node('fieldset','');fieldset.append(node('legend',key[0].toUpperCase()+key.slice(1)));for(const value of values){const label=node('label',''),input=document.createElement('input');input.type='checkbox';input.name=key;input.value=value;input.onchange=()=>{query[key]=[...document.querySelectorAll(`input[name="${key}"]:checked`)].map(i=>i.value);query.page=1;changed();};label.append(input,document.createTextNode(value.replaceAll('_',' ')));fieldset.append(label);}$('filters').append(fieldset);}
for(const key of ['q','from','to','sort','direction','pageSize'])$(key).addEventListener(key==='q'?'input':'change',()=>{query[key]=key==='pageSize'?Number($(key).value):$(key).value;query.page=1;changed();});
$('clear').onclick=()=>{query=defaults();changed();};$('previous').onclick=()=>movePage(-1);$('next').onclick=()=>movePage(1);$('back').onclick=back;
for(const [id,delta] of [['detailPrevious',-1],['detailNext',1]])$(id).onclick=()=>{const index=result?.rows.findIndex(row=>row.id===detailId),row=result?.rows[index+delta];if(row)openDetail(row.id,returnFocus);};
$('retry').onclick=()=>{const target=retry;if(!target)return;if(target.kind==='query'&&target.revision===revision&&detailId===null)loadQuery();else if(target.kind==='detail'&&target.revision===detailRevision&&target.id===detailId)openDetail(detailId,returnFocus);};
function renderViews() {$('saved').replaceChildren(node('option','Choose a view'));$('saved').firstChild.value='';for(const name of Object.keys(views).sort()){const option=node('option',name);option.value=name;$('saved').append(option);}}
function persist() {try{localStorage.setItem('incident-views',JSON.stringify(views));renderViews();return true;}catch{$('notice').textContent='Browser storage is unavailable. View was not saved.';return false;}}
$('save').onclick=()=>{const name=$('viewName').value.trim();if(!name){$('notice').textContent='Enter a view name.';return;}Object.defineProperty(views,name,{value:structuredClone(query),writable:true,enumerable:true,configurable:true});if(persist()){$('saved').value=name;$('notice').textContent=`Saved “${name}” in this browser.`;}};
$('restore').onclick=()=>{const name=$('saved').value;if(!Object.hasOwn(views,name))return;const stored=views[name];query=defaults();for(const key of Object.keys(query)){if(key==='page')continue;if(Array.isArray(query[key]))query[key]=Array.isArray(stored[key])?stored[key].filter(v=>choices[key].includes(v)):[];else if(typeof stored[key]===typeof query[key])query[key]=stored[key];}query.page=1;changed();};
$('delete').onclick=()=>{const name=$('saved').value;if(Object.hasOwn(views,name)){delete views[name];if(persist())$('notice').textContent=`Deleted “${name}”.`;}};
let exportRevision=0;
$('export').onclick=async()=>{const ticket=++exportRevision,snapshot=structuredClone(query);$('notice').textContent='Preparing CSV…';try{const response=await fetch('/api/export.csv?'+params(snapshot));if(!response.ok)throw Error('Export request failed');const blob=await response.blob();if(ticket!==exportRevision)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='incidents.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('notice').textContent='CSV exported for the selection at export time.';}catch{if(ticket===exportRevision)$('notice').textContent='CSV export failed. Try Export CSV again.';}};
renderViews();renderControls();loadQuery();
