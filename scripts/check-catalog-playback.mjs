// Test a local production build under the real Pages origin. Only app assets
// are served locally; catalog requests go to the real R2 host, with real CORS.
// Start vite preview on 127.0.0.1:4175 against the external-catalog build first.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const app='https://thuynh-91.github.io/gittimeline/';
const local=process.env.CATALOG_TEST_PREVIEW || 'http://127.0.0.1:4175';
const slug=process.argv[2] || 'rust-lang/mdBook';
const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:800}});
  const page=await context.newPage();
  const errors=[], requests=[], cacheStatus={};let transferred=0;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('request',r=>requests.push(r.url()));
  page.on('response',r=>{if(new URL(r.url()).hostname==='gitdance-data.cruxpack.io'){
    transferred+=Number(r.headers()['content-length']||0);
    const status=r.headers()['cf-cache-status']||'unknown';cacheStatus[status]=(cacheStatus[status]||0)+1;
  }});
  await context.route('https://api.github.com/**',route=>route.abort());
  await context.route('https://thuynh-91.github.io/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    assert.ok(path.startsWith('/gittimeline/'));
    const response=await context.request.get(`${local}/${path.slice('/gittimeline/'.length)}`);
    await route.fulfill({response});
  });
  await page.goto(app);
  await page.getByTestId('catalog-link').click();
  await page.getByTestId(`catalog-${slug.replace('/','-')}`).click();
  await page.getByTestId('scope-full').waitFor();
  const started=performance.now();
  await page.getByTestId('scope-full').click();
  await page.waitForFunction(s=>window.__gittimeline?.source?.slug===s&&window.__gittimeline.time>0,slug,{timeout:60000});
  const firstFrameMs=Math.round(performance.now()-started), startupBytes=transferred;
  const initial=await page.evaluate(()=>{const g=window.__gittimeline;g.pause();return {duration:g.duration,commits:g.stats.commits,planHash:g.planHash};});
  for(const fraction of [0.5,0.95,0.1]) {
    const t=initial.duration*fraction, before=performance.now();
    await page.evaluate(t=>window.__gittimeline.seek(t),t);
    await page.waitForFunction(t=>Math.abs(window.__gittimeline.time-t)<0.2,t,{timeout:60000});
    assert.equal(await page.evaluate(()=>window.__gittimeline.planHash),initial.planHash);
    console.log(JSON.stringify({seek:t,ms:Math.round(performance.now()-before)}));
  }
  await page.evaluate(()=>{window.__gittimeline.render.enabled=true;window.__gittimeline.play();});
  const t=await page.evaluate(()=>window.__gittimeline.time);
  await page.waitForFunction(t=>window.__gittimeline.time>t+0.5,t);
  await page.waitForFunction(()=>{const r=window.__gittimeline.render;return r.frames>3 && r.counts.nodesDrawn+r.counts.edgesDrawn>0;});
  assert.ok(!requests.some(u=>new URL(u).hostname==='api.github.com'),'Curated playback requested GitHub');
  assert.ok(!requests.some(u=>/\.(gittimeline|gtperf)\.gz(?:$|\?)/.test(u)),'Playback downloaded a monolithic file');
  assert.ok(requests.some(u=>u.includes('gitdance-data.cruxpack.io')&&u.endsWith('.bin')),'No streamed pages requested');
  assert.deepEqual(errors,[]);
  if(process.env.CATALOG_TEST_SCREENSHOT)await page.getByTestId('stage-canvas').screenshot({path:process.env.CATALOG_TEST_SCREENSHOT});
  console.log(JSON.stringify({slug,...initial,network:'unthrottled',firstFrameMs,startupBytes,requests:requests.length,cacheStatus,pass:true}));
} finally {await browser.close();}
