import {forms} from './glossary.js';
import {normalize} from './learning.js';
import {read,write} from './storage.js';

export const WIKIS = {en:'https://en.wiktionary.org',fr:'https://fr.wiktionary.org'};
const EN_PARTS = new Set(('Noun|Proper noun|Verb|Adjective|Adverb|Pronoun|Determiner|Article|Preposition|Postposition|Conjunction|Interjection|Numeral|Number|Particle|Participle|Phrase|Proverb|Prefix|Suffix|Affix|Infix|Circumfix|Contraction|Letter|Symbol|Abbreviation|Initialism|Acronym').split('|'));
const FR_PARTS = new Set(('Nom commun|Nom propre|Nom de famille|Prénom|Verbe|Adjectif|Adverbe|Pronom|Déterminant|Article|Préposition|Postposition|Conjonction|Interjection|Numéral|Particule|Participe|Locution|Proverbe|Préfixe|Suffixe|Affixe|Lettre|Symbole|Abréviation|Sigle|Acronyme').split('|'));
const FR_LABELS = {NOM:'Nom commun',VER:'Verbe',ADJ:'Adjectif',ADV:'Adverbe',INTJ:'Interjection'};
const EN_LABELS = {NOM:'Noun',VER:'Verb',ADJ:'Adjective',ADV:'Adverb',INTJ:'Interjection'};
const cleanText = node => (node?.textContent||'').replace(/\s+/g,' ').trim();
const unique = values => Array.from(new Set(values));
export function articleLink(word,language) {
  return WIKIS[language]+'/wiki/'+encodeURIComponent(word)+(language==='fr'?'#fr':'#French');
}
export function bundledEntry(word,language) {
  const entry = forms.get(normalize(word));
  if (!entry) return null;
  const french = language==='fr';
  const gender = entry.gender==='f' ? (french?'féminin':'feminine') : entry.gender==='m' ? (french?'masculin':'masculine') : '';
  return {
    title:entry.word,
    ipa:entry.ipa?['/'+entry.ipa+'/']:[],
    source:'glossary',
    recordings:[],
    parts:[{label:(french?FR_LABELS:EN_LABELS)[entry.tag],gender,senses:[entry[language]]}]
  };
}
function audioFilename(value) {
  if (!value) return '';
  try {
    const filename = decodeURIComponent(value);
    return /^[^/\\]{1,220}\.(?:ogg|oga|mp3|wav|webm|opus|flac)$/i.test(filename) ? filename : '';
  } catch {return '';}
}
function linkedAudioFilename(node) {
  const match=(node.getAttribute('href')||'').match(/(?:^|[/:])(?:File|Fichier)(?::|%3A)([^#?]+)/i);
  return audioFilename(match?.[1]);
}
function audioSource(source) {
  try {
    const url = new URL(source,WIKIS.en);
    return url.protocol==='https:' && url.hostname==='upload.wikimedia.org' ? url.href : '';
  } catch {return '';}
}
function senseOf(item) {
  const copy = item.cloneNode(true);
  for (const node of copy.querySelectorAll('ul,ol,dl,.reference,.citation,.quotation,.h-usage-example,.usage-example,.mw-editsection,script,style')) node.remove();
  return cleanText(copy);
}
export function extractFrench(root,language) {
  const frenchEdition = language==='fr';
  let french=false, found=false, pronunciation=false, part=null;
  const parts=[], ipa=[], recordings=new Map();
  const nodes = root.querySelectorAll('h2,h3,h4,h5,h6,ol,p,.IPA,.API,audio,a[href],.gender');
  for (const node of nodes) {
    if (/^H[2-6]$/.test(node.tagName)) {
      const label=cleanText(node.querySelector('.mw-headline')||node).replace(/\s*\[(?:edit|modifier(?: le wikicode)?)\]\s*$/i,'');
      if (node.tagName==='H2') {
        if (french) break;
        french=frenchEdition?(label==='Français'||node.id==='fr'):(label==='French'||node.id==='French');
        found ||= french;
      }
      pronunciation=french&&/^(?:Pronunciation|Prononciation)(?: \d+)?$/.test(label);
      const baseLabel=label.replace(/\s+\d+$/,'');
      const isPart=frenchEdition
        ? FR_PARTS.has(baseLabel)||/^(?:Forme|Locution) (?:d[eu’']|adverbiale|verbale|nominale|adjectivale|prépositive|conjonctive|interjective|pronominale)/i.test(baseLabel)
        : EN_PARTS.has(baseLabel);
      part=french&&isPart?{label,gender:'',senses:[]}:null;
      if (part) parts.push(part);
      continue;
    }
    if (!french) continue;
    const isIPA=node.classList.contains('IPA')||node.classList.contains('API');
    const headwordSound=frenchEdition&&part&&!part.senses.length&&!node.closest('table,li,ol,ul');
    if (isIPA&&(pronunciation||headwordSound)&&!/^(?:Rhymes|Rimes)\s*:/i.test(cleanText(node.closest('li')))) {
      const sounds=cleanText(node).replace(/^[\\/\[\s]+|[\\/\]\s]+$/g,'');
      if (sounds&&!sounds.includes('?')) ipa.push('/'+sounds+'/');
    }
    if (frenchEdition&&part&&!part.gender&&!part.senses.length&&node.tagName==='P'&&!node.closest('table,li,ol,ul')&&node.querySelector('strong,.API')) {
      part.gender=unique(cleanText(node).match(/\b(?:féminin|masculin)\b/g)||[]).join(' / ');
    }
    if (pronunciation&&node.tagName==='AUDIO') {
      const links=Array.from(node.closest('tr,li')?.querySelectorAll('a[href]')||[]);
      const sources=[node.getAttribute('src'),...Array.from(node.querySelectorAll('source'),s=>s.getAttribute('src'))]
        .filter(Boolean).map(audioSource).filter(Boolean);
      if (sources.length) {
        const path=new URL(sources[0]).pathname.split('/');
        const original=path.includes('transcoded')?path.at(-2):path.at(-1);
        const filename=links.map(linkedAudioFilename).find(Boolean)||audioFilename(original);
        recordings.set(filename||sources[0],{filename,sources:unique(sources)});
      }
    }
    if (pronunciation&&node.tagName==='A') {
      const filename=linkedAudioFilename(node);
      if (filename&&!recordings.has(filename)) recordings.set(filename,{filename,sources:[
        'https://commons.wikimedia.org/wiki/Special:Redirect/file/'+encodeURIComponent(filename)
      ]});
    }
    if (part&&node.classList.contains('gender')&&!node.closest('li,table,dl')&&!part.gender) {
      const genders=Array.from(node.querySelectorAll('abbr[title]'),a=>a.title.replace(/ gender$/i,''));
      part.gender=genders.length?unique(genders).join(' / '):cleanText(node);
    }
    if (part&&node.tagName==='OL'&&!node.closest('li,table,dl,ul')&&!part.senses.length) {
      part.senses=Array.from(node.children).filter(li=>li.tagName==='LI').map(senseOf).filter(Boolean).slice(0,5);
    }
  }
  return found?{parts,ipa:unique(ipa).slice(0,6),recordings:Array.from(recordings.values()).slice(0,3)}:null;
}
export async function fetchText(url,timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response = await fetch(url,{credentials:'omit',signal:controller.signal});
    if (!response.ok) throw Error('HTTP '+response.status);
    return await response.text();
  } finally {clearTimeout(timer);}
}
async function queryWiki(word,language) {
  const params=new URLSearchParams({action:'parse',page:word,prop:'text',format:'json',formatversion:'2',
    redirects:'1',disableeditsection:'1',disablelimitreport:'1',disabletoc:'1',origin:'*'});
  const data=JSON.parse(await fetchText(WIKIS[language]+'/w/api.php?'+params,7500));
  if (['missingtitle','invalidtitle'].includes(data.error?.code)) return null;
  if (typeof data.parse?.text!=='string') throw Error('Dictionary entry unavailable');
  const template=document.createElement('template');
  template.innerHTML=data.parse.text;
  const result=extractFrench(template.content,language);
  if (!result?.parts.length && !result?.ipa.length && !result?.recordings.length) return null;
  return {...result,title:data.parse.title||word,source:'wiktionary'};
}
const entries=new Map(), pending=new Map();
const keyOf=(word,language)=>'dictionary-v2:'+language+':'+word;
export async function cachedEntry(word,language) {
  const key=keyOf(word,language);
  if (entries.has(key)) return entries.get(key);
  try {
    const saved=await read(key);
    if (saved) entries.set(key,saved);
    return saved||null;
  } catch {return null;}
}
export function onlineEntry(word,language) {
  const key=keyOf(word,language);
  if (entries.has(key)) return Promise.resolve(entries.get(key));
  if (!pending.has(key)) {
    pending.set(key,(async()=>{
      const lower=normalize(word);
      const entry=await queryWiki(word,language)||(lower!==word?await queryWiki(lower,language):null);
      if (entry) {
        entries.set(key,entry);
        void write(key,entry).catch(()=>{});
      }
      return entry;
    })().finally(()=>pending.delete(key)));
  }
  return pending.get(key);
}
