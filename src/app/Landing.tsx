import { useRef } from 'preact/hooks';
import { store } from './store';
import { loadDemo, loadRepo, loadCatalogEntry } from './controller';
import { parseRepoUrl } from '@/github/url';
import { SiteBar } from './SiteBar';
import { SiteFoot } from './SiteFoot';
import { useCatalogEntries } from './Catalog';

export function Landing() {
  const entries=useCatalogEntries();
  const input=useRef<HTMLInputElement>(null);
  const featured=['torvalds/linux','rust-lang/rust','facebook/react'].flatMap(slug=>entries?.find(e=>e.slug===slug)??[]);
  const typed=store.input.value.trim();
  const parsedRepo=typed?parseRepoUrl(store.input.value):null;
  const hintTarget=parsedRepo&&parsedRepo.ok?parsedRepo.repo.slug:null;
  const submit=(e:Event)=>{e.preventDefault();if(store.input.value.trim())void loadRepo(store.input.value,{autoplay:true});else void loadDemo({autoplay:true,landing:false});};
  return <section class="landing new-landing" aria-labelledby="landing-title">
    <SiteBar page="landing" />
    <div class="welcome-copy">
      <p class="eyebrow">SOFTWARE HAS A STORY</p>
      <h1 id="landing-title">A million commits.<br/><em>One living history.</em></h1>
      <p class="welcome-description">Watch the work branch out, come together, and become something bigger. Real Git history, set in motion.</p>
      <div class="welcome-actions">
        <button class="btn primary" type="button" onClick={()=>store.mode.value='catalog'} data-testid="catalog-cta">Explore the selection <span aria-hidden="true">↗</span></button>
        <button class="btn demo-action" type="button" onClick={()=>void loadDemo({autoplay:true,landing:false})}>Play demo <span aria-hidden="true">▷</span></button>
      </div>
      <form class="repo-entry" onSubmit={submit}>
        <label for="welcome-repo">Or bring a public GitHub repository</label>
        <div class="url-row">
          <input ref={input} id="welcome-repo" type="text" inputMode="url" autoComplete="off" spellcheck={false} placeholder="github.com/owner/repository" aria-label="Public GitHub repository URL" aria-invalid={!!store.inputError.value} aria-describedby="url-hint" data-testid="url-input" value={store.input.value} onInput={e=>{const v=e.currentTarget.value;store.input.value=v;const p=v.trim()?parseRepoUrl(v):null;store.inputError.value=p&&!p.ok?p.hint:null;}} onKeyDown={e=>{if(e.key==='Escape'){store.input.value='';store.inputError.value=null;}}} onPaste={e=>{const value=e.clipboardData?.getData('text')??'';const p=parseRepoUrl(value);if(p.ok&&(!input.current?.value||input.current.selectionStart===0&&input.current.selectionEnd===input.current.value.length)){e.preventDefault();store.input.value=p.repo.slug;}}}/>
          <button type="submit" class="play-btn" data-testid="play-button">{store.input.value.trim()?'Watch':'Play demo'}</button>
        </div>
        {/* The hint reads back what was understood.

            It briefly became one fixed sentence, which meant the field gave no
            sign whether what you had typed was a repository until you pressed
            the button — and the error for a non-GitHub URL had nowhere to
            appear at all. `aria-live` is what makes that reach a screen reader,
            since the text changes without anything gaining focus. */}
        <p id="url-hint" class={`form-hint${store.inputError.value?'':' ok'}`} aria-live="polite">
          {store.inputError.value
            ? store.inputError.value
            : hintTarget
              ? `Reads ${hintTarget} from GitHub, renders on your device.`
              : 'Rendered on your device. No account needed for the selection.'}
        </p>
      </form>
    </div>
    <div class="welcome-stage-note" aria-hidden="true"><span class="live-dot"/> A generated history, unfolding</div>
    <section class="welcome-selection" aria-label="Featured histories">
      <div class="selection-heading"><span class="eyebrow">READY TO WATCH</span><button type="button" onClick={()=>store.mode.value='catalog'}>All histories →</button></div>
      <div class="featured-histories">{featured.map(e=><button type="button" key={e.slug} class="featured-history" onClick={()=>void loadCatalogEntry(e.file,e.title)}>
        {e.logo&&<img src={`${import.meta.env.BASE_URL}catalog/${e.logo}`} alt=""/>}<span><strong>{e.title}</strong><small>{e.commits?.toLocaleString('en-US')} commits · real history</small></span><span class="featured-play" aria-hidden="true">↗</span>
      </button>)}</div>
      {!entries&&<p class="selection-empty">The demo is ready now. Curated histories appear here when the catalog is available.</p>}
    </section>
    {/* The ask is pinned bottom-right on every page. The redesign dropped it
        here and kept it on the other two, which is the one place it is least
        likely to be found on purpose and most likely to look deliberate. */}
    <SiteFoot />
  </section>;
}
