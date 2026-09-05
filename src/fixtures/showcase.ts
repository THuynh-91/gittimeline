import { PEOPLE, Script } from './synthetic';
import type { Dataset } from '@/model/types';

/** The product demo. The original scripted fixture remains in demo.ts. */
export function buildShowcaseDataset():Dataset {
  const s=new Script('A generated history','2022-01-03T09:00:00Z','main');
  const cast=[PEOPLE.mara,PEOPLE.devi,PEOPLE.kofi,PEOPLE.ines,PEOPLE.yuki];
  s.commit('main','start',cast[0]!,{message:'Begin a shared idea',days:.1});
  for(let act=0;act<5;act++) {
    // One pause, once, between the second and third act.
    //
    // Everything else here lands a tenth of a day apart, which is the point —
    // the demo used to run at 0.97 arrivals a second against the shelf's 7.7.
    // But a history with no quiet in it has no busy either, and a `QUIET_GAP`
    // is part of the vocabulary this fixture exists to demonstrate: it is the
    // one event type the redesign dropped. A single breath costs a couple of
    // seconds and buys back the contrast.
    if(act===2)s.commit('main','pause',cast[0]!,{days:24,message:'A quiet stretch, then back to it'});
    const branches=['render','search','storage','plugins'].map(name=>`${name}/${act+1}`);
    for(const branch of branches)s.branch(branch,'main');
    for(let beat=0;beat<6;beat++) {
      for(let lane=0;lane<branches.length;lane++)s.commit(branches[lane]!,`${act}-${beat}-${lane}`,cast[lane+1]!,{days:.1,message:`${['Build','Connect','Refine','Test','Polish','Document'][beat]} ${branches[lane]!.split('/')[0]}`});
      s.commit('main',`main-${act}-${beat}`,cast[act%cast.length]!,{days:.1,message:'Bring the work together'});
      if(beat===2)s.merge('main',branches[0]!,`early-${act}`,cast[0]!,{days:.1,message:'Integrate the first rendering pass'});
    }
    for(let lane=0;lane<branches.length;lane++){s.keep(branches[lane]!);s.merge('main',branches[lane]!,`merge-${act}-${lane}`,cast[0]!,{days:.1,message:`Merge ${branches[lane]}`});}
    s.tag(`v${act+1}.0`,`merge-${act}-3`);
  }
  return s.build();
}
