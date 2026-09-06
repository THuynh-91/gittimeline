// Dry-run by default. --upload writes only a validated immutable release to R2.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { collectRelease, sha256 } from './catalog-release.mjs';

const args=process.argv.slice(2);
const flag=(n,d)=>{const i=args.indexOf(`--${n}`);return i<0?d:args[i+1];};
const smokeRepo=flag('smoke-repo',null);
const server=await createServer({configFile:false,resolve:{alias:{'@':resolve('src')}},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom',logLevel:'error'});
let release;
try {const {ENGINE}=await server.ssrLoadModule('/src/model/types.ts'); release=collectRelease(flag('catalog','public/catalog'),flag('packages','public/catalog'),ENGINE,smokeRepo);} finally {await server.close();}
console.log(JSON.stringify({revision:release.revision,entries:release.entries,files:release.files.length,bytes:release.bytes}));
if(!args.includes('--upload')) {console.log('Validated only. Pass --upload to publish.');process.exit(0);}

const account=process.env.CLOUDFLARE_ACCOUNT_ID;
const bucket=process.env.R2_BUCKET || 'gitdance-catalog';
const publicBase=process.env.CATALOG_PUBLIC_BASE || 'https://gitdance-data.cruxpack.io';
if(!/^[a-f0-9]{32}$/.test(account??'')) throw new Error('Set CLOUDFLARE_ACCOUNT_ID.');
const {S3Client,HeadObjectCommand,PutObjectCommand}=await import('@aws-sdk/client-s3');
let accessKeyId=process.env.R2_ACCESS_KEY_ID, secretAccessKey=process.env.R2_SECRET_ACCESS_KEY;
// One-off setup can reuse the authorized token without saving derived credentials.
if(!accessKeyId && process.env.CLOUDFLARE_API_TOKEN) {
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/tokens/verify`,{headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`}});
  const result=await response.json();
  if(!response.ok||!result.success||!result.result?.id) throw new Error(`Token verification failed (${response.status}). Use bucket-scoped R2 access keys.`);
  accessKeyId=result.result.id;secretAccessKey=sha256(process.env.CLOUDFLARE_API_TOKEN);
}
if(!accessKeyId||!secretAccessKey) throw new Error('Set bucket-scoped R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.');
const s3=new S3Client({region:'auto',endpoint:`https://${account}.r2.cloudflarestorage.com`,credentials:{accessKeyId,secretAccessKey},maxAttempts:4});
// A release goes to one fixed place, so the app is told the address once.
//
// The revision used to be in the path, which made every rebuild a new URL and
// therefore a manual edit of `VITE_CATALOG_BASE` and a redeploy before anyone
// could see it. That is not a cadence, it is a weekly chore, and the weekly
// dataset build would have piled up releases nothing pointed at.
//
// Nothing about immutability is lost, because it never came from the path: the
// content objects are named by their own hash, so an unchanged file keeps its
// key, is refused as already-present below, and stays cached in every browser
// that has it. A rebuild uploads only what actually changed. Previews keep the
// revision in their path — they exist precisely to be one throwaway URL each.
const prefix=smokeRepo?`previews/${release.revision}/`:'catalog/';
const upload=async(name,data,hash,mutable=false)=>{
  const Key=prefix+name;
  // `.svg` was missing and fell through to `application/octet-stream`, which a
  // browser will not render as an image: the two vector marks on the shelf --
  // one of them on the featured Linux card -- came back 200 with a
  // `naturalWidth` of zero and drew as a broken-image glyph. No console error,
  // no failed request, nothing to see but the hole.
  const ContentType=name.endsWith('.json')?'application/json':name.endsWith('.png')?'image/png':name.endsWith('.jpg')?'image/jpeg':name.endsWith('.svg')?'image/svg+xml':'application/octet-stream';
  // The listing is the one object that has to change, and the only one that is
  // re-fetched. A minute of caching keeps a rebuild visible within a minute
  // while the 657 MB it points at stays cached for a year.
  if(mutable) {
    await s3.send(new PutObjectCommand({Bucket:bucket,Key,Body:data,ContentType,CacheControl:'public, max-age=60, must-revalidate',Metadata:{sha256:hash}}));
    return;
  }
  try {
    await s3.send(new PutObjectCommand({Bucket:bucket,Key,Body:data,ContentType,CacheControl:'public, max-age=31536000, immutable',Metadata:{sha256:hash},IfNoneMatch:'*'}));
  } catch(e) {
    if(e.$metadata?.httpStatusCode!==412)throw e;
    // Conditional creation makes retries safe without a HEAD before every
    // new object. An existing object must match exactly; it is never replaced.
    const old=await s3.send(new HeadObjectCommand({Bucket:bucket,Key}));
    if(old.Metadata?.sha256===hash && old.ContentLength===data.length) return;
    throw new Error(`Refusing to overwrite immutable object: ${name}`);
  }
};
try {
  let completed=0, reported=0;
  for(let i=0;i<release.files.length;i+=12) {
    await Promise.all(release.files.slice(i,i+12).map(async f=>{
      const data=readFileSync(f.path);if(sha256(data)!==f.hash)throw new Error(`File changed after validation: ${f.name}`);
      await upload(f.name,data,f.hash);completed++;
    }));
    if(completed-reported>=100||completed===release.files.length){console.log(`Uploaded/verified ${completed}/${release.files.length}`);reported=completed;}
  }
  // The listing is the last object, never a pointer to an incomplete upload.
  await upload('index.json',release.listing,sha256(release.listing),!smokeRepo);
  const url=`${publicBase.replace(/\/$/,'')}/${prefix}`;
  const response=await fetch(`${url}index.json`,{headers:{Origin:'https://thuynh-91.github.io'}});
  if(!response.ok||sha256(Buffer.from(await response.arrayBuffer()))!==sha256(release.listing)||response.headers.get('access-control-allow-origin')!=='https://thuynh-91.github.io')throw new Error('Public catalog verification failed. Do not deploy this release.');
  console.log(`VITE_CATALOG_BASE=${url}`);
  console.log('Upload verified. Point the app at this release only after browser playback tests pass.');
} finally {s3.destroy();}
