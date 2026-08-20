/*
 * Read Aloud -- manuscript & document proofreading engine
 * Copyright (c) 2026 Ogunlana Akinola Okikiola. All rights reserved.
 *
 * This source is visible because it runs in your browser -- that is
 * unavoidable for any client-side tool. Viewing it is fine. Copying,
 * redistributing, or reselling it (in whole or substantially modified
 * form) without written permission is not. See /LICENSE.txt.
 */


/* ============================================================
   FEATURE DETECTION / COMPATIBILITY PANEL
   ============================================================ */
const compat = {
  fileReading: typeof FileReader !== 'undefined',
  arrayBuffer: typeof ArrayBuffer !== 'undefined',
  speech: 'speechSynthesis' in window,
  mammoth: false,
  pdfjs: false,
  jszip: false
};

function renderCompatPanel(){
  const rows = document.getElementById('compatRows');
  const items = [
    {label: 'Read files from your device', ok: compat.fileReading},
    {label: 'Word (.docx) parsing library loaded', ok: compat.mammoth, warnIfFalse:true},
    {label: 'PDF parsing library loaded', ok: compat.pdfjs, warnIfFalse:true},
    {label: 'EPUB parsing library loaded', ok: compat.jszip, warnIfFalse:true},
    {label: 'Text-to-speech (Web Speech API)', ok: compat.speech},
  ];
  rows.innerHTML = items.map(it => {
    const cls = it.ok ? 'ok' : (it.warnIfFalse ? 'warn' : 'bad');
    const msg = it.ok ? 'Available' : (it.warnIfFalse ? 'Still loading / unavailable — that format will be disabled' : 'Not supported in this browser');
    return `<div class="compat-row"><span class="dot ${cls}"></span><span>${it.label} — <strong>${msg}</strong></span></div>`;
  }).join('');
}
renderCompatPanel();

window.addEventListener('load', () => {
  setTimeout(() => {
    compat.mammoth = (typeof mammoth !== 'undefined');
    compat.pdfjs = (typeof pdfjsLib !== 'undefined');
    compat.jszip = (typeof JSZip !== 'undefined');
    if(compat.pdfjs){
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    renderCompatPanel();
  }, 600);
});

/* ============================================================
   PARSING: turn any supported file into SECTIONS[] of BLOCKS[]
   Each block: {type: 'p'|'h3', text: plain string, html: display string}
   ============================================================ */

function escapeHtml(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Split any long block into TTS-safe chunks at sentence boundaries.
// Long utterances are a known reliability issue across speech engines.
function splitLongText(text, maxChars){
  maxChars = maxChars || 320;
  if(text.length <= maxChars) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [text];
  const chunks = [];
  let buf = '';
  for(const s of sentences){
    if((buf + s).length > maxChars && buf){
      chunks.push(buf.trim());
      buf = s;
    } else {
      buf += s;
    }
  }
  if(buf.trim()) chunks.push(buf.trim());
  return chunks.length ? chunks : [text];
}

function expandBlocks(blocks){
  const out = [];
  for(const b of blocks){
    if(b.type === 'h3' || b.text.length <= 320){
      out.push(b);
    } else {
      for(const piece of splitLongText(b.text, 320)){
        out.push({type:'p', text:piece, html: escapeHtml(piece)});
      }
    }
  }
  return out;
}

function parsePlainText(raw, isMarkdown, filename){
  const lines = raw.split(/\r?\n/);
  const sections = [];
  let curTitle = null;
  let curBlocks = [];
  let paraBuf = [];

  function flushPara(){
    if(paraBuf.length){
      const text = paraBuf.join(' ').trim();
      if(text){
        let html = escapeHtml(text);
        if(isMarkdown){
          html = html.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>');
        }
        curBlocks.push({type:'p', text, html});
      }
      paraBuf = [];
    }
  }
  function flushSection(){
    flushPara();
    if(curBlocks.length || curTitle){
      sections.push({title: curTitle || filename, blocks: expandBlocks(curBlocks)});
    }
    curBlocks = [];
  }

  for(const raw_line of lines){
    const line = raw_line.trim();
    if(line === ''){ flushPara(); continue; }
    if(isMarkdown && /^#{1,2}\s+/.test(line)){
      flushSection();
      curTitle = line.replace(/^#{1,2}\s+/, '');
      continue;
    }
    if(isMarkdown && /^\*\*.+\*\*$/.test(line)){
      flushPara();
      const heading = line.slice(2,-2);
      curBlocks.push({type:'h3', text: heading + '.', html: escapeHtml(heading)});
      continue;
    }
    paraBuf.push(line);
  }
  flushSection();

  if(sections.length === 0){
    sections.push({title: filename, blocks: []});
  }
  return sections;
}

function parseDocxHtml(htmlString, filename){
  const doc = new DOMParser().parseFromString(htmlString, 'text/html');
  const nodes = Array.from(doc.body.children);
  const sections = [];
  let curTitle = null;
  let curBlocks = [];

  function flushSection(){
    if(curBlocks.length || curTitle){
      sections.push({title: curTitle || filename, blocks: expandBlocks(curBlocks)});
    }
    curBlocks = [];
  }

  for(const node of nodes){
    const tag = node.tagName.toLowerCase();
    const text = node.textContent.trim();
    if(!text) continue;
    if(tag === 'h1'){
      flushSection();
      curTitle = text;
      continue;
    }
    if(tag === 'h2' || tag === 'h3'){
      curBlocks.push({type:'h3', text: text + '.', html: escapeHtml(text)});
      continue;
    }
    if(tag === 'p' || tag === 'li'){
      curBlocks.push({type:'p', text, html: node.innerHTML});
      continue;
    }
    // fallback: any other block-level element with text
    curBlocks.push({type:'p', text, html: escapeHtml(text)});
  }
  flushSection();

  if(sections.length === 0){
    sections.push({title: filename, blocks: []});
  }
  return sections;
}

async function parsePdf(arrayBuffer, filename){
  const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
  const sections = [];
  for(let i = 1; i <= pdf.numPages; i++){
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(it => it.str).join(' ').replace(/\s+/g,' ').trim();
    if(!text) continue;
    const blocks = expandBlocks(text.length ? [{type:'p', text, html: escapeHtml(text)}] : []);
    sections.push({title: `${filename} — Page ${i}`, blocks});
  }
  if(sections.length === 0){
    sections.push({title: filename, blocks: [{type:'p', text:'No extractable text was found on any page of this PDF (it may be a scanned image).', html:'No extractable text was found on any page of this PDF (it may be a scanned image).'}]});
  }
  return sections;
}

async function parseEpub(arrayBuffer, filename){
  const zip = await JSZip.loadAsync(arrayBuffer);

  const containerFile = zip.file('META-INF/container.xml');
  if(!containerFile) throw new Error('This file is missing META-INF/container.xml, so it doesn\'t look like a valid EPUB.');
  const containerXml = await containerFile.async('string');
  const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
  const opfPath = containerDoc.querySelector('rootfile').getAttribute('full-path');
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

  const opfFile = zip.file(opfPath);
  if(!opfFile) throw new Error('Could not find the EPUB package file (content.opf).');
  const opfXml = await opfFile.async('string');
  const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');

  const manifest = {};
  opfDoc.querySelectorAll('manifest > item').forEach(item => {
    manifest[item.getAttribute('id')] = item.getAttribute('href');
  });
  const spineIds = Array.from(opfDoc.querySelectorAll('spine > itemref')).map(el => el.getAttribute('idref'));

  const sections = [];
  for(const id of spineIds){
    const href = manifest[id];
    if(!href) continue;
    const fullPath = opfDir + href;
    const itemFile = zip.file(fullPath) || zip.file(decodeURIComponent(fullPath));
    if(!itemFile) continue;
    const xhtml = await itemFile.async('string');
    const doc = new DOMParser().parseFromString(xhtml, 'text/html');
    const bodyNodes = Array.from(doc.body ? doc.body.querySelectorAll('h1,h2,h3,p,li') : []);
    if(bodyNodes.length === 0) continue;

    let title = null;
    const blocks = [];
    for(const node of bodyNodes){
      const text = node.textContent.trim();
      if(!text) continue;
      const tag = node.tagName.toLowerCase();
      if(tag === 'h1' && !title){
        title = text;
        continue;
      }
      if(tag === 'h1' || tag === 'h2' || tag === 'h3'){
        blocks.push({type:'h3', text: text + '.', html: escapeHtml(text)});
      } else {
        blocks.push({type:'p', text, html: node.innerHTML});
      }
    }
    if(!title){
      title = href.replace(/\.(x?html?)$/i, '').replace(/[_-]/g,' ');
    }
    if(blocks.length > 0){
      sections.push({title, blocks: expandBlocks(blocks)});
    }
  }

  if(sections.length === 0){
    throw new Error('No readable text sections were found in this EPUB\'s spine.');
  }
  return sections;
}

/* ============================================================
   FILE HANDLING
   ============================================================ */
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const errorBox = document.getElementById('errorBox');
const parsingBox = document.getElementById('parsingBox');
const parsingMsg = document.getElementById('parsingMsg');

function showError(msg){
  errorBox.textContent = msg;
  errorBox.style.display = 'block';
}
function clearError(){ errorBox.style.display = 'none'; }
function showParsing(msg){
  parsingMsg.textContent = msg;
  parsingBox.style.display = 'flex';
}
function hideParsing(){ parsingBox.style.display = 'none'; }

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  if(e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', e => {
  if(e.target.files.length) handleFile(e.target.files[0]);
});

async function handleFile(file){
  clearError();
  const name = file.name;
  const ext = name.split('.').pop().toLowerCase();
  const baseName = name.replace(/\.[^.]+$/, '');

  try{
    if(ext === 'txt'){
      showParsing('Reading text file…');
      const text = await file.text();
      const sections = parsePlainText(text, false, baseName);
      hideParsing();
      loadDocument(baseName, sections);

    } else if(ext === 'md' || ext === 'markdown'){
      showParsing('Reading markdown file…');
      const text = await file.text();
      const sections = parsePlainText(text, true, baseName);
      hideParsing();
      loadDocument(baseName, sections);

    } else if(ext === 'docx'){
      if(typeof mammoth === 'undefined'){
        showError('The Word-document parser hasn\'t finished loading (or failed to load — check your internet connection). Please wait a moment and try again.');
        return;
      }
      showParsing('Converting Word document…');
      const buf = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({arrayBuffer: buf});
      const sections = parseDocxHtml(result.value, baseName);
      hideParsing();
      loadDocument(baseName, sections);

    } else if(ext === 'pdf'){
      if(typeof pdfjsLib === 'undefined'){
        showError('The PDF parser hasn\'t finished loading (or failed to load — check your internet connection). Please wait a moment and try again.');
        return;
      }
      showParsing('Extracting text from PDF (this can take a moment for long files)…');
      const buf = await file.arrayBuffer();
      const sections = await parsePdf(buf, baseName);
      hideParsing();
      loadDocument(baseName, sections);

    } else if(ext === 'epub'){
      if(typeof JSZip === 'undefined'){
        showError('The EPUB parser hasn\'t finished loading (or failed to load — check your internet connection). Please wait a moment and try again.');
        return;
      }
      showParsing('Unpacking EPUB…');
      const buf = await file.arrayBuffer();
      const sections = await parseEpub(buf, baseName);
      hideParsing();
      loadDocument(baseName, sections);

    } else {
      showError(`".${ext}" isn't supported yet. Try .txt, .md, .docx, .pdf, or .epub.`);
    }
  } catch(err){
    hideParsing();
    showError('Could not read this file: ' + (err && err.message ? err.message : 'unknown error') + '. If this is a scanned PDF or a corrupted file, that may be why.');
    console.error(err);
  }
}

/* ============================================================
   READER (same engine as before, now fed by any parsed document)
   ============================================================ */
let DOC_TITLE = '';
let SECTIONS = [];
let currentSection = 0;
let currentBlock = -1;
let isPlaying = false;
let voices = [];
let finishedSections = new Set();
let flaggedIssues = [];

const uploadScreen = document.getElementById('uploadScreen');
const appEl = document.getElementById('app');
const playbar = document.getElementById('playbar');
const chapterListEl = document.getElementById('chapterList');
const readingInner = document.getElementById('readingInner');
const docTitleLabel = document.getElementById('docTitleLabel');
const btnPlay = document.getElementById('btnPlay');
const iconPlay = document.getElementById('iconPlay');
const iconPause = document.getElementById('iconPause');
const progressFill = document.getElementById('progressFill');
const progressPct = document.getElementById('progressPct');
const nowReading = document.getElementById('nowReading');
const pulseDot = document.getElementById('pulseDot');
const speedSelect = document.getElementById('speedSelect');
const voiceSelect = document.getElementById('voiceSelect');
const sidebarFooter = document.getElementById('sidebarFooter');

function loadDocument(title, sections){
  DOC_TITLE = title;
  SECTIONS = sections.filter(s => s.blocks.length > 0 || s.title);
  currentSection = 0;
  currentBlock = -1;
  finishedSections = new Set();

  uploadScreen.style.display = 'none';
  appEl.classList.add('active');
  playbar.classList.add('active');

  docTitleLabel.textContent = title;
  const totalWords = SECTIONS.reduce((sum, s) => sum + s.blocks.reduce((a,b)=>a+b.text.split(' ').length,0), 0);
  sidebarFooter.textContent = SECTIONS.length + ' section' + (SECTIONS.length===1?'':'s') + ' · ~' + totalWords.toLocaleString() + ' words';

  renderSectionList();
  loadSection(0, true);
}

function resetToUpload(){
  stopSpeaking();
  appEl.classList.remove('active');
  playbar.classList.remove('active');
  uploadScreen.style.display = 'block';
  fileInput.value = '';
  clearError();
}
document.getElementById('btnNewFile').onclick = resetToUpload;

function renderSectionList(){
  chapterListEl.innerHTML = '';
  SECTIONS.forEach((s, i) => {
    const item = document.createElement('div');
    const wc = s.blocks.reduce((a,b)=>a+b.text.split(' ').length,0);
    item.className = 'chapter-item' + (i===currentSection ? ' active' : '') + (finishedSections.has(i) ? ' done' : '');
    item.innerHTML = `
      <span class="chapter-num">${String(i+1).padStart(2,'0')}</span>
      <div>
        <div class="chapter-name">${s.title}</div>
        <div class="chapter-words">${wc.toLocaleString()} words</div>
      </div>`;
    item.onclick = () => loadSection(i, true);
    chapterListEl.appendChild(item);
  });
}

function renderSectionText(){
  const s = SECTIONS[currentSection];
  readingInner.innerHTML = `<div class="doc-title">${DOC_TITLE}</div><h2 class="chapter-heading">${s.title}</h2>`;
  if(s.blocks.length === 0){
    const empty = document.createElement('p');
    empty.className = 'block';
    empty.textContent = '(No readable text found in this section.)';
    readingInner.appendChild(empty);
    return;
  }
  s.blocks.forEach((b, i) => {
    const el = document.createElement(b.type === 'h3' ? 'h3' : 'p');
    el.className = 'block';
    el.id = 'block-' + i;
    el.innerHTML = b.html;
    readingInner.appendChild(el);
  });
}

function loadSection(idx, scrollTop){
  stopSpeaking();
  currentSection = idx;
  currentBlock = -1;
  renderSectionList();
  renderSectionText();
  updateProgress();
  if(scrollTop) window.scrollTo({top:0, behavior:'instant'});
}

function updateProgress(){
  const s = SECTIONS[currentSection];
  const pct = (currentBlock < 0 || s.blocks.length===0) ? 0 : Math.round(((currentBlock+1)/s.blocks.length)*100);
  progressFill.style.width = pct + '%';
  progressPct.textContent = pct + '%';
  nowReading.textContent = s.title;
  const track = document.getElementById('progressTrack');
  if(track) track.setAttribute('aria-valuenow', pct);
}

function announce(msg){
  const el = document.getElementById('srStatus');
  if(el) el.textContent = msg;
}

function highlightBlock(idx){
  document.querySelectorAll('.block').forEach(el => el.classList.remove('reading'));
  document.querySelectorAll('.block').forEach((el,i) => {
    if(i < idx) el.classList.add('spoken'); else el.classList.remove('spoken');
  });
  const el = document.getElementById('block-' + idx);
  if(el){ el.classList.add('reading'); el.scrollIntoView({behavior:'smooth', block:'center'}); }
}

function populateVoices(){
  if(!compat.speech) return;
  voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
  if(voices.length === 0) voices = speechSynthesis.getVoices();
  voiceSelect.innerHTML = '';
  voices.forEach((v, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = v.name + (v.lang ? ' (' + v.lang + ')' : '');
    voiceSelect.appendChild(opt);
  });
  if(voices.length === 0){
    const opt = document.createElement('option');
    opt.textContent = 'No voices available';
    voiceSelect.appendChild(opt);
  }
}

function speakFrom(blockIdx){
  const s = SECTIONS[currentSection];
  if(blockIdx >= s.blocks.length){
    finishedSections.add(currentSection);
    renderSectionList();
    if(currentSection < SECTIONS.length - 1){
      loadSection(currentSection + 1, true);
      setTimeout(()=> speakFrom(0), 300);
    } else {
      setPlayingUI(false);
    }
    return;
  }
  currentBlock = blockIdx;
  highlightBlock(blockIdx);
  updateProgress();

  const block = s.blocks[blockIdx];
  const utter = new SpeechSynthesisUtterance(block.text);
  utter.rate = parseFloat(speedSelect.value);
  utter.pitch = 1;
  const vIdx = voiceSelect.value;
  if(voices[vIdx]) utter.voice = voices[vIdx];
  utter.onend = () => { if(isPlaying) speakFrom(blockIdx + 1); };
  utter.onerror = () => { if(isPlaying) speakFrom(blockIdx + 1); };
  speechSynthesis.speak(utter);
}

function setPlayingUI(playing){
  isPlaying = playing;
  iconPlay.style.display = playing ? 'none' : 'block';
  iconPause.style.display = playing ? 'block' : 'none';
  pulseDot.classList.toggle('live', playing);
  btnPlay.setAttribute('aria-pressed', playing ? 'true' : 'false');
  announce(playing ? 'Playing' : 'Paused');
}

function play(){
  if(!compat.speech) return;
  if(speechSynthesis.paused && speechSynthesis.speaking){
    speechSynthesis.resume(); setPlayingUI(true); return;
  }
  setPlayingUI(true);
  speakFrom(currentBlock < 0 ? 0 : currentBlock);
}
function pause(){ try{ speechSynthesis.pause(); }catch(e){} setPlayingUI(false); }
function stopSpeaking(){ try{ speechSynthesis.cancel(); }catch(e){} setPlayingUI(false); }

btnPlay.onclick = () => { if(isPlaying){ pause(); } else { play(); } };
if(!compat.speech){ btnPlay.disabled = true; }

document.getElementById('btnNext').onclick = () => { if(currentSection < SECTIONS.length - 1) loadSection(currentSection + 1, true); };
document.getElementById('btnPrev').onclick = () => { if(currentSection > 0) loadSection(currentSection - 1, true); };
document.getElementById('btnFwd15').onclick = () => {
  stopSpeaking();
  const s = SECTIONS[currentSection];
  const nextIdx = Math.min(currentBlock + 1, s.blocks.length - 1);
  currentBlock = nextIdx; highlightBlock(nextIdx); updateProgress();
};
document.getElementById('btnBack15').onclick = () => {
  stopSpeaking();
  const prevIdx = Math.max(currentBlock - 1, 0);
  currentBlock = prevIdx; highlightBlock(prevIdx); updateProgress();
};
readingInner.addEventListener('click', (e) => {
  const block = e.target.closest('.block');
  if(!block) return;
  const idx = parseInt(block.id.replace('block-',''));
  stopSpeaking();
  currentBlock = idx; highlightBlock(idx); updateProgress();
  if(isPlaying) play();
});

document.getElementById('btnFlag').onclick = () => flagCurrentBlock();

function flagCurrentBlock(){
  if(currentBlock < 0) return;
  const s = SECTIONS[currentSection];
  const block = s.blocks[currentBlock];
  if(!block) return;
  flaggedIssues.push({section: s.title, text: block.text});
  const el = document.getElementById('block-' + currentBlock);
  if(el) el.classList.add('flagged');
  const badge = document.getElementById('flagBadge');
  if(badge){ badge.textContent = flaggedIssues.length; badge.classList.add('show'); }
  const exportLink = document.getElementById('exportLink');
  const flagCount = document.getElementById('flagCount');
  if(exportLink){ exportLink.style.display = 'inline-block'; flagCount.textContent = flaggedIssues.length; }
  announce('Flagged. ' + flaggedIssues.length + ' line' + (flaggedIssues.length===1?'':'s') + ' flagged so far.');
}

document.getElementById('exportLink').onclick = () => {
  if(flaggedIssues.length === 0) return;
  let out = `Flagged lines — ${DOC_TITLE}\nExported ${new Date().toLocaleString()}\n\n`;
  flaggedIssues.forEach((f, i) => {
    out += `${i+1}. [${f.section}]\n${f.text}\n\n`;
  });
  const blob = new Blob([out], {type: 'text/plain'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (DOC_TITLE || 'document').replace(/[^a-z0-9]+/gi,'_') + '_flagged_lines.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

document.addEventListener('keydown', (e) => {
  if(!appEl.classList.contains('active')) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if(tag === 'select' || tag === 'input' || tag === 'textarea') return;

  if(e.code === 'Space'){
    e.preventDefault();
    if(isPlaying) pause(); else play();
  } else if(e.code === 'ArrowRight'){
    e.preventDefault();
    document.getElementById('btnFwd15').click();
  } else if(e.code === 'ArrowLeft'){
    e.preventDefault();
    document.getElementById('btnBack15').click();
  } else if(e.code === 'ArrowDown'){
    e.preventDefault();
    document.getElementById('btnNext').click();
  } else if(e.code === 'ArrowUp'){
    e.preventDefault();
    document.getElementById('btnPrev').click();
  } else if(e.key === 'f' || e.key === 'F'){
    e.preventDefault();
    flagCurrentBlock();
  }
});

if(compat.speech){
  speechSynthesis.onvoiceschanged = populateVoices;
  populateVoices();
}

const yearEl = document.getElementById('yearNow');
if(yearEl) yearEl.textContent = new Date().getFullYear();
