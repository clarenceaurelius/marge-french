export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const BOUNDS = [750, 1500, 3000, 5500, 9500, Infinity];
export const normalize = s => s.normalize('NFC').trim().toLocaleLowerCase('fr').replaceAll('’', "'");
export const bandOf = rank => rank ? LEVELS[BOUNDS.findIndex(bound => rank <= bound)] : '';
export const TAGS = {NOM: 'Nom', VER: 'Verbe', AUX: 'Verbe', ADJ: 'Adjectif', ADV: 'Adverbe'};
const STOP = new Set(('a à afin ai aient ainsi ait alors as assez au aucun aussi autant autre aux avec c ce ceci cela celle celui ces cet cette ceux chacun chez comme contre d dans de dedans dehors déjà depuis des devant donc dont du durant elle elles en encore entre est et eux faut grâce hors ici il ils j je jusqu l la laquelle le lequel les leur leurs lui m ma mais me même mes moi moins mon n ne ni non nos notre nous on ont où ou par parce pas pendant peu plus pour pourquoi près puis puisqu qu quand que quel quelle quels quelque quelques qui quoi quoiqu s sa sans se selon sera serez ses si sinon soi son sont sous sur t ta te tel telle tes toi ton tous tout toute toutes très trop tu un une unes uns vers voici voilà vos votre vous y être avoir').split(' '));
const DETERMINERS = new Set('un une des le la les du ce ces cet cette mon ton son notre votre leur mes tes ses nos vos leurs'.split(' '));
const SUBJECTS = new Set('je tu il elle on ils elles nous vous j'.split(' '));
const TOKEN = /\p{L}+(?:['’]\p{L}+)*/gu;
const FORM = /^\p{L}+(?:'\p{L}+)*$/u;
const ELISION = /^(?:[cdjlmnst]|qu|jusqu|lorsqu|puisqu|quoiqu)'/;
const CHAPTER = /^(?:(?:chapitres?|chapters?|livre|tome|partie|acte)(?:\s+(?:\d+|[ivxlcdm]{1,8}|premier|première|un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)(?=\W|$)|\s*[:.–—-])|(?:prologue|épilogue|avant-propos|préface)(?:\s*[:.–—-].*)?$)/iu;
const NUMBERED = /^(?:I|V|X|[IVXLCDM]{2,8}|\d{1,3})[.)]?(?:(?:\s+[—–-]\s+|:\s+).+)?$/;
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('fr', {granularity:'sentence'}) : null;
export const LEXIQUE_URL = 'https://www.lexique.org/databases/Lexique383/Lexique383.tsv';
export const LEXIQUE_MIRROR = 'https://raw.githubusercontent.com/TYacinee/2024-projet-final-Touileb-Yacine/main/Lexique383.tsv';

function clean(text) {
  return text.replace(/!\[[^\]]*\]\([^)]+\)/g,'').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1')
    .replace(/<https?:\/\/[^>]+>|https?:\/\/[^\s]+/g,'').replace(/<\/?[a-z][^>]*>/gi,'')
    .replace(/^ {0,3}(?:#{1,6}|[>*+-]|\d+\.)[ \t]+/gm,'')
    .replace(/(?:[*_]{1,3}|~~)([^*_\n~]+)(?:[*_]{1,3}|~~)/g,'$1')
    .replace(/^\s*[-*_]{3,}\s*$/gm,'').trim();
}

export function parseBook(source) {
  const lines = source.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n')
    .replace(/^\s*---[ \t]*\n(?=[\w-]+\s*:)[\s\S]*?\n---[ \t]*\n/,'')
    .replace(/^[ \t]*(\x60{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*(?:\n|$)/gm,'').split('\n');
  const start = lines.findIndex(s => /^\s*\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i.test(s));
  if (start >= 0) lines.splice(0,start+1);
  const end = lines.findIndex(s => /^\s*\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i.test(s));
  if (end >= 0) lines.splice(end);

  const headings = [];
  for (let i=0;i<lines.length;i++) {
    const value = lines[i].trim();
    const markdown = value.match(/^(#{1,6})[ \t]+(.+)$/);
    const underlined = !markdown && value && i+1<lines.length && /^(?:={3,}|-{3,})$/.test(lines[i+1].trim()) && (i===0 || !lines[i-1].trim());
    const title = (markdown ? markdown[2].replace(/\s+#+$/,'') : value).trim();
    const depth = markdown ? markdown[1].length : underlined ? (lines[i+1].includes('=')?1:2) : 0;
    const explicit = title.length <= 115 && (CHAPTER.test(title) || (NUMBERED.test(title) && (depth || !lines[i-1]?.trim() || !lines[i+1]?.trim())));
    if (depth || explicit) headings.push({i,after:i+(underlined?2:1),title,depth,explicit});
    if (underlined) i++;
  }
  const first = headings[0];
  const cover = first?.depth===1 && !first.explicit && !lines.slice(0,first.i).some(s=>s.trim()) &&
    headings.slice(1).some(h=>h.depth>1||h.explicit) && headings.filter(h=>h.depth===1).length===1 ? first : null;
  const candidates = headings.filter(h=>h!==cover);
  const explicit = candidates.filter(h=>h.explicit);
  const depth = candidates.reduce((n,h)=>h.depth?Math.min(n,h.depth):n,Infinity);
  const boundaries = explicit.length ? explicit : candidates.filter(h=>h.depth===depth);
  const chapters = [];
  let from = cover?.after || 0;
  let name = boundaries.length ? 'Introduction' : 'Chapitre 1';
  for (const heading of [...boundaries,{i:lines.length}]) {
    const body = clean(lines.slice(from,heading.i).join('\n'));
    if (/\p{L}/u.test(body)) chapters.push({title:name,body});
    from=heading.after;
    name=heading.title;
  }
  return {title:cover?.title||(first?.depth===1&&boundaries.length===1?first.title:''),chapters};
}

export async function parseLexique(tsv) {
  const rows = tsv.split(/\r?\n/);
  const columns = rows.shift().trim().toLowerCase().split('\t');
  const indexes = ['ortho','lemme','cgram','freqlemlivres','freqlemfilms2','freqlivres','freqfilms2'].map(k=>columns.indexOf(k));
  if (indexes.includes(-1)) throw Error('Choisissez le fichier TSV de Lexique 3.83 avec ses en-têtes d’origine.');
  const [orth,lemma,pos,book,film,formBook,formFilm] = indexes;
  const width = Math.max(...indexes)+1;
  const forms = new Map(), totals = new Map();
  for (let i=0;i<rows.length;i++) {
    if (i && i%10000===0) await new Promise(resolve=>setTimeout(resolve,0));
    const row = rows[i].split('\t',width);
    if (!row[orth] || !row[lemma] || !row[pos]) continue;
    const word = normalize(row[orth]), base = normalize(row[lemma]), tag = row[pos].trim();
    if (!FORM.test(word) || !FORM.test(base)) continue;
    const value = column => Math.max(0,Number((row[column]||'').replace(',','.'))||0);
    const score = .7*value(book)+.3*value(film);
    const parts = totals.get(base)||new Map();
    parts.set(tag,Math.max(parts.get(tag)||0,score));
    totals.set(base,parts);
    const options = forms.get(word)||[];
    const strength = .7*value(formBook)+.3*value(formFilm);
    const same = options.find(option=>option[0]===base&&option[1]===tag);
    if (same) same[2]=Math.max(same[2],strength);
    else options.push([base,tag,strength]);
    forms.set(word,options);
  }
  const sorted = Array.from(totals,([word,parts])=>[word,Array.from(parts.values()).reduce((a,b)=>a+b,0)])
    .filter(([,score])=>score>0).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'fr'));
  if (!sorted.length) throw Error('Le fichier ne contient aucune fréquence exploitable.');
  const ranks = new Map();
  sorted.forEach(([word,score],i)=>ranks.set(word,i&&score===sorted[i-1][1]?ranks.get(sorted[i-1][0]):i+1));
  return {forms,ranks};
}

export function analyse(chapter, book, lex, sampleWords) {
  const cards = new Map();
  for (const paragraph of chapter.body.split(/\n\s*\n/)) {
    const text = paragraph.replace(/\s+/g,' ').trim();
    const segments = segmenter ? segmenter.segment(text) : (text.match(/[^.!?…]+[.!?…]*/g)||[]);
    for (const span of segments) {
      const sentence = (typeof span==='string'?span:span.segment).trim();
      let previous = '';
      for (const token of sentence.matchAll(TOKEN)) {
        const raw = normalize(token[0]), exact = lex?.forms.get(raw), prefix = raw.match(ELISION)?.[0]||'';
        const offset = exact ? 0 : prefix.length, word = raw.slice(offset);
        const before = prefix==="l'"?'le':prefix==="j'"?'j':previous;
        previous = word;
        if (STOP.has(word)||word.length<2) continue;
        const sample = sampleWords.get(word);
        if (book.id==='demo'&&!sample) continue;
        let lemma = sample?.word||word, tag = sample?.tag||'';
        const options = exact||lex?.forms.get(word);
        if (options) {
          let best = -Infinity;
          for (const [candidate,pos,freq] of options) {
            const score = Math.log1p(freq)+(DETERMINERS.has(before)&&pos==='NOM'?2:0)+(SUBJECTS.has(before)&&pos==='VER'?2:0);
            if (score>best) {best=score;lemma=candidate;tag=pos;}
          }
        }
        if (book.id==='demo'&&!sampleWords.has(lemma)) {lemma=sample.word;tag=sample.tag;}
        if (STOP.has(lemma)||(tag&&!TAGS[tag])) continue;
        const prior = cards.get(lemma);
        if (prior) {prior.count++;continue;}
        cards.set(lemma,{lemma,tag,count:1,level:lex?bandOf(lex.ranks.get(lemma)):book.id==='demo'?(sample?.level||''):'',
          sentence,index:token.index+offset,form:token[0].slice(offset),title:book.title,chapter:chapter.title});
      }
    }
  }
  return Array.from(cards.values());
}

const HOUR = 3_600_000;
const MAX_INTERVAL = 90 * 24 * HOUR;
const FACTOR = -Math.log2(.8);
export const CONFIDENCE_SCALE = [
  {label:'Oublié', hours:1/6, afterMiss:1/6},
  {label:'Reconnu à la lecture', hours:2, afterMiss:.5, multiplier:.5},
  {label:'Retrouvé avec effort', hours:10, afterMiss:1, multiplier:.9},
  {label:'Bien mémorisé', hours:24, afterMiss:3, multiplier:1.9},
  {label:'Retrouvé immédiatement', hours:72, afterMiss:6, multiplier:2.6}
];

export const recall = (entry,now) => 2**(-Math.max(0,now-entry.last)/entry.half);

export function reviewInterval(old, confidence, now=Date.now()) {
  const {hours, afterMiss, multiplier} = CONFIDENCE_SCALE[confidence-1];
  const initial = hours * HOUR;
  if (confidence===1 || !old) return initial;
  if ((old.confidence===1 || old.rating==='again') && old.due>now) return afterMiss * HOUR;

  const previous = old.due-old.last;
  if (!Number.isFinite(previous) || previous<=0) return initial;
  if (confidence===2) return Math.min(12*HOUR,Math.max(initial,previous*multiplier));
  if (confidence===3) return Math.min(MAX_INTERVAL,Math.max(initial,previous*multiplier));

  const spacing = Math.min(1,Math.max(.25,(now-old.last)/previous));
  return Math.min(MAX_INTERVAL,Math.max(initial,previous*(1+(multiplier-1)*spacing)));
}

export function grade(card, old, confidence, now=Date.now()) {
  const interval = reviewInterval(old,confidence,now);
  return {card,confidence,last:now,half:interval/FACTOR,due:now+interval,
    seen:(old?.seen||0)+1,lapses:(old?.lapses||0)+(confidence===1?1:0)};
}
