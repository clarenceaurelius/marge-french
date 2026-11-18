import {LEVELS,bandOf,normalize} from './learning.js';

const EXAMPLES = {
  A1:['maison','aimer','eau','vite','rue','chien'],
  A2:['bateau','cahier','heureux','descendre','toit','village'],
  B1:['hésiter','abri','indice','lendemain','précaution','retenir'],
  B2:['brume','aube','falaise','marée','seuil','dissiper'],
  C1:['effleurer','accoster','intarissable','subreptice','désinvolture','circonspect'],
  C2:['sibyllin','amphigouri','palimpseste','déliquescence','péremptoire','ineffable']
};

export const FRONTIER_STATUSES = {
  learned:'Acquis',
  assumed:'Présumés connus',
  practicing:'Pratiqués, à consolider',
  new:'À découvrir'
};

const PLOTTED = ['assumed','practicing','learned'];
const EXAMPLE_WORDS = Object.entries(EXAMPLES).flatMap(([level,words])=>words.map(word=>[word,level]));
const LEVEL_NAMES = [...LEVELS,''];
const emptyCounts = () => Object.fromEntries(Object.keys(FRONTIER_STATUSES).map(key=>[key,0]));

function wordStatus(entry,override,level,reference) {
  if (override==='known') return 'learned';
  if (entry) {
    const confidence=entry.confidence??(entry.rating==='good'?4:0);
    return override!=='study'&&entry.seen>=2&&confidence>=4?'learned':'practicing';
  }
  return override!=='study'&&level&&LEVELS.indexOf(level)<=LEVELS.indexOf(reference)?'assumed':'new';
}

export function buildFrontier(reviews,overrides,reference,lexique) {
  const words=new Map(EXAMPLE_WORDS.map(([word,level])=>[word,{word,level,sample:true}]));
  for (const entry of Object.values(reviews)) {
    if (!entry?.card?.lemma) continue;
    const word=normalize(entry.card.lemma);
    const example=words.get(word);
    const level=example?.level||bandOf(lexique?.ranks.get(word))||entry.card.level;
    words.set(word,{word,level:LEVELS.includes(level)?level:'',sample:!!example?.sample,entry});
  }

  const bands=new Map(LEVEL_NAMES.map(level=>[level,{level,words:[],counts:emptyCounts()}]));
  const totals=emptyCounts();
  for (const [word,item] of words) {
    const override=Object.hasOwn(overrides,word)?overrides[word]:'';
    const status=wordStatus(item.entry,override,item.level,reference);
    Object.assign(item,{override,status});
    const band=bands.get(item.level);
    band.words.push(item);
    band.counts[status]++;
    totals[status]++;
  }
  for (const band of bands.values()) band.words.sort((a,b)=>a.word.localeCompare(b.word,'fr'));
  return {words,bands,totals};
}

const CENTER=[210,176];
const RADIUS=115;

function coordinates(axis,fraction=1) {
  const angle=2*Math.PI*axis/LEVELS.length-Math.PI/2;
  return [
    Math.round((CENTER[0]+Math.cos(angle)*RADIUS*fraction)*100)/100,
    Math.round((CENTER[1]+Math.sin(angle)*RADIUS*fraction)*100)/100
  ];
}

function ring(fraction) {
  return LEVELS.map((_,axis)=>coordinates(axis,fraction).join(',')).join(' ');
}

export function radarMarkup(data,activeBand,activeWord,esc) {
  const grids=[.25,.5,.75,1].map(fraction=>'<polygon points="'+ring(fraction)+'" class="radar-ring'+
    (fraction===1?' radar-edge':'')+'"></polygon>').join('');
  const spokes=LEVELS.map((level,axis)=>{
    const [x,y]=coordinates(axis);
    return '<line x1="'+CENTER[0]+'" y1="'+CENTER[1]+'" x2="'+x+'" y2="'+y+'" class="radar-spoke'+
      (level===activeBand?' radar-spoke-active':'')+'"></line>';
  }).join('');
  const traces=PLOTTED.map(status=>{
    const values=LEVELS.map(level=>{
      const {counts,words}=data.bands.get(level);
      return words.length?counts[status]/words.length:0;
    });
    if (!values.some(Boolean)) return '';
    const points=values.map((value,axis)=>coordinates(axis,value));
    const markers=points.map(([x,y],axis)=>values[axis]?'<circle cx="'+x+'" cy="'+y+'" r="3"></circle>':'').join('');
    return '<g class="radar-trace radar-'+status+'"><polygon points="'+points.map(point=>point.join(',')).join(' ')+'"></polygon>'+markers+'</g>';
  }).join('');

  const words=LEVELS.map((level,axis)=>{
    const item=data.words.get(EXAMPLES[level][0]);
    const [x,y]=coordinates(axis,1.247);
    const selected=activeWord===item.word;
    return '<g class="radar-word radar-'+item.status+(selected?' radar-word-active':'')+'" transform="translate('+x+' '+y+')" '+
      'role="button" tabindex="0" data-action="frontierWord" data-value="'+esc(item.word)+'" aria-pressed="'+selected+'" aria-label="'+
      esc(level+' · '+item.word+' · '+FRONTIER_STATUSES[item.status])+'">'+
      '<rect class="radar-word-hit" x="-51" y="-18" width="102" height="38" rx="9"></rect>'+
      '<text class="radar-level" y="-3" text-anchor="middle">'+level+'</text>'+
      '<circle class="radar-word-dot" cx="-42" cy="10" r="2.8"></circle>'+
      '<text class="radar-word-text" y="14" text-anchor="middle">'+esc(item.word)+'</text></g>';
  }).join('');

  return '<svg class="frontier-radar" viewBox="0 0 420 354" role="group" aria-label="Radar des mots par niveau, de A1 à C2">'+
    '<g aria-hidden="true">'+grids+spokes+traces+
    '<text class="radar-scale" x="216" y="87">75 %</text><text class="radar-scale" x="216" y="116">50 %</text>'+
    '<text class="radar-scale" x="216" y="145">25 %</text></g>'+words+'</svg>';
}
