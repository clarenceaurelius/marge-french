import {LEVELS,TAGS,LEXIQUE_URL,LEXIQUE_MIRROR,normalize,parseBook,parseLexique,analyse,grade,recall,bandOf,CONFIDENCE_SCALE,reviewInterval} from './learning.js';
import {sampleBook,forms,entries} from './glossary.js';
import {WIKIS,articleLink,bundledEntry,cachedEntry,onlineEntry,fetchText} from './dictionary.js';
import {read,write} from './storage.js';
import {buildFrontier,radarMarkup,FRONTIER_STATUSES} from './frontier.js';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key)?object[key]:undefined;
const count=(n,word)=>n+' '+word+(n===1?'':'s');
const keys={state:'marge-reading-v1',lex:'lexique383-v1'};
const defaults={books:[],reviews:{},notes:{},selected:'demo',chapter:0,level:'all',recent:[],frontierReference:'B1',frontierOverrides:{}};
const tabs=['chapters','dictionary','review','frontier','method'];
let state={...defaults}, lex=null, analyses=new WeakMap(), saveQueue=Promise.resolve();
const portable=document.documentElement.hasAttribute('data-portable');
const home=portable?'dictionary':'chapters';
const DEFAULT_CONFIDENCE=3;
const FRENCH='fr';
let view=home, session=null, searched='', previewLimit=8, lexStatus='', loadingLex=false;
let lookupLanguage=FRENCH, entryRequest=0;
let frontierBand='B1', frontierWord='hésiter', frontierQuery='', frontierData;

function save() {
  const snapshot=JSON.stringify(state);
  saveQueue=saveQueue.catch(()=>{}).then(async()=>{
    try {await write(keys.state,JSON.parse(snapshot));}
    catch {
      try {localStorage.setItem(keys.state,snapshot);}
      catch {
        $('storageNote').hidden=false;
        $('storageNote').textContent='Ce navigateur n’a pas pu enregistrer vos modifications. Votre progression risque d’être perdue à la fermeture.';
      }
    }
  });
}
const allBooks=()=>[sampleBook,...state.books];
const currentBook=()=>allBooks().find(b=>b.id===state.selected)||sampleBook;
const currentChapter=()=>currentBook().chapters[state.chapter]||currentBook().chapters[0];
const history=word=>own(state.reviews,word);
const allReviews=()=>Object.values(state.reviews);
const availableCards=(cards,now=Date.now())=>cards.filter(card=>{
  const entry=history(card.lemma);
  return !entry||entry.due<=now;
});
const dueReviews=(now=Date.now())=>allReviews().filter(entry=>entry.due<=now)
  .sort((a,b)=>recall(a,now)-recall(b,now)||a.due-b.due);

function chapterCards() {
  const book=currentBook(), chapter=currentChapter(), now=Date.now();
  if (!analyses.has(chapter)) analyses.set(chapter,analyse(chapter,book,lex,forms));
  const priority=card=>{
    const entry=history(card.lemma);
    return !entry?1:entry.due<=now?0:2;
  };
  return analyses.get(chapter)
    .filter(card=>state.level==='all'||(state.level==='unranked'?!card.level:LEVELS.indexOf(card.level)>=LEVELS.indexOf(state.level)))
    .sort((a,b)=>priority(a)-priority(b)||b.count-a.count||a.lemma.localeCompare(b.lemma,'fr'));
}

const button=(label,action,classes='',value='',attrs='')=>
  '<button type="button" class="btn '+classes+'" data-action="'+action+'" data-value="'+esc(value)+'" '+attrs+'>'+label+'</button>';
const badge=level=>'<span class="band '+esc(level||'')+'">'+esc(level||'Non classé')+'</span>';
const page=(title,description='',eyebrow='')=>'<header class="page">'+(eyebrow?'<div class="eyebrow">'+eyebrow+'</div>':'')+
  '<h1>'+title+'</h1>'+(description?'<p>'+description+'</p>':'')+'</header>';
const definitionLanguage=()=>view==='session'?session.language:lookupLanguage;
const languagePicker=()=>'<div class="switch" role="group" aria-label="Langue de la définition">'+
  [['fr','Français'],['en','English']].map(([id,label])=>button(label,'language','',id,
    'aria-pressed="'+(id===definitionLanguage())+'" lang="'+id+'"')).join('')+'</div>';
const sourceLink=(word,language,label)=>'<a href="'+esc(articleLink(word,language))+'" target="_blank" rel="noopener noreferrer">'+
  esc(label||(language==='fr'?'Wiktionnaire':'Wiktionary'))+' ↗</a>';
const wordButton=word=>button(esc(word),'lookup','outline',word,'lang="fr"');

function entryHtml(data,word,language,cached=false) {
  const isGlossary=data.source==='glossary';
  const audio=data.recordings.map((track,i)=>
    '<div class="recording"><audio controls preload="none" aria-label="Enregistrement de la prononciation '+(i+1)+'">'+
    track.sources.map(src=>'<source src="'+esc(src)+'">').join('')+'</audio>'+
    (track.filename?'<small><a href="'+esc(WIKIS[language]+'/wiki/File:'+encodeURIComponent(track.filename))+
      '" target="_blank" rel="noopener noreferrer">Source de l’enregistrement ↗</a></small>':'')+'</div>').join('');
  const voice=voiceAvailable()
    ?button('Écouter le mot','speak','outline',data.title||word):'';
  const parts=data.parts.map(part=>'<section class="dictpart"><h3>'+esc(part.label)+(part.gender?' · <small>'+esc(part.gender)+'</small>':'')+
    '</h3>'+(part.senses.length?'<ol>'+part.senses.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ol>':'')+'</section>').join('');
  const source=isGlossary?'Glossaire intégré · '+sourceLink(data.title,language):
    (cached?'Enregistré sur cet appareil · ':'')+sourceLink(data.title,language)+' · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a>';
  return '<div class="row entry-head"><h2 lang="fr">'+esc(data.title||word)+'</h2></div>'+
    (data.ipa.length?'<p class="phon"><small>API</small> '+data.ipa.map(esc).join(' · ')+'</p>':'')+
    audio+(voice?'<div class="actions">'+voice+' <small class="voice-status" role="status"></small></div>':'')+
    (parts?'<div lang="'+language+'">'+parts+'</div>':'')+
    '<p class="dictsource">'+source+'</p>';
}

async function fillEntry() {
  const region=$('entry');
  if (!region) return;
  const request=++entryRequest;
  const isCurrent=()=>region.isConnected&&request===entryRequest;
  const word=region.dataset.word, language=definitionLanguage();
  const bundled=bundledEntry(word,language);
  region.innerHTML=bundled?entryHtml(bundled,word,language):'<p>Recherche de <strong lang="fr">'+esc(word)+'</strong>…</p>';
  if (region.dataset.example==='true') return;
  const saved=await cachedEntry(word,language);
  if (!isCurrent()) return;
  if (saved) {region.innerHTML=entryHtml(saved,word,language,true);return;}
  if (navigator.onLine===false) {
    if (!bundled) region.innerHTML='<p>Ce mot ne figure pas dans le glossaire intégré. Une connexion est nécessaire pour le rechercher.</p>';
    return;
  }
  try {
    const result=await onlineEntry(word,language);
    if (!isCurrent()) return;
    if (result) {
      if (!region.contains(document.activeElement)) region.innerHTML=entryHtml(result,word,language);
    } else if (!bundled) {
      region.innerHTML='<p>Aucune entrée française dans cette édition. Essayez l’autre édition ou la forme de base du mot.</p>'+
        '<p class="dictsource">'+sourceLink(word,language)+'</p>';
    }
  } catch {
    if (!isCurrent()||bundled) return;
    region.innerHTML='<p>Le dictionnaire en ligne est inaccessible.</p><div class="actions">'+
      button('Réessayer','retry','outline')+' '+sourceLink(word,language,'Ouvrir l’entrée à la source')+'</div>';
  }
}

function chaptersPage() {
  const book=currentBook(), chapter=currentChapter(), words=chapterCards(), index=book.chapters.indexOf(chapter);
  const ready=availableCards(words);
  const filters=[['all','Tous les niveaux'],...LEVELS.map(l=>[l,l+' et plus']),['unranked','Non classé']];
  return page('Lisez et apprenez en français.','Retrouvez le sens des mots dans vos lectures et révisez-les au bon moment.','Votre espace de lecture')+
    '<div class="grid"><div class="stack"><section class="panel hero"><div class="cover" aria-hidden="true">marge.</div>'+
    '<div><div class="eyebrow">'+(book.id==='demo'?'Livre d’exemple':'Votre livre')+'</div><h2 lang="fr">'+esc(book.title)+'</h2>'+
    '<p>'+count(book.chapters.length,'chapitre')+'</p></div></section>'+
    '<section class="panel"><h2>Chapitres</h2><div class="column chapter-list">'+book.chapters.map((ch,i)=>
      button('<small>'+String(i+1).padStart(2,'0')+'</small> <span lang="fr">'+esc(ch.title)+'</span><span aria-hidden="true">›</span>',
        'chapter','chapter '+(i===index?'current':''),i,i===index?'aria-current="true"':'')).join('')+
    '</div></section></div><div class="stack"><section class="panel"><div class="eyebrow">Chapitre '+(index+1)+'</div>'+
    '<h2 lang="fr">'+esc(chapter.title)+'</h2><p>'+count(words.length,'mot')+' · '+words.filter(w=>history(w.lemma)).length+' déjà étudiés</p>'+
    '<label for="level">Niveau minimum</label><select id="level">'+filters.map(([id,title])=>
      '<option value="'+id+'"'+(id===state.level?' selected':'')+'>'+title+'</option>').join('')+'</select>'+
    '<p><small>'+(lex?'Niveaux estimés à partir de Lexique 3.83.':book.id==='demo'?'Niveaux indicatifs de l’exemple.':
      (loadingLex?'Estimation des niveaux en cours…':'<a href="#method">Chargez Lexique</a> pour estimer le niveau des mots importés.'))+'</small></p>'+
    button('Étudier ce chapitre →','practice','primary full','',ready.length?'':'disabled')+
    (words.length&&!ready.length?'<p><small>Tous ces mots ont déjà un rappel planifié.</small></p>':'')+
    '</section><section class="panel review-panel"><div class="row"><h2>À réviser</h2><span class="count">'+dueReviews().length+'</span></div>'+
    '<a href="#review" class="btn quiet">Voir les révisions →</a></section></div></div>'+
    '<section class="panel vocabulary"><div class="row"><h2>Vocabulaire du chapitre</h2>'+
    (words.length>8?button(previewLimit===8?'Voir plus':'Voir moins','expand','quiet'):'')+'</div>'+
    '<p>Sélectionnez un mot pour consulter sa définition.</p>'+
    (words.length?'<table><thead><tr><th scope="col">Mot</th><th scope="col">Niveau</th><th scope="col">Occurrences</th></tr></thead><tbody>'+
    words.slice(0,previewLimit).map(word=>'<tr><td><button type="button" lang="fr" class="wordlink" data-action="lookup" data-value="'+
      esc(word.lemma)+'">'+esc(word.lemma)+'</button></td><td>'+badge(word.level)+'</td><td>'+word.count+'</td></tr>').join('')+
    '</tbody></table>':'<p>Aucun mot à ce niveau.</p>')+'</section>';
}

function dictionaryPage() {
  const suggestions=['brume','vite','porter','cheval','seuil','maison'];
  return page('Dictionnaire.','Consultez une définition en français ou choisissez <span lang="en">English</span> pour une aide ponctuelle.')+
    '<div class="grid dictionary-grid"><section class="panel dictionary-panel"><form id="lookupForm">'+
    '<label for="term">Mot ou expression</label><div class="formrow">'+
    '<input id="term" lang="fr" list="glossaryTerms" placeholder="p. ex. brume" autocomplete="off" maxlength="100" required value="'+esc(searched)+'">'+
    '<button type="submit" class="btn primary">Rechercher</button></div><p class="warning" id="lookupError" role="alert"></p></form>'+
    '<datalist id="glossaryTerms">'+Array.from(entries.keys(),word=>'<option value="'+esc(word)+'">').join('')+'</datalist>'+
    languagePicker()+(searched?'':'<p class="entry-example"><small>Exemple</small></p>')+
    '<div class="entry" id="entry" data-word="'+esc(searched||'brume')+'" data-example="'+(!searched)+'" aria-live="polite"></div></section>'+
    '<div class="stack"><aside class="panel"><h2>Mots à découvrir</h2><div class="actions">'+suggestions.map(wordButton).join('')+'</div></aside>'+
    (state.recent.length?'<aside class="panel"><h2>Recherches récentes</h2><div class="actions">'+state.recent.map(wordButton).join('')+'</div></aside>':'')+
    '</div></div>';
}

function frontierStatus(item) {
  return '<span class="frontier-status frontier-'+item.status+'">'+FRONTIER_STATUSES[item.status]+'</span>';
}

function frontierWordList() {
  const match=normalize(frontierQuery);
  const items=frontierData.bands.get(frontierBand).words.filter(item=>!match||item.word.includes(match));
  if (!items.length) return '<p class="frontier-empty">'+(match?'Aucun mot correspondant.':'Aucun mot dans ce groupe.')+'</p>';
  return items.map(item=>button('<span lang="fr">'+esc(item.word)+'</span>'+frontierStatus(item),'frontierWord',
    'frontier-word-row',item.word,'aria-pressed="'+(item.word===frontierWord)+'"')).join('');
}

function frontierSelection(item) {
  if (!item) return '';
  const {confidence,rating,seen}=item.entry||{};
  const score=confidence??({again:1,hard:3,good:4})[rating];
  const historyLabel=seen?count(seen,'passage')+(score?' · dernière confiance '+score+'/5':''):'Aucune pratique enregistrée';
  const options=[['known','Je le connais'],['study','À travailler'],['','Automatique']];
  return '<section class="frontier-detail" aria-labelledby="frontierSelection">'+
    '<div class="row"><h3 id="frontierSelection" tabindex="-1" lang="fr">'+esc(item.word)+'</h3>'+frontierStatus(item)+'</div>'+
    '<p><small>'+historyLabel+'</small></p><div class="actions" role="group" aria-label="Votre évaluation">'+
    options.map(([value,label])=>button(label,'frontierOverride','outline',value,'aria-pressed="'+(value===item.override)+'"')).join('')+
    '</div><div class="actions">'+button('Consulter le dictionnaire →','lookup','quiet',item.word)+'</div></section>';
}

function frontierPage() {
  const reference=state.frontierReference;
  frontierData=buildFrontier(state.reviews,state.frontierOverrides,reference,lex);
  const group=frontierData.bands.get(frontierBand);
  const current=frontierData.words.get(frontierWord);
  const selected=current?.level===frontierBand?current:group.words[0];
  frontierWord=selected?.word||'';
  const referenceOptions=[['','Aucun niveau présumé'],...LEVELS.map(level=>[level,level])];
  const range=frontierBand?'Niveau '+frontierBand:'Mots non classés';
  const bands=[...LEVELS,''];
  return page('Votre frontière lexicale.','Explorez les mots acquis, présumés connus et encore à consolider.')+
    '<div class="frontier-layout"><section class="panel frontier-chart" aria-labelledby="frontierChart">'+
    '<div class="row frontier-chart-header"><h2 id="frontierChart">Radar du vocabulaire</h2>'+
    '<div><label for="frontierReference">Niveau de référence</label><select id="frontierReference">'+
    referenceOptions.map(([value,title])=>'<option value="'+value+'"'+(reference===value?' selected':'')+'>'+title+'</option>').join('')+
    '</select></div></div>'+
    '<figure class="radar-figure">'+radarMarkup(frontierData,frontierBand,frontierWord,esc)+
    '<figcaption>Cliquez sur un mot du radar. Chaque axe mesure la part des mots de son niveau dans cet échantillon.</figcaption></figure>'+
    '<ul class="frontier-legend" aria-label="Légende du radar">'+Object.entries(FRONTIER_STATUSES).map(([status,label])=>
      '<li class="frontier-'+status+'"><span class="legend-line" aria-hidden="true"></span>'+label+
      '<strong>'+frontierData.totals[status]+'</strong></li>').join('')+'</ul>'+
    '<details class="frontier-method"><summary>Comment lire le radar ?</summary>'+
    '<p>Le radar rassemble 36 mots d’exemple et les mots que vous avez pratiqués. Les niveaux des exemples sont indicatifs. Les mots sans niveau se trouvent sous <em>Non classés</em>.</p>'+
    '<p>Un mot est acquis si vous le déclarez connu ou après deux passages avec une dernière confiance d’au moins 4 sur 5. Sans pratique, un mot jusqu’à votre niveau de référence est présumé connu. Les mots à découvrir entrent dans le total du niveau sans former de tracé.</p>'+
    '</details></section>'+
    '<aside class="panel frontier-side" aria-label="Mots et évaluations"><div class="row"><h2>'+range+
    '</h2><span class="count">'+count(group.words.length,'mot')+'</span></div>'+
    '<div class="frontier-bands" role="group" aria-label="Niveau des mots">'+bands.map(level=>button(level||'Non classés','frontierBand','outline',level,
      'aria-pressed="'+(frontierBand===level)+'"')).join('')+'</div>'+
    '<label for="frontierQuery">Filtrer les mots</label><input id="frontierQuery" type="search" autocomplete="off" value="'+esc(frontierQuery)+'">'+
    '<div id="frontierWords" class="frontier-words">'+frontierWordList()+'</div>'+frontierSelection(selected)+'</aside></div>';
}

function focusFrontierControl(action,value) {
  Array.from(document.querySelectorAll('[data-action="'+action+'"]')).find(node=>node.dataset.value===value)?.focus({preventScroll:true});
}

function reviewPage() {
  const now=Date.now(), ready=dueReviews(now), upcoming=allReviews().filter(entry=>entry.due>now).sort((a,b)=>a.due-b.due);
  const when=new Intl.DateTimeFormat('fr-FR',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  const rows=(list,future)=>list.slice(0,12).map(entry=>'<div class="row review-row"><div><strong lang="fr">'+esc(entry.card.lemma)+
    '</strong><small>'+esc(entry.card.title)+'</small></div><span>'+
    (future?esc(when.format(entry.due)):Math.round(recall(entry,now)*100)+' % de rappel')+'</span></div>').join('');
  return page('Vos révisions.','Les rappels sont prévus quand la probabilité de retrouver le mot est estimée à 80 %.','Répétition espacée')+
    '<div class="grid"><section class="panel"><div class="row"><h2>À réviser maintenant</h2><span class="count">'+ready.length+'</span></div>'+
    (ready.length?rows(ready,false)+button('Commencer la révision →','reviewNow','primary full'):'<p>Aucun mot à revoir pour le moment.</p>')+
    '</section><section class="panel"><div class="row"><h2>Prochaines révisions</h2><span class="count">'+upcoming.length+'</span></div>'+
    (upcoming.length?rows(upcoming,true):'<p>Étudiez un chapitre pour prévoir vos premiers rappels.</p>')+'</section></div>';
}

function methodPage() {
  const bounds=['1–750','751–1,500','1,501–3,000','3,001–5,500','5,501–9,500','9,501 and up'];
  return page('Comment ça marche ?')+'<div class="grid"><section class="panel"><h2>Fréquence des mots</h2>'+
    '<p>Lexique 3.83 regroupe les formes d’un mot sous leur forme de base. Le calcul pondère à 70 % les livres et à 30 % les sous-titres. Les niveaux A1 à C2 sont indicatifs. Les mots absents restent non classés.</p>'+
    '<table><thead><tr><th scope="col">Niveau</th><th scope="col">Rang de fréquence</th></tr></thead><tbody>'+
    LEVELS.map((label,i)=>'<tr><td>'+badge(label)+'</td><td>'+bounds[i]+'</td></tr>').join('')+'</tbody></table>'+
    '<p><a href="https://openlexicon.fr/datasets-info/Lexique383/README-Lexique.html" target="_blank" rel="noopener noreferrer">Lexique 3.83 · CC BY-SA 4.0</a></p>'+
    '<p role="status">'+esc(lexStatus||(lex?lex.ranks.size.toLocaleString('fr-FR')+' formes de base classées.':'Chargez Lexique pour estimer le niveau des mots de vos livres.'))+'</p>'+
    '<div class="actions">'+button('Charger Lexique (25 Mo)','lexLoad','primary','',loadingLex?'disabled':'')+
    button('Choisir un fichier Lexique TSV','lexChoose','outline','',loadingLex?'disabled':'')+'</div>'+
    '<p><small><a href="'+LEXIQUE_URL+'" target="_blank" rel="noopener noreferrer">Télécharger le fichier TSV</a> pour une installation manuelle.</small></p></section>'+
    '<div class="stack"><section class="panel"><h2>Dictionnaire et stockage</h2><p>'+
    entries.size+' entrées sont intégrées dans les deux langues. Les autres recherches envoient le mot à l’édition du Wiktionnaire sélectionnée. Les résultats, livres, notes et révisions sont conservés dans ce navigateur.</p></section>'+
    '<section class="panel"><h2>Choisir le prochain rappel</h2><p>Au premier passage, les 5 niveaux correspondent à 10 min, 2 h, 10 h, 1 j et 3 j. Ensuite, le délai tient compte de vos réponses précédentes et du temps écoulé. Un oubli ramène la carte dans la séance si elle n’y est pas déjà revenue.</p>'+
    '<p><a href="https://aclanthology.org/P16-1174/" target="_blank" rel="noopener noreferrer">Settles et Meeder · modèle de demi-vie</a></p></section></div></div>';
}

function formatInterval(interval) {
  const minutes=Math.round(interval/60_000);
  const days=Math.floor(minutes/1_440);
  const hours=Math.floor((minutes%1_440)/60);
  const remainder=minutes%60;
  return [days&&days+' j',hours&&hours+' h',!days&&remainder&&remainder+' min'].filter(Boolean).join(' ');
}

function confidenceFeedback(card,confidence) {
  const label=CONFIDENCE_SCALE[confidence-1].label;
  const interval=formatInterval(reviewInterval(history(card.lemma),confidence));
  const retry=confidence===1&&!session.retries.has(card.lemma);
  return {label:confidence+' sur 5 · '+label,
    time:'Prochain rappel dans '+interval+(retry?' · Le mot revient aussi dans cette séance.':'.')};
}

function confidencePanel(card) {
  const confidence=session.confidence;
  const {label,time}=confidenceFeedback(card,confidence);
  return '<div class="confidence-panel"><div class="row confidence-heading">'+
    '<label for="confidence">À quel point vous souveniez-vous du mot ?</label><span id="confidenceValue">'+esc(label)+'</span></div>'+
    '<input type="range" id="confidence" min="1" max="'+CONFIDENCE_SCALE.length+'" step="1" value="'+confidence+
    '" aria-valuetext="'+esc(label)+'" aria-describedby="confidenceTime">'+
    '<div class="row confidence-ends" aria-hidden="true"><span>Oublié</span><span>Retrouvé immédiatement</span></div>'+
    '<div class="row confidence-footer"><output id="confidenceTime" for="confidence" aria-live="polite">'+esc(time)+'</output>'+
    button('Valider','schedule','primary')+'</div></div>';
}

function setConfidence(value) {
  if (!session?.answer || !Number.isInteger(value) || !CONFIDENCE_SCALE[value-1]) return;
  session.confidence=value;
  const slider=$('confidence');
  if (!slider) return;
  const {label,time}=confidenceFeedback(session.queue[session.index],value);
  slider.value=String(value);
  slider.setAttribute('aria-valuetext',label);
  $('confidenceValue').textContent=label;
  $('confidenceTime').textContent=time;
}

function sessionPage() {
  const card=session.queue[session.index];
  if (!card) return page('Séance terminée.','Vous avez évalué '+count(session.completed.size,'mot')+' pendant cette séance.')+
    '<a class="btn primary" href="#'+session.from+'">Retour aux '+(session.from==='review'?'révisions':'chapitres')+'</a>';
  const level=lex?bandOf(lex.ranks.get(card.lemma)):card.level;
  const quote='<blockquote lang="fr">« '+esc(card.sentence.slice(0,card.index))+'<mark>'+esc(card.form)+'</mark>'+
    esc(card.sentence.slice(card.index+card.form.length))+' »</blockquote>';
  return '<header class="row session-top"><a class="btn quiet" href="#'+session.from+'">← '+(session.from==='review'?'Révisions':'Chapitres')+
    '</a><span class="count">'+(session.index+1)+' / '+session.queue.length+'</span></header>'+
    '<div class="grid"><section class="panel flash"><div class="flash-meta">'+badge(level)+
    (TAGS[card.tag]?'<span>'+TAGS[card.tag]+'</span>':'')+(session.retries.has(card.lemma)?'<span>À revoir</span>':'')+'</div>'+
    '<h1 id="flashWord" lang="fr" tabindex="-1">'+esc(card.lemma)+'</h1><p>Essayez de reformuler le sens en français.</p>'+
    (session.hint||session.answer?'<div class="hint"><div class="eyebrow">Dans le livre</div>'+quote+
      '<cite lang="fr">'+esc(card.title)+' · '+esc(card.chapter)+'</cite>'+
      (voiceAvailable()?'<div class="actions">'+button('Écouter la phrase','speakContext','quiet')+
      '<small id="contextVoice" role="status"></small></div>':'')+'</div>':'')+
    (session.answer?confidencePanel(card)+'<div class="answer"><div class="eyebrow">Dictionnaire</div>'+languagePicker()+
      '<div class="entry" id="entry" aria-live="polite" data-word="'+esc(card.lemma)+'"></div>'+
      '<form id="noteForm"><label for="note">Votre définition ou votre note</label><div class="formrow"><input id="note" maxlength="280" value="'+
      esc(own(state.notes,card.lemma)||'')+'"><button type="submit" class="btn outline">Enregistrer</button></div><small id="noteStatus" role="status"></small></form></div>':'')+
    (session.answer?'':'<div class="actions flash-buttons">'+
      (session.hint?'':button('Voir la phrase','hint','outline','','aria-keyshortcuts="H"'))+
      button('Voir la définition','answer','primary')+'</div>')+
    '</section><aside class="panel review-panel"><div class="eyebrow">'+(session.from==='review'?'Révision espacée':'Vocabulaire du chapitre')+
    '</div><h2 lang="fr">'+esc(card.chapter)+'</h2><p lang="fr">'+esc(card.title)+'</p></aside></div>';
}

function render() {
  $('dueCount').textContent=dueReviews().length;
  $('resume').hidden=view==='session'||!session||session.index>=session.queue.length;
  for (const tab of document.querySelectorAll('[data-tab]')) {
    if (tab.dataset.tab===view||view==='session'&&tab.dataset.tab===session.from) tab.setAttribute('aria-current','page');
    else tab.removeAttribute('aria-current');
  }
  $('shelf').innerHTML=allBooks().map(book=>button('<i class="shelf-dot" aria-hidden="true"></i><span lang="fr">'+esc(book.title)+'</span>',
    'book',book.id===currentBook().id?'current':'',book.id)).join('');
  $('app').innerHTML=({chapters:chaptersPage,dictionary:dictionaryPage,review:reviewPage,frontier:frontierPage,method:methodPage,session:sessionPage}[view])();
  void fillEntry();
}

function show(next,replace=false) {
  view=next;
  const hash='#'+next;
  if (location.hash!==hash) {
    if (location.protocol==='file:') {
      if (replace) location.replace(hash);else location.hash=hash;
    } else if (replace) window.history.replaceState(null,'',hash);
    else window.history.pushState(null,'',hash);
  }
  render();
  window.scrollTo(0,0);
  $('main').focus({preventScroll:true});
}
function route() {
  const name=location.hash.slice(1);
  show(name==='session'&&session||tabs.includes(name)?name:home,true);
}
function start(cards,from) {
  if (!cards.length) return;
  session={queue:cards.slice(0,20),index:0,hint:false,answer:false,language:FRENCH,
    confidence:DEFAULT_CONFIDENCE,from,retries:new Set(),completed:new Set()};
  show('session');$('flashWord')?.focus({preventScroll:true});
}
function record() {
  const card=session?.queue[session.index];
  if (!card||!session.answer) return;
  const confidence=session.confidence;
  state.reviews[card.lemma]=grade(card,history(card.lemma),confidence);
  session.completed.add(card.lemma);
  if (confidence===1&&!session.retries.has(card.lemma)) {
    session.retries.add(card.lemma);
    session.queue.splice(Math.min(session.index+3,session.queue.length),0,card);
  }
  session.index++;session.hint=false;session.answer=false;
  session.confidence=DEFAULT_CONFIDENCE;session.language=FRENCH;
  save();show('session');$('flashWord')?.focus({preventScroll:true});
}
function search(word) {
  searched=word;
  lookupLanguage=FRENCH;
  state.recent=[word,...state.recent.filter(value=>value!==word)].slice(0,7);
  save();
  if(view==='dictionary') {
    render();
    $('term').focus({preventScroll:true});
  } else show('dictionary');
}
async function installLexique(file) {
  if (loadingLex) return;
  loadingLex=true;lexStatus=file?'Lecture des fréquences…':'Téléchargement de Lexique…';render();
  try {
    let text;
    if (file) {
      if (file.size>42e6) throw Error('Choisissez le fichier Lexique383.tsv décompressé.');
      text=await file.text();
    } else {
      for (const url of [LEXIQUE_URL,LEXIQUE_MIRROR]) {
        try {
          const raw=await fetchText(url,30000);
          if (raw.replace(/^\uFEFF/,'').startsWith('ortho\t')) {text=raw;break;}
        } catch { /* Try the next source. */ }
      }
      if (!text) throw Error('Le téléchargement automatique a échoué. Téléchargez le fichier TSV, puis sélectionnez-le ici.');
    }
    lexStatus='Indexation des formes et fréquences…';render();
    await new Promise(resolve=>setTimeout(resolve,0));
    lex=await parseLexique(text);analyses=new WeakMap();
    lexStatus=lex.ranks.size.toLocaleString('fr-FR')+' formes de base classées.';
    try {await write(keys.lex,lex);}catch {lexStatus+=' Le navigateur n’a pas pu enregistrer Lexique. Il reste disponible pendant cette séance.';}
  } catch (error) {lexStatus=error.message;}
  finally {loadingLex=false;render();}
}
const voiceAvailable=()=> 'speechSynthesis' in window&&'SpeechSynthesisUtterance' in window;
function speak(word,status=$('entry')?.querySelector('.voice-status')) {
  const voices=speechSynthesis.getVoices();
  const voice=voices.find(v=>v.lang.toLowerCase()==='fr-fr')||voices.find(v=>/^fr\b/i.test(v.lang));
  if (voices.length&&!voice) {
    if(status) status.textContent='Aucune voix française n’est disponible sur cet appareil.';
    return;
  }
  const utterance=new SpeechSynthesisUtterance(word);
  utterance.lang='fr-FR';
  if (voice) utterance.voice=voice;
  if (status) utterance.onerror=()=>{status.textContent='La voix de l’appareil n’a pas pu lire ce texte.';};
  speechSynthesis.cancel();speechSynthesis.speak(utterance);
}

function action(name,value) {
  if (name==='import') {$('importError').textContent='';$('importDialog').showModal();return;}
  if (name==='cancel') {$('importDialog').close();return;}
  if (name==='frontierBand') {
    frontierBand=value;
    frontierQuery='';
    render();focusFrontierControl(name,value);return;
  }
  if (name==='frontierWord') {
    const item=frontierData.words.get(value);
    if (!item) return;
    if (frontierBand!==item.level) frontierQuery='';
    frontierBand=item.level;
    frontierWord=item.word;
    render();$('frontierSelection')?.focus();return;
  }
  if (name==='frontierOverride') {
    if (!frontierWord) return;
    if (value) state.frontierOverrides[frontierWord]=value;
    else delete state.frontierOverrides[frontierWord];
    save();render();focusFrontierControl(name,value);return;
  }
  if (name==='lookup') {search(value);return;}
  if (name==='retry') {void fillEntry();return;}
  if (name==='language') {
    const language=value==='en'?'en':FRENCH;
    if (view==='session'&&session) session.language=language;
    else lookupLanguage=language;
    for (const toggle of document.querySelectorAll('[data-action=language]')) {
      toggle.setAttribute('aria-pressed',String(toggle.dataset.value===language));
    }
    void fillEntry();
    document.querySelector('[data-action=language][aria-pressed=true]')?.focus();return;
  }
  if (name==='speak') {speak(value);return;}
  if (name==='speakContext') {speak(session.queue[session.index].sentence,$('contextVoice'));return;}
  if (name==='resume'&&session) {show('session');return;}
  if (name==='book') {state.selected=value;state.chapter=0;state.level='all';previewLimit=8;save();show('chapters');return;}
  if (name==='chapter') {
    state.chapter=Number(value);previewLimit=8;save();render();
    document.querySelector('.chapter.current')?.focus({preventScroll:true});return;
  }
  if (name==='expand') {previewLimit=previewLimit===8?120:8;render();document.querySelector('[data-action=expand]')?.focus();return;}
  if (name==='practice') {start(availableCards(chapterCards()),'chapters');return;}
  if (name==='reviewNow') {start(dueReviews().map(entry=>entry.card),'review');return;}
  if (name==='hint'||name==='answer') {
    if (!session?.queue[session.index]) return;
    session[name]=true;render();
    document.querySelector(name==='hint'?'[data-action=answer]':'#flashWord')?.focus({preventScroll:true});return;
  }
  if (name==='schedule') {record();return;}
  if (name==='lexLoad') {void installLexique();return;}
  if (name==='lexChoose') $('lexFile').click();
}
document.addEventListener('click',event=>{
  const control=event.target.closest('[data-action]');
  if (control&&!control.disabled) action(control.dataset.action,control.dataset.value);
});
document.addEventListener('input',event=>{
  if (event.target.id==='confidence') setConfidence(Number(event.target.value));
  if (event.target.id==='frontierQuery') {
    frontierQuery=event.target.value;
    $('frontierWords').innerHTML=frontierWordList();
  }
});
document.addEventListener('change',event=>{
  if (event.target.id==='frontierReference') {
    state.frontierReference=event.target.value;
    save();render();$('frontierReference').focus();
  }
  if (event.target.id==='level') {state.level=event.target.value;previewLimit=8;save();render();$('level').focus();}
  if (event.target.id==='lexFile'&&event.target.files[0]) {
    const file=event.target.files[0];event.target.value='';void installLexique(file);
  }
});
async function decodeBook(file) {
  const bytes=new Uint8Array(await file.arrayBuffer());
  if (bytes[0]===255&&bytes[1]===254) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0]===254&&bytes[1]===255) return new TextDecoder('utf-16be').decode(bytes);
  try {return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch {return new TextDecoder('windows-1252').decode(bytes);}
}
document.addEventListener('submit',async event=>{
  const form=event.target;
  if (!['lookupForm','importForm','noteForm'].includes(form.id)) return;
  event.preventDefault();
  if (form.id==='lookupForm') {
    const term=$('term').value.trim().normalize('NFC').replace(/\s+/g,' ').replaceAll('’',"'");
    if (!/^[\p{L}][\p{L}\p{M}\p{N}' .-]{0,99}$/u.test(term)) {
      $('lookupError').textContent='Saisissez un mot ou une expression en français.';return;
    }
    search(term);return;
  }
  if (form.id==='noteForm') {
    state.notes[session.queue[session.index].lemma]=$('note').value.trim();
    save();$('noteStatus').textContent='Enregistré';return;
  }
  const file=$('bookFile').files[0], pasted=$('bookText').value.trim(), submit=form.querySelector('[type=submit]');
  $('importError').textContent='';submit.disabled=true;
  try {
    if (!file&&!pasted) throw Error('Choisissez un fichier ou collez le texte.');
    if ((pasted?pasted.length:file.size)>3e6) throw Error('Choisissez un livre de moins de 3 Mo.');
    const result=parseBook(pasted||await decodeBook(file));
    if (!result.chapters.length) throw Error('Aucun texte lisible n’a été trouvé.');
    const title=$('bookTitle').value.trim()||result.title||file?.name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ')||'Livre sans titre';
    const book={id:'book-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),title:title.slice(0,120),chapters:result.chapters};
    state.books.push(book);state.selected=book.id;state.chapter=0;state.level='all';previewLimit=8;
    form.reset();$('importDialog').close();save();show('chapters');
    if (!lex&&navigator.onLine!==false) void installLexique();
  } catch (error) {$('importError').textContent=error.message;}
  finally {submit.disabled=false;}
});
document.addEventListener('keydown',event=>{
  const radarWord=view==='frontier'&&event.target.closest('svg [data-action="frontierWord"]');
  if (radarWord&&(event.key==='Enter'||event.key===' ')) {
    event.preventDefault();action('frontierWord',radarWord.dataset.value);return;
  }
  if (view!=='session'||!session?.queue[session.index]||event.altKey||event.ctrlKey||event.metaKey||
    event.repeat||event.target.matches('input,textarea,select,[contenteditable]')) return;
  if (/^[1-5]$/.test(event.key)&&session.answer) {event.preventDefault();setConfidence(Number(event.key));}
  else if (event.key.toLowerCase()==='h'&&!session.hint&&!session.answer) {event.preventDefault();action('hint');}
});
window.addEventListener('hashchange',route);
setInterval(()=>{
  const ready=String(dueReviews().length);
  if ($('dueCount').textContent===ready) return;
  $('dueCount').textContent=ready;
  if ((view==='review'||view==='chapters')&&!document.activeElement?.closest('#app button,#app input,#app select')) render();
},15000);
async function boot() {
  let restored;
  try {restored=await read(keys.state);}catch { /* Try local storage below. */ }
  if (!restored) {
    try {restored=JSON.parse(localStorage.getItem(keys.state));}catch { /* New or unavailable local storage. */ }
  }
  state={...defaults,...(restored||{})};
  route();
  if (!portable&&'serviceWorker' in navigator) void navigator.serviceWorker.register('sw.js').catch(()=>{});
  try {
    const savedLexique=await read(keys.lex);
    if (!savedLexique||lex) return;
    lex=savedLexique;
    analyses=new WeakMap();
    if (view==='chapters'||view==='method') render();
  } catch { /* The dictionary and sample book are ready without frequency data. */ }
}
void boot();
