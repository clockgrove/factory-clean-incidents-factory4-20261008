import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {spawn, execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {dirname, resolve} from 'node:path';
import {makeServer} from '../app/server.mjs';

const data = JSON.parse(await readFile('.runtime/incidents.json','utf8'));
const keys = ['id','title','description','service','severity','status','openedAt','resolvedAt','team','region','tags'];
function expected(p) {
  const selected = data.filter(r=> ['service','status','severity'].every(k=>!p.getAll(k).length||p.getAll(k).includes(r[k])) && (!p.get('q') || [r.id,r.title,r.description].join('\u0000').toLowerCase().includes(p.get('q').toLowerCase())) && (!p.get('from') || r.openedAt.substring(0,10)>=p.get('from')) && (!p.get('to')||r.openedAt.substring(0,10)<=p.get('to')));
  const priority = {critical:4,high:3,medium:2,low:1};
  return selected.sort((a,b)=>{
    const compare = p.get('sort')==='severity' ? priority[a.severity]-priority[b.severity] : Date.parse(a.openedAt)-Date.parse(b.openedAt);
    return compare*(p.get('direction')==='asc'?1:-1) || (p.get('sort')==='severity'?Date.parse(b.openedAt)-Date.parse(a.openedAt):0) || (a.id<b.id?-1:a.id>b.id?1:0);
  });
}
function parseCSV(text) {
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if(c==='\r'&&!quoted&&text[i+1]==='\n'){row.push(cell);rows.push(row);row=[];cell='';i++;}else cell+=c;}
  assert.equal(quoted,false);assert.equal(cell,'');return rows;
}
test('real HTTP: independent matching, order, pagination, whole-result summaries, details and CSV',async()=>{
  const server=await makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const cases=['','q=ReTrY','q=INC-000001','service=Billing&service=Search&status=open&status=in_progress&severity=critical&severity=high&from=2026-04-10&to=2026-05-20','from=2026-04-01&to=2026-04-01','from=2026-06-29&to=2026-06-29','q=not-an-incident','page=9999','pageSize=50&page=3'];
    for(const sort of ['openedAt','severity'])for(const direction of ['asc','desc'])for(const item of cases){const p=new URLSearchParams(item);p.set('sort',sort);p.set('direction',direction);const rows=expected(p),response=await fetch(base+'/api/incidents?'+p);assert.equal(response.status,200);const body=await response.json(),size=Number(p.get('pageSize')||25),pages=Math.max(1,Math.ceil(rows.length/size)),page=Math.min(Number(p.get('page')||1),pages);
      assert.deepEqual(body.rows,rows.slice((page-1)*size,page*size));assert.equal(body.total,rows.length);assert.equal(body.pages,pages);assert.equal(body.page,page);assert.equal(body.pageSize,size);assert.equal(body.unresolved,rows.filter(r=>r.resolvedAt===null).length);assert.equal(body.highSeverity,rows.filter(r=>['critical','high'].includes(r.severity)).length);
      const daily={};for(const row of rows)daily[row.openedAt.slice(0,10)]=(daily[row.openedAt.slice(0,10)]||0)+1;assert.deepEqual(body.daily,Object.keys(daily).sort().map(date=>({date,count:daily[date]})));
      const csv=parseCSV(await (await fetch(base+'/api/export.csv?'+p)).text());assert.deepEqual(csv[0],keys);assert.deepEqual(csv.slice(1),rows.map(row=>keys.map(key=>key==='tags'?JSON.stringify(row.tags):String(row[key]??''))));
    }
    for(const p of ['page=0','page=1.5','pageSize=12','sort=title','direction=sideways','service=bad','status=bad','severity=bad','from=2026-02-30','from=2026-05-02&to=2026-05-01','q=a&q=b','unknown=x'])assert.equal((await fetch(base+'/api/incidents?'+p)).status,400,p);
    for(const row of [data[0],data[1],data[82]])assert.deepEqual(await (await fetch(base+'/api/incidents/'+row.id)).json(),row);
    assert.equal((await fetch(base+'/api/incidents/INC-999999')).status,404);
    assert.ok(data[0].description.includes('\n')&&data[0].description.includes('"')&&data[0].description.includes(','));
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});

async function start(port=0) {
  const child=spawn(process.execPath,['app/server.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let output='';const url=await new Promise((resolve,reject)=>{child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});child.once('error',reject);child.once('exit',code=>reject(Error(`Server exited ${code}: ${output}`)));});
  return {child,url,port:Number(new URL(url).port)};
}
async function stop(server) {if(server?.child.exitCode===null && server.child.signalCode===null){const closed=once(server.child,'exit');server.child.kill('SIGKILL');await closed;}}

test('sandboxed Chromium journeys and overlapping real network intent', {timeout:120000}, async()=>{
  const alias=execFileSync('bash',['-c','command -v qualification-chromium'],{encoding:'utf8'}).trim(),tool=dirname(alias);
  process.env.PLAYWRIGHT_BROWSERS_PATH=resolve(tool,'../browsers');
  const {chromium}=await import('playwright');await mkdir('.runtime/browser-tmp',{recursive:true});
  let server,browser;const evidence={journeys:[],sandbox:true};
  try {
    server=await start();const port=server.port,url=server.url;
    browser=await chromium.launch({channel:'chromium',headless:true,chromiumSandbox:true,env:{...process.env,LD_LIBRARY_PATH:resolve(tool,'../host-libs/usr/lib/x86_64-linux-gnu'),ALSA_CONFIG_PATH:resolve(tool,'../host-libs/usr/share/alsa/alsa.conf'),TMPDIR:'.runtime/browser-tmp',TMP:'.runtime/browser-tmp',TEMP:'.runtime/browser-tmp'}});
    const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const ready=async()=>{await page.locator('#loading').waitFor({state:'hidden'});await assert.doesNotReject(()=>page.locator('#rows tr').first().waitFor());};
    await page.goto(url);await ready();assert.equal(await page.locator('#total').innerText(),'2,400');assert.equal(await page.locator('#rows tr').count(),25);
    assert.equal(await page.locator('#q').inputValue(),'');await page.locator('#q').focus();await page.keyboard.type('ReTrY');await ready();
    assert.equal(Number((await page.locator('#total').innerText()).replaceAll(',','')),expected(new URLSearchParams('q=retry')).length);
    await page.getByLabel('Billing',{exact:true}).check();await page.getByLabel('Search',{exact:true}).check();await page.getByLabel('open',{exact:true}).check();await ready();
    await page.locator('#sort').selectOption('severity');await page.locator('#pageSize').selectOption('50');await ready();
    await page.getByLabel('critical',{exact:true}).check();await page.getByLabel('high',{exact:true}).check();await page.locator('#from').fill('2026-04-10');await page.locator('#to').fill('2026-06-20');await page.locator('#direction').selectOption('asc');await ready();
    await page.locator('#viewName').fill('Follow-up');await page.getByRole('button',{name:'Save view',exact:true}).click();await page.reload();await ready();await page.locator('#saved').selectOption('Follow-up');await page.getByRole('button',{name:'Restore view'}).click();await ready();assert.equal(await page.locator('#q').inputValue(),'ReTrY');assert.equal(await page.locator('#sort').inputValue(),'severity');assert.equal(await page.locator('#pageSize').inputValue(),'50');assert.equal(await page.getByLabel('Billing',{exact:true}).isChecked(),true);assert.equal(await page.getByLabel('Search',{exact:true}).isChecked(),true);assert.equal(await page.getByLabel('open',{exact:true}).isChecked(),true);assert.equal(await page.getByLabel('critical',{exact:true}).isChecked(),true);assert.equal(await page.getByLabel('high',{exact:true}).isChecked(),true);assert.equal(await page.locator('#from').inputValue(),'2026-04-10');assert.equal(await page.locator('#to').inputValue(),'2026-06-20');assert.equal(await page.locator('#direction').inputValue(),'asc');assert.match(await page.locator('#pageLabel').innerText(),/^Page 1/);
    await page.getByRole('button',{name:'Delete view'}).click();await page.reload();await ready();assert.equal(await page.locator('#saved option').count(),1);
    await page.locator('#from').fill('2026-04-01');await page.locator('#to').fill('2026-04-01');await ready();const dayRows=expected(new URLSearchParams('from=2026-04-01&to=2026-04-01'));assert.equal(Number(await page.locator('#total').innerText()),dayRows.length);
    await page.getByText('Daily counts — text alternative').click();assert.match(await page.locator('#daily').innerText(),/2026-04-01/);
    await page.getByRole('button',{name:'Clear all'}).click();await ready();
    await page.locator('#next').focus();await page.keyboard.press('Enter');await ready();const before=await page.locator('#rows').innerText();const opened=await page.locator('#rows button').first().innerText();await page.locator('#rows button').first().focus();const scrollPosition=await page.evaluate(()=>window.scrollY);await page.keyboard.press('Enter');await page.locator('#detailFields dd').first().waitFor();assert.equal(await page.locator('#detailFields dt').count(),11);assert.equal(await page.locator('#detailFields dd').first().innerText(),opened);await page.locator('#back').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#rows').innerText(),before);assert.equal(await page.evaluate(()=>window.scrollY),scrollPosition);assert.match(await page.locator('#pageLabel').innerText(),/^Page 2 /);
    await page.locator('#q').fill('INC-000001');await ready();await page.locator('#rows button').first().click();await page.locator('#detailFields dd').first().waitFor();assert.equal(await page.locator('#detailFields dd').nth(2).innerText(),data[0].description);assert.equal(await page.locator('#detailFields sample').count(),0);await page.locator('#back').click();
    const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise;await download.saveAs('.runtime/browser-export.csv');const csv=parseCSV(await readFile('.runtime/browser-export.csv','utf8'));assert.deepEqual(csv[1],keys.map(k=>k==='tags'?JSON.stringify(data[0][k]):String(data[0][k]??'')));
    await page.locator('#q').fill('nothing matches this');await page.locator('#empty').waitFor();assert.equal(await page.locator('#rows tr').count(),0);assert.equal(await page.locator('#next').isDisabled(),true);await page.locator('#clear').click();await ready();
    // Suspend the actual backend process. Requests remain real, pending HTTP work.
    server.child.kill('SIGSTOP');await page.locator('#q').fill('INC-000001');await page.locator('#loading').waitFor();await page.locator('#q').fill('INC-000002');server.child.kill('SIGCONT');await ready();assert.equal(await page.locator('#rows button').first().innerText(),'INC-000002');evidence.journeys.push('pending query superseded by newer query');
    await page.locator('#clear').click();await ready();
    server.child.kill('SIGSTOP');await page.locator('#rows button').first().click();const firstHeading=await page.locator('#detailHeading').innerText();await page.locator('#detailNext').click();const secondHeading=await page.locator('#detailHeading').innerText();assert.notEqual(firstHeading,secondHeading);server.child.kill('SIGCONT');await page.locator('#detailFields dd').first().waitFor();assert.equal('Incident '+await page.locator('#detailFields dd').first().innerText(),secondHeading);
    await page.locator('#back').click();const preserved=await page.locator('#rows').innerText();server.child.kill('SIGSTOP');await page.locator('#rows button').first().click();await page.locator('#back').click();server.child.kill('SIGCONT');await page.waitForLoadState('networkidle');assert.equal(await page.locator('#detail').isHidden(),true);assert.equal(await page.locator('#rows').innerText(),preserved);assert.equal(await page.locator('#loading').isHidden(),true);evidence.journeys.push('switch and close pending details; return preserves results');
    // Old query failure/cleanup must not steal a newer detail foreground.
    server.child.kill('SIGSTOP');await page.locator('#q').fill('retry');await page.locator('#rows button').first().click();await stop(server);await page.locator('#error').waitFor();assert.match(await page.locator('#errorText').innerText(),/incident/);assert.equal(await page.locator('#q').inputValue(),'retry');server=await start(port);await page.locator('#retry').click();await page.locator('#detailFields dd').first().waitFor();await page.locator('#back').click();await ready();assert.equal(Number((await page.locator('#total').innerText()).replaceAll(',','')),expected(new URLSearchParams('q=retry')).length);
    // A pending detail's failure after closing cannot reopen details or own Retry.
    server.child.kill('SIGSTOP');await page.locator('#rows button').first().click();await page.locator('#back').click();await page.locator('#q').fill('INC-000004');await stop(server);await page.locator('#error').waitFor();assert.equal(await page.locator('#detail').isHidden(),true);assert.match(await page.locator('#errorText').innerText(),/results/);server=await start(port);await page.locator('#retry').click();await ready();assert.equal(await page.locator('#rows button').first().innerText(),'INC-000004');evidence.journeys.push('closed detail late failure cannot reopen details or retarget current query Retry');
    // Genuine failure, selection change, and retry against restarted server.
    await stop(server);await page.locator('#q').fill('INC-000001');await page.locator('#error').waitFor();await page.locator('#q').fill('INC-000002');await page.locator('#error').waitFor();assert.equal(await page.locator('#q').inputValue(),'INC-000002');server=await start(port);await page.locator('#retry').click();await ready();assert.equal(await page.locator('#rows button').first().innerText(),'INC-000002');evidence.journeys.push('real stopped-server failures preserve selections; Retry owns latest query/detail');
    // Export failure is independent of a foreground query error and retry target.
    await stop(server);await page.locator('#q').fill('INC-000003');await page.locator('#error').waitFor();await page.locator('#export').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('export failed'));assert.match(await page.locator('#errorText').innerText(),/results/);server=await start(port);await page.locator('#retry').click();await ready();assert.equal(await page.locator('#rows button').first().innerText(),'INC-000003');
    await page.locator('#clear').click();await ready();server.child.kill('SIGSTOP');await page.locator('#next').click({clickCount:4});await page.locator('#next').focus();for(let i=0;i<5;i++)await page.keyboard.press('Enter');server.child.kill('SIGCONT');await ready();const number=Number((await page.locator('#pageLabel').innerText()).match(/Page (\d+)/)[1]);assert.ok(number>=2&&number<=10);assert.equal(await page.locator('#rows button').first().innerText(),expected(new URLSearchParams()).slice((number-1)*25)[0].id);
    await page.locator('#from').fill('2026-04-01');await page.locator('#to').fill('2026-04-02');await ready();
    const lastPage=Math.ceil(expected(new URLSearchParams('from=2026-04-01&to=2026-04-02')).length/25);assert.ok(lastPage>1);
    server.child.kill('SIGSTOP');await page.locator('#next').focus();for(let i=0;i<10;i++)await page.keyboard.press('Enter');server.child.kill('SIGCONT');await ready();assert.equal(await page.locator('#pageLabel').innerText(),`Page ${lastPage} of ${lastPage}`);assert.equal(await page.locator('#next').isDisabled(),true);
    server.child.kill('SIGSTOP');await page.locator('#previous').click({clickCount:10});server.child.kill('SIGCONT');await ready();assert.equal(await page.locator('#pageLabel').innerText(),`Page 1 of ${lastPage}`);assert.equal(await page.locator('#previous').isDisabled(),true);
    await page.locator('#clear').click();await ready();
    await page.locator('#q').fill('INC-000001');await ready();await page.locator('#next').click({force:true});assert.match(await page.locator('#pageLabel').innerText(),/^Page 1 of 1$/);evidence.journeys.push('repeated pointer and keyboard pagination uses current intent and bounds');
    await page.setViewportSize({width:375,height:812});await page.locator('#q').focus();assert.equal(await page.locator('#q').evaluate(el=>getComputedStyle(el).outlineStyle),'solid');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.locator('.table-scroll').focus();await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('.table-scroll').scrollLeft>0);await page.locator('#q').focus();await page.screenshot({path:'.runtime/explorer-narrow.png',fullPage:true});await page.setViewportSize({width:1280,height:900});await page.locator('#clear').click();await ready();await page.screenshot({path:'.runtime/explorer-desktop.png',fullPage:true});assert.deepEqual(errors,[]);
    evidence.journeys.push('search, compound filters, UTC dates, named views reload/delete, CSV, keyboard details, focus, narrow screen, loading and empty states');
  } finally {await browser?.close();await stop(server);evidence.browserClosed=true;evidence.serverClosed=true;await writeFile('.runtime/explorer-browser-evidence.json',JSON.stringify(evidence,null,2)+'\n');}
});
