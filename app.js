/* Studia — aplikasi belajar lokal, dengan dukungan API AI opsional di server.js. */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const DB_NAME = 'studia-study-space';
  const DB_VERSION = 1;
  const DB_STORE = 'app-state';
  const STATE_KEY = 'main';
  const MAX_FILE_BYTES = 12 * 1024 * 1024;
  let db = null;
  let pendingFile = null;
  let state = {
    materials: [],
    sessions: 0,
    questionsDone: 0,
    dailySessions: 0,
    lastStudyDate: '',
    flashcardsGenerated: 0,
    flashcardSets: [],
    learnedCards: 0,
    lastVisit: new Date().toISOString()
  };
  let quizState = null;
  let flashState = null;

  const stopWords = new Set(('yang dan di ke dari untuk dengan pada adalah atau sebagai dalam ini itu juga akan dapat bisa oleh karena tidak lebih suatu para terhadap secara maka jika namun yaitu telah menjadi saat agar tentang antara melalui setiap beberapa sangat sebuah punya suatu yakni bagian materi teori konsep terhadap menurut digunakan disebut termasuk terkait memiliki terjadi manusia sistem proses hasil tujuan utama bentuk contoh seperti sebab akibat pertama kedua ketiga ketika setelah sebelum atas bawah dalam dari pada akan sebagai bisa dilakukan membuat digunakan hubungan penelitian menunjukkan menjelaskan perkembangan kebijakan masyarakat negara internasional mahasiswa mata kuliah').split(/\s+/));

  function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
  function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function escapeHTML(value = '') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function trimText(text, max = 180) { const clean = String(text || '').replace(/\s+/g, ' ').trim(); return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean; }
  function toast(message, type = 'success') {
    const el = document.createElement('div'); el.className = `toast ${type}`; el.textContent = message;
    $('#toastRegion').appendChild(el); setTimeout(() => el.remove(), 4200);
  }
  function openDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB tidak tersedia'));
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Tidak bisa membuka database lokal'));
    });
  }
  async function loadState() {
    try {
      db = await openDB();
      const saved = await new Promise((resolve, reject) => {
        const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(STATE_KEY);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      if (saved && Array.isArray(saved.materials)) state = { ...state, ...saved };
      return;
    } catch (error) {
      try { const fallback = JSON.parse(localStorage.getItem('studia-state') || 'null'); if (fallback && Array.isArray(fallback.materials)) state = { ...state, ...fallback }; }
      catch { /* Fresh state */ }
    }
  }
  async function saveState() {
    state.lastVisit = new Date().toISOString();
    if (db) {
      try { await new Promise((resolve, reject) => { const tx = db.transaction(DB_STORE, 'readwrite'); tx.objectStore(DB_STORE).put(state, STATE_KEY); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); return; }
      catch (error) { console.warn('IndexedDB write failed; using localStorage.', error); }
    }
    try { localStorage.setItem('studia-state', JSON.stringify(state)); }
    catch { toast('Penyimpanan browser hampir penuh. Hapus sebagian foto atau ekspor cadangan.', 'error'); }
  }
  function typeInfo(material) {
    const kind = material.kind || 'title';
    const ext = (material.fileName || '').split('.').pop().toLowerCase();
    if (kind === 'link') return { label: 'TAUTAN', icon: '↗', className: 'doc-link' };
    if (kind === 'title') return { label: 'JUDUL', icon: '✳', className: 'doc-link' };
    if (kind === 'text') return { label: 'CATATAN', icon: '≡', className: 'doc-word' };
    if (['png','jpg','jpeg','webp','gif'].includes(ext) || material.imageData) return { label: 'FOTO', icon: '▧', className: 'doc-image' };
    if (['ppt','pptx'].includes(ext)) return { label: 'SLIDE', icon: '▥', className: 'doc-slides' };
    if (['doc','docx'].includes(ext)) return { label: 'WORD', icon: 'W', className: 'doc-word' };
    if (ext === 'pdf') return { label: 'PDF', icon: '▤', className: 'doc-pdf' };
    return { label: 'FILE', icon: '▤', className: 'doc-word' };
  }
  function readableDate(value) {
    const d = new Date(value || Date.now());
    return Number.isNaN(d.getTime()) ? 'Baru saja' : d.toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
  }
  function getMaterial(id) { return state.materials.find(m => m.id === id); }
  function allCourses() { return [...new Set(state.materials.map(m => (m.course || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'id')); }
  function currentText(material) { return String(material?.text || '').trim(); }

  function navigate(view) {
    if (!$('#view-' + view)) return;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
    $$('.nav-item[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    const active = $(`.nav-item[data-view="${view}"]`);
    $('#pageBreadcrumb').textContent = active ? active.textContent.trim().replace(/\s+/g, ' ') : 'Pengaturan';
    $('#sidebar').classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (view === 'journals' && !$('#journalQuery').value.trim()) {
      const material = getMaterial($('#journalMaterialSelect').value);
      if (material) $('#journalQuery').value = material.title;
    }
  }
  function addStudySession() {
    const date = todayISO();
    if (state.lastStudyDate !== date) state.dailySessions = 0;
    state.dailySessions = (state.dailySessions || 0) + 1;
    state.lastStudyDate = date;
    state.sessions = (state.sessions || 0) + 1;
    saveState(); renderStats();
  }
  function updateStats() {
    $('#statMaterials').textContent = state.materials.length;
    $('#statCards').textContent = (state.flashcardSets || []).reduce((sum, set) => sum + (set.cards?.length || 0), 0);
    $('#statQuestions').textContent = state.questionsDone || 0;
    $('#statSessions').textContent = state.sessions || 0;
    $('#navMaterialCount').textContent = state.materials.length;
    const daily = state.lastStudyDate === todayISO() ? (state.dailySessions || 0) : 0;
    $('#focusMeta').textContent = `${Math.min(daily,3)} / 3`;
    $('#focusTrack').style.width = `${Math.min(100, daily / 3 * 100)}%`;
  }
  const renderStats = updateStats;

  function renderRecent() {
    const target = $('#recentMaterials');
    const list = [...state.materials].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0,4);
    if (!list.length) {
      target.innerHTML = '<div class="empty-inline">Belum ada materi. Tambahkan PDF, dokumen, tautan, atau judul topik pertamamu.</div>'; return;
    }
    target.innerHTML = list.map(m => {
      const info = typeInfo(m);
      return `<div class="recent-row"><div class="doc-icon ${info.className}">${info.icon}</div><div style="min-width:0"><div class="doc-title">${escapeHTML(m.title)}</div><div class="doc-meta">${escapeHTML(m.course || 'Belum ada mata kuliah')} · ${info.label} · ${readableDate(m.createdAt)}</div></div><span class="row-spacer"></span><button class="mini-action" data-action="summarize" data-id="${m.id}">Pelajari</button></div>`;
    }).join('');
  }
  function renderCourseFilter() {
    const filter = $('#courseFilter'); const prior = filter.value || 'all';
    filter.innerHTML = '<option value="all">Semua mata kuliah</option>' + allCourses().map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
    filter.value = [...filter.options].some(o => o.value === prior) ? prior : 'all';
  }
  function renderMaterialGrid() {
    const search = $('#materialSearch').value.trim().toLowerCase(); const course = $('#courseFilter').value;
    const list = [...state.materials].filter(m => (course === 'all' || (m.course || '') === course) && `${m.title} ${m.course || ''} ${m.tags || ''}`.toLowerCase().includes(search)).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    $('#materialResultCount').textContent = `${list.length} materi`;
    const target = $('#materialsGrid');
    if (!list.length) {
      target.innerHTML = `<div class="empty-state"><div class="empty-illustration">▤</div><h3>${state.materials.length ? 'Materi tidak ditemukan' : 'Perpustakaanmu masih kosong'}</h3><p>${state.materials.length ? 'Coba kata kunci atau filter mata kuliah lain.' : 'Unggah dokumen atau masukkan judul materi untuk mulai membangun ruang belajar.'}</p>${state.materials.length ? '' : '<button class="button button-primary" id="emptyAddButton">Tambah materi pertama</button>'}</div>`;
      const btn = $('#emptyAddButton'); if (btn) btn.addEventListener('click', openAddModal);
      return;
    }
    target.innerHTML = list.map(m => {
      const info = typeInfo(m);
      const desc = m.text ? `${m.text.length.toLocaleString('id-ID')} karakter teks` : m.url ? 'Tautan online' : m.imageData ? 'Foto tersimpan di perangkat' : 'Judul saja · tambahkan isi untuk belajar lebih lanjut';
      return `<article class="material-card"><div class="material-card-top"><div class="doc-icon ${info.className}">${info.icon}</div><span class="tag-pill">${info.label}</span><span class="row-spacer"></span><span class="result-count">${readableDate(m.createdAt)}</span></div><h3>${escapeHTML(m.title)}</h3><div class="course-line">${escapeHTML(m.course || 'Mata kuliah belum diisi')}</div><div class="material-date">${escapeHTML(desc)}</div><div class="material-card-actions"><button data-action="summarize" data-id="${m.id}">Ringkas materi</button><button data-action="journals" data-id="${m.id}">Cari jurnal</button><button class="delete-material" data-action="delete" data-id="${m.id}" aria-label="Hapus ${escapeHTML(m.title)}">×</button></div></article>`;
    }).join('');
  }
  function fillMaterialSelects() {
    const defs = [
      ['summaryMaterial','Pilih materi...'],['quizMaterial','Pilih materi...'],['flashMaterial','Pilih materi...'],['mapMaterial','Pilih materi...'],['journalMaterialSelect','Atau ambil dari materi tersimpan...']
    ];
    defs.forEach(([id, placeholder]) => {
      const el = $('#' + id); if (!el) return; const prev = el.value;
      el.innerHTML = `<option value="">${escapeHTML(placeholder)}</option>` + [...state.materials].sort((a,b) => a.title.localeCompare(b.title,'id')).map(m => `<option value="${m.id}">${escapeHTML(m.title)}${m.course ? ` — ${escapeHTML(m.course)}` : ''}</option>`).join('');
      if (state.materials.some(m => m.id === prev)) el.value = prev;
    });
    renderCourseFilter();
  }
  function renderAll() { updateStats(); renderRecent(); renderMaterialGrid(); fillMaterialSelects(); renderSavedFlashcardSets(); }

  function openAddModal() {
    $('#addModal').classList.add('open'); $('#addModal').setAttribute('aria-hidden','false'); document.body.classList.add('modal-open'); setTimeout(() => $('#materialTitle').focus(), 60);
  }
  function closeAddModal() {
    $('#addModal').classList.remove('open'); $('#addModal').setAttribute('aria-hidden','true'); document.body.classList.remove('modal-open');
  }
  function setKindFields() {
    const kind = $('#materialKind').value;
    $('#uploadZone').classList.toggle('hidden', kind !== 'file');
    $('#linkField').classList.toggle('hidden', kind !== 'link');
    $('#textField').classList.toggle('hidden', kind !== 'text');
    if (kind !== 'file') { pendingFile = null; $('#materialFile').value = ''; $('#selectedFile').hidden = true; }
  }
  function setPendingFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { toast('Ukuran file melebihi 12 MB. Kompres file atau pilih file yang lebih kecil.', 'error'); return; }
    pendingFile = file; $('#materialKind').value = 'file'; setKindFields(); pendingFile = file;
    $('#selectedFile').hidden = false;
    $('#selectedFile').textContent = `${file.name} · ${(file.size/1024/1024).toFixed(file.size > 1024*1024 ? 1 : 2)} MB`;
  }
  function readFileAsArrayBuffer(file) { return new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error || new Error('File tidak bisa dibaca')); reader.readAsArrayBuffer(file); }); }
  function readFileAsDataURL(file) { return new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error || new Error('Foto tidak bisa dibaca')); reader.readAsDataURL(file); }); }
  async function makeImagePreview(file) {
    const dataUrl = await readFileAsDataURL(file);
    try {
      const img = await new Promise((resolve,reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = dataUrl; });
      const scale = Math.min(1, 800 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.width*scale)); canvas.height = Math.max(1, Math.round(img.height*scale));
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      return canvas.toDataURL('image/jpeg', .76);
    } catch { return dataUrl; }
  }
  async function extractText(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (['txt','md'].includes(ext)) return { text: await file.text(), warning: '' };
    if (ext === 'pdf') {
      if (!window.pdfjsLib) return { text:'', warning:'Pembaca PDF gagal dimuat. Periksa koneksi internet atau salin teks secara manual.' };
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const buffer = await readFileAsArrayBuffer(file); const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise; const chunks = [];
      for (let p = 1; p <= pdf.numPages; p++) { const page = await pdf.getPage(p); const content = await page.getTextContent(); chunks.push(content.items.map(item => item.str).join(' ')); }
      const text = chunks.join('\n\n').trim();
      return { text, warning: text ? '' : 'PDF terlihat seperti hasil pindai/foto sehingga teks tidak dapat diekstrak. Tempel teks atau gunakan OCR terlebih dahulu.' };
    }
    if (ext === 'docx') {
      if (!window.mammoth) return { text:'', warning:'Pembaca Word gagal dimuat. Coba simpan sebagai TXT lalu unggah ulang.' };
      const result = await window.mammoth.extractRawText({ arrayBuffer: await readFileAsArrayBuffer(file) });
      return { text: result.value.trim(), warning: result.value.trim() ? '' : 'Tidak ditemukan teks di dokumen Word.' };
    }
    if (ext === 'pptx') {
      if (!window.JSZip) return { text:'', warning:'Pembaca PowerPoint gagal dimuat.' };
      const zip = await window.JSZip.loadAsync(await readFileAsArrayBuffer(file));
      const names = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b) => Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]));
      const slides = [];
      for (const name of names) {
        const xml = await zip.files[name].async('text'); const doc = new DOMParser().parseFromString(xml,'application/xml');
        const words = [...doc.getElementsByTagName('a:t')].map(n => n.textContent || '').filter(Boolean);
        if (words.length) slides.push(words.join(' '));
      }
      const text = slides.join('\n\n').trim();
      return { text, warning: text ? '' : 'Tidak ditemukan teks di slide PowerPoint.' };
    }
    if (['png','jpg','jpeg','webp','gif'].includes(ext) || file.type.startsWith('image/')) {
      return { text:'', imageData: await makeImagePreview(file), warning:'Foto disimpan sebagai materi visual. Teks dalam foto belum dibaca otomatis; tambahkan catatan teks jika ingin membuat ringkasan dan soal.' };
    }
    if (['doc','ppt'].includes(ext)) return { text:'', warning:`Format .${ext} lama dapat disimpan, tetapi teksnya belum dapat diekstrak di browser ini. Konversikan ke .${ext === 'doc' ? 'docx' : 'pptx'} untuk memakai fitur ringkasan dan soal.` };
    return { text:'', warning:'Jenis file tersimpan sebagai referensi, tetapi teks belum dapat diekstrak.' };
  }
  async function saveMaterial(event) {
    event.preventDefault();
    const title = $('#materialTitle').value.trim(); if (!title) return toast('Judul materi wajib diisi.', 'error');
    const kind = $('#materialKind').value; const course = $('#materialCourse').value.trim();
    const item = { id: uid(), title, course, kind, text:'', tags:$('#materialTags').value.trim(), createdAt:new Date().toISOString(), fileName:'', url:'', imageData:null };
    const button = $('#saveMaterialButton'); button.disabled = true; button.innerHTML = 'Menyimpan…';
    try {
      if (kind === 'file') {
        if (!pendingFile) throw new Error('Pilih file terlebih dahulu.');
        item.fileName = pendingFile.name; item.fileSize = pendingFile.size;
        const result = await extractText(pendingFile);
        item.text = result.text || ''; item.imageData = result.imageData || null;
        if (result.warning) item.warning = result.warning;
      } else if (kind === 'link') {
        const url = $('#materialLink').value.trim();
        if (!url || !/^https?:\/\//i.test(url)) throw new Error('Masukkan URL yang valid dan diawali http:// atau https://.');
        item.url = url;
      } else if (kind === 'text') {
        item.text = $('#materialText').value.trim();
        if (!item.text) throw new Error('Masukkan isi catatan terlebih dahulu.');
      }
      state.materials.push(item); await saveState(); renderAll(); closeAddModal(); $('#addMaterialForm').reset(); pendingFile = null; setKindFields();
      toast(item.warning ? `Materi tersimpan. ${item.warning}` : `“${title}” berhasil ditambahkan.` , item.warning ? 'error' : 'success');
    } catch (error) { toast(error.message || 'Materi gagal disimpan.', 'error'); }
    finally { button.disabled = false; button.innerHTML = 'Simpan materi <span>→</span>'; }
  }

  function tokenize(text) { return (String(text || '').toLowerCase().match(/[a-zA-ZÀ-ž0-9][a-zA-ZÀ-ž0-9'-]*/g) || []).filter(w => w.length > 3 && !stopWords.has(w)); }
  function getKeywords(text, limit = 8) {
    const freq = new Map(); tokenize(text).forEach(w => freq.set(w, (freq.get(w) || 0) + 1));
    return [...freq.entries()].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,limit).map(([word]) => word);
  }
  function getSentences(text) {
    const source = String(text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
    const chunks = source.split(/\n+/).flatMap(line => line.split(/(?<=[.!?])\s+/));
    const sentences = [];
    for (const chunk of chunks) {
      const clean = chunk.replace(/^[-*•\d.)\s]+/, '').trim();
      if (!clean) continue;
      if (clean.length <= 450) {
        sentences.push(clean);
        continue;
      }
      // Some extracted slides/PDFs contain one very long line without sentence punctuation.
      // Split those lines into readable chunks instead of silently dropping them.
      const clauses = clean.split(/(?<=[;:])\s+/);
      if (clauses.length > 1 && clauses.every(part => part.length <= 450)) {
        sentences.push(...clauses.map(part => part.trim()).filter(Boolean));
      } else {
        const words = clean.split(/\s+/);
        let part = '';
        for (const word of words) {
          if (part && (part + ' ' + word).length > 300) {
            if (part.length >= 30) sentences.push(part.trim());
            part = word;
          } else part += (part ? ' ' : '') + word;
        }
        if (part.length >= 30) sentences.push(part.trim());
      }
    }
    return sentences.filter(s => s.length >= 30 && /[a-zA-ZÀ-ž]{3}/.test(s));
  }
  function buildLocalSummary(material) {
    const text = currentText(material);
    if (!text) throw new Error(material?.warning || 'Materi ini belum memiliki teks yang bisa diringkas. Tambahkan catatan atau unggah dokumen dengan teks yang dapat diekstrak.');
    const sentences = getSentences(text);
    const keywords = getKeywords(text, 12);
    if (!sentences.length) throw new Error('Teks materi terlalu pendek untuk diringkas. Tambahkan beberapa kalimat atau paragraf.');

    // Extractive summary: scores sentences from the uploaded text, then preserves their order.
    // It does not call an AI API, so creating a summary here has no API cost.
    const freq = new Map();
    tokenize(text).forEach(w => freq.set(w, (freq.get(w) || 0) + 1));
    const scored = sentences.map((sentence, index) => {
      const words = tokenize(sentence);
      const uniqueWords = [...new Set(words)];
      const termScore = uniqueWords.reduce((sum, word) => sum + Math.log(1 + (freq.get(word) || 0)), 0) / Math.sqrt(Math.max(words.length, 1));
      const lengthBonus = sentence.length >= 70 && sentence.length <= 260 ? 1.0 : sentence.length > 260 ? 0.25 : 0;
      const openingBonus = index < 3 ? 0.7 : 0;
      const keywordBonus = uniqueWords.filter(word => keywords.includes(word)).length * 0.12;
      return { sentence, index, words: new Set(uniqueWords), score: termScore + lengthBonus + openingBonus + keywordBonus };
    });

    // Include substantially more source material than the old 2–5-sentence limit.
    const targetCount = Math.min(sentences.length, Math.max(6, Math.min(36, Math.ceil(sentences.length * 0.32))));
    const ranked = [...scored].sort((a, b) => b.score - a.score || a.index - b.index);
    const chosen = [];
    for (const candidate of ranked) {
      const isNearDuplicate = chosen.some(item => {
        const intersection = [...candidate.words].filter(word => item.words.has(word)).length;
        const union = new Set([...candidate.words, ...item.words]).size;
        return union > 0 && intersection / union > 0.78;
      });
      if (!isNearDuplicate) chosen.push(candidate);
      if (chosen.length >= targetCount) break;
    }
    // If the diversity filter leaves too few points, fill from the remaining highest-scoring sentences.
    if (chosen.length < targetCount) {
      const chosenIndexes = new Set(chosen.map(item => item.index));
      for (const item of ranked) {
        if (!chosenIndexes.has(item.index)) chosen.push(item);
        if (chosen.length >= targetCount) break;
      }
    }
    const keyPoints = chosen.sort((a, b) => a.index - b.index).map(item => item.sentence);
    const overviewCount = Math.min(keyPoints.length, Math.max(4, Math.min(16, Math.ceil(keyPoints.length * 0.55))));
    const overview = keyPoints.slice(0, overviewCount).join(' ');
    return { title: material.title, summary: overview, points: keyPoints, keywords, mode: 'local' };
  }
  async function tryAI(action, payload) {
    if (location.protocol === 'file:' || location.hostname.endsWith('github.io')) throw new Error('Backend AI tidak tersedia di hosting statis ini.');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch('/api/study', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action,...payload}), signal:controller.signal });
      if (!response.ok) throw new Error(`Server AI menjawab ${response.status}`);
      const result = await response.json();
      if (!result || result.error) throw new Error(result?.error || 'Respons AI tidak valid.');
      return result;
    } finally { clearTimeout(timer); }
  }
  function showOutputPlaceholder(target, icon, color, title, desc) {
    target.innerHTML = `<div class="output-placeholder"><div class="output-symbol ${color}">${icon}</div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(desc)}</p></div>`;
  }
  async function generateSummary() {
    const material = getMaterial($('#summaryMaterial').value); const output = $('#summaryOutput');
    if (!material) return toast('Pilih materi terlebih dahulu.', 'error');
    if (!currentText(material)) { showOutputPlaceholder(output,'✳','', 'Materi belum memiliki teks', material.warning || 'Materi ini baru berupa judul, tautan, atau foto. Tambahkan teks catatan agar bisa diringkas.'); return; }
    $('#generateSummary').disabled = true; $('#generateSummary').textContent = 'Menyusun ringkasan…';
    try {
      // Ringkasan dibuat sepenuhnya lokal agar tidak memakai API key atau menimbulkan biaya AI.
      const data = buildLocalSummary(material);
      renderSummaryOutput(material, data, 'lokal gratis');
      addStudySession();
    } catch (error) { showOutputPlaceholder(output,'✳','', 'Belum bisa membuat ringkasan', error.message || 'Periksa kembali teks materi.'); }
    finally { $('#generateSummary').disabled = false; $('#generateSummary').innerHTML = 'Buat ringkasan <span>→</span>'; }
  }
  function renderSummaryOutput(material,data,mode) {
    $('#summaryOutput').classList.remove('output-placeholder');
    const points = Array.isArray(data.points) ? data.points : [];
    const keywords = Array.isArray(data.keywords) ? data.keywords : getKeywords(currentText(material));
    $('#summaryAiStatus').innerHTML = `<span class="status-dot"></span> Ringkasan mode ${escapeHTML(mode)} · tanpa biaya API`;
    $('#summaryOutput').innerHTML = `<div class="summary-content"><div class="result-heading"><div class="output-symbol">✳</div><div><h2>${escapeHTML(material.title)}</h2><p>${escapeHTML(material.course || 'Mata kuliah')} · ${points.length} poin utama · mode ${escapeHTML(mode)}</p></div></div><div class="summary-block"><h3><span>1</span> Inti materi</h3><p>${escapeHTML(data.summary || points.slice(0,2).join(' '))}</p></div><div class="summary-block"><h3><span>2</span> Pokok pembahasan</h3><ul>${points.map(p=>`<li>${escapeHTML(p)}</li>`).join('')}</ul></div><div class="summary-block"><h3><span>3</span> Kata kunci</h3><div class="keyword-list">${keywords.map(k=>`<span class="keyword-chip">${escapeHTML(k)}</span>`).join('')}</div></div><div class="summary-block"><h3><span>4</span> Cek pemahamanmu</h3><p>Coba jelaskan kembali setiap poin dengan bahasamu sendiri, berikan satu contoh, lalu bandingkan dengan bahan asli. Tandai istilah yang belum kamu pahami.</p></div><div class="summary-footer"><span>Catatan: periksa kembali dengan sumber asli.</span><button class="button button-secondary" id="copySummary">Salin ringkasan ⧉</button></div></div>`;
    $('#copySummary').addEventListener('click',()=>copyToClipboard(`${material.title}\n\nInti materi\n${data.summary || ''}\n\nPokok pembahasan\n${points.map(p=>'• '+p).join('\n')}\n\nKata kunci: ${keywords.join(', ')}`));
  }
  async function copyToClipboard(text) { try { await navigator.clipboard.writeText(text); toast('Teks berhasil disalin.'); } catch { const area=document.createElement('textarea'); area.value=text; document.body.appendChild(area); area.select(); try{document.execCommand('copy');toast('Teks berhasil disalin.')}catch{toast('Tidak bisa menyalin otomatis. Silakan salin secara manual.','error')} area.remove(); } }

  function buildLocalQuestions(material,count,difficulty,type) {
    const sentences = getSentences(currentText(material));
    if (sentences.length < 2) throw new Error('Teks belum cukup untuk membuat latihan. Tambahkan setidaknya beberapa kalimat atau paragraf.');
    const uniqueSentences = [...new Set(sentences)];
    const freq = new Map(); tokenize(currentText(material)).forEach(w=>freq.set(w,(freq.get(w)||0)+1));
    const ranked = uniqueSentences.map((sentence,i)=>({sentence,i,score:tokenize(sentence).reduce((n,w)=>n+(freq.get(w)||0),0)/Math.max(tokenize(sentence).length,1)})).sort((a,b)=>b.score-a.score).map(x=>x.sentence);
    const questions=[];
    for (let i=0;i<count;i++) {
      const answer = ranked[i % ranked.length];
      const distractors = uniqueSentences.filter(s=>s!==answer).sort((a,b)=>Math.abs(a.length-answer.length)-Math.abs(b.length-answer.length));
      const choices = [answer];
      for (const s of distractors) { if (choices.length>=4) break; if (!choices.includes(s)) choices.push(s); }
      while (choices.length<Math.min(4,uniqueSentences.length)) choices.push(uniqueSentences[(i+choices.length)%uniqueSentences.length]);
      if (type === 'short') {
        questions.push({question:`Jelaskan dengan bahasamu sendiri inti gagasan berikut: “${trimText(answer, difficulty==='sulit'?210:150)}”`, answer, explanation:`Bandingkan jawabanmu dengan gagasan utama dari materi. Jawaban tidak harus sama persis, tetapi maknanya harus sesuai.`});
      } else {
        const shuffled = [...choices];
        // Deterministic order per question; do not always show the correct answer first.
        const shift = (i * 3 + (difficulty==='sulit'?2:difficulty==='mudah'?1:0)) % shuffled.length;
        const ordered = shuffled.slice(shift).concat(shuffled.slice(0,shift));
        let question = 'Pernyataan mana yang paling sesuai dengan materi?';
        if (difficulty === 'mudah') question = 'Pernyataan mana yang benar-benar disebutkan dalam materi?';
        if (difficulty === 'sulit') question = 'Pernyataan mana yang paling tepat untuk mempertahankan makna utama materi?';
        questions.push({question, options:ordered.map(s=>trimText(s,215)), answerIndex:ordered.indexOf(answer), explanation:`Jawaban diambil dari teks materi: “${trimText(answer,250)}”`});
      }
    }
    return {questions, mode:'local'};
  }
  async function startQuiz() {
    const material = getMaterial($('#quizMaterial').value); if (!material) return toast('Pilih materi terlebih dahulu.', 'error');
    if (!currentText(material)) return toast(material.warning || 'Materi ini belum memiliki teks untuk membuat soal. Tambahkan catatan atau unggah dokumen.', 'error');
    const count = Number($('#questionCount').value); const difficulty = $('input[name="difficulty"]:checked').value; const type = $('#quizType').value; const target = $('#quizWorkspace');
    $('#startQuiz').disabled = true; $('#startQuiz').textContent = 'Menyiapkan soal…';
    try {
      let result;
      try { result = await tryAI('quiz',{material:{title:material.title,course:material.course,text:currentText(material)},count,difficulty,type}); if (!Array.isArray(result.questions) || !result.questions.length) throw new Error('format AI tidak sesuai'); result.mode='AI'; }
      catch { result = buildLocalQuestions(material,count,difficulty,type); }
      quizState = {materialId:material.id,questions:result.questions.slice(0,count),index:0,score:0,answered:false,mode:result.mode || 'lokal',difficulty,type};
      renderQuizQuestion(); addStudySession();
    } catch (error) { showOutputPlaceholder(target,'✓','peach-symbol','Soal belum bisa dibuat',error.message || 'Coba tambahkan teks materi yang lebih lengkap.'); }
    finally { $('#startQuiz').disabled = false; $('#startQuiz').innerHTML = 'Buat latihan soal <span>→</span>'; }
  }
  function renderQuizQuestion() {
    const q = quizState.questions[quizState.index]; const target = $('#quizWorkspace'); const n = quizState.index+1; const total=quizState.questions.length;
    if (!q) return renderQuizResults();
    const progress = (quizState.index/total)*100;
    let body = '';
    if (quizState.type === 'short' || !Array.isArray(q.options)) {
      body = `<textarea id="shortAnswer" class="field textarea" rows="4" placeholder="Tulis jawabanmu dengan bahasa sendiri..." ${quizState.answered?'disabled':''}></textarea><div id="quizFeedback"></div><div class="quiz-controls"><small>Gunakan pemahamanmu sendiri.</small><button class="button button-primary" id="checkShortAnswer" ${quizState.answered?'disabled':''}>Lihat contoh jawaban</button></div>`;
    } else {
      body = `<div class="option-list">${q.options.map((option,i)=>`<button class="quiz-option" data-answer="${i}" ${quizState.answered?'disabled':''}><span class="option-letter">${String.fromCharCode(65+i)}</span><span>${escapeHTML(option)}</span></button>`).join('')}</div><div id="quizFeedback"></div><div class="quiz-controls"><small>${quizState.answered?'Jawaban sudah direkam.':'Pilih satu jawaban yang paling tepat.'}</small><button class="button button-primary" id="nextQuestion" ${quizState.answered?'':'disabled'}>${n===total?'Lihat hasil':'Soal berikutnya'} <span>→</span></button></div>`;
    }
    target.innerHTML = `<div class="quiz-question-head"><span class="question-counter">SOAL ${n} DARI ${total}</span><span class="result-count">${escapeHTML(quizState.difficulty)} · ${escapeHTML(quizState.mode)}</span></div><div class="quiz-progress"><span style="width:${progress}%"></span></div><h2 class="quiz-question">${escapeHTML(q.question)}</h2>${body}`;
    if (quizState.type !== 'short' && Array.isArray(q.options)) {
      $$('[data-answer]',target).forEach(button => button.addEventListener('click',()=>answerMCQ(Number(button.dataset.answer))));
      $('#nextQuestion').addEventListener('click', nextQuestion);
    } else $('#checkShortAnswer').addEventListener('click', revealShortAnswer);
  }
  function answerMCQ(index) {
    if (!quizState || quizState.answered) return;
    const q=quizState.questions[quizState.index]; quizState.answered=true; const correct=index===q.answerIndex;
    if (correct) { quizState.score++; state.questionsDone=(state.questionsDone||0)+1; }
    else state.questionsDone=(state.questionsDone||0)+1;
    $$('[data-answer]',$('#quizWorkspace')).forEach(btn=>{const i=Number(btn.dataset.answer);if(i===q.answerIndex)btn.classList.add('correct');else if(i===index)btn.classList.add('incorrect');btn.disabled=true;});
    $('#quizFeedback').className=`quiz-feedback ${correct?'good':'bad'}`; $('#quizFeedback').innerHTML=`<strong>${correct?'Tepat! Bagus.':'Belum tepat, jadikan bahan belajar.'}</strong><br>${escapeHTML(q.explanation || '')}`;
    $('#nextQuestion').disabled=false; $('#nextQuestion').innerHTML=quizState.index===quizState.questions.length-1?'Lihat hasil <span>→</span>':'Soal berikutnya <span>→</span>';
    saveState(); updateStats();
  }
  function revealShortAnswer() {
    if (!quizState || quizState.answered) return;
    const q=quizState.questions[quizState.index]; const response=$('#shortAnswer').value.trim(); quizState.answered=true; state.questionsDone=(state.questionsDone||0)+1; saveState(); updateStats();
    $('#shortAnswer').disabled=true;
    $('#quizFeedback').className='quiz-feedback good'; $('#quizFeedback').innerHTML=`<strong>Contoh jawaban untuk ditelaah:</strong><br>${escapeHTML(q.answer || q.explanation || '')}<br><br><span>Bandingkan dengan jawabanmu. Nilai sendiri apakah gagasan utama, istilah, dan alasannya sudah tepat.</span>${response ? `<div style="margin-top:8px;opacity:.8">Jawabanmu sudah dicatat untuk sesi ini (tidak dikirim ke server).</div>`:''}`;
    $('#checkShortAnswer').disabled=false; $('#checkShortAnswer').innerHTML=quizState.index===quizState.questions.length-1?'Lihat hasil <span>→</span>':'Soal berikutnya <span>→</span>';
    $('#checkShortAnswer').removeEventListener('click',revealShortAnswer); $('#checkShortAnswer').addEventListener('click',nextQuestion,{once:true});
  }
  function nextQuestion() { if (!quizState || !quizState.answered) return; quizState.index++; quizState.answered=false; if (quizState.index>=quizState.questions.length) renderQuizResults(); else renderQuizQuestion(); }
  function renderQuizResults() {
    const total=quizState.questions.length; const score=quizState.type==='short'?null:quizState.score; const pct=score===null?0:Math.round(score/total*100);
    $('#quizWorkspace').innerHTML=`<div class="quiz-result"><div class="score-ring" style="--score-angle:${pct*3.6}deg"><strong>${score===null?'✓':`${pct}%`}</strong></div><h3>${score===null?'Sesi latihan selesai!':pct>=80?'Keren, pemahamanmu kuat!':pct>=60?'Sudah cukup baik!':'Ayo ulangi materi sekali lagi.'}</h3><p>${score===null?`${total} jawaban singkat selesai ditinjau. Periksa kembali contoh jawaban dan catatanmu.`:`Kamu menjawab ${score} dari ${total} soal dengan benar. Gunakan soal yang salah sebagai panduan untuk mengulang konsep.`}</p><button id="retryQuiz" class="button button-primary">Coba latihan lagi <span>↻</span></button> <button id="reviewSummary" class="button button-secondary">Buka ringkasan</button><div style="font-size:9px;color:#a2a3b7;margin-top:15px">Latihan berakhir · mode ${escapeHTML(quizState.mode)}</div></div>`;
    $('#retryQuiz').addEventListener('click',startQuiz); $('#reviewSummary').addEventListener('click',()=>{ $('#summaryMaterial').value=quizState.materialId; navigate('summary'); generateSummary(); });
    addStudySession();
  }

  async function generateFlashcards() {
    const material=getMaterial($('#flashMaterial').value); if(!material)return toast('Pilih materi terlebih dahulu.','error');
    if(!currentText(material))return toast(material.warning || 'Materi ini belum memiliki teks. Tambahkan isi catatan agar flashcard bisa dibuat.','error');
    $('#generateFlashcards').disabled=true;$('#generateFlashcards').textContent='Membuat kartu…';
    try {
      let result;
      try { result=await tryAI('flashcards',{material:{title:material.title,course:material.course,text:currentText(material)},count:12}); if(!Array.isArray(result.cards)||!result.cards.length)throw new Error('format AI tidak sesuai');result.mode='AI'; }
      catch { result=buildLocalFlashcards(material); }
      flashState={materialId:material.id,cards:result.cards,idx:0,flipped:false,mode:result.mode||'lokal'};
      const savedSet={id:uid(),materialId:material.id,title:material.title,createdAt:new Date().toISOString(),cards:result.cards};
      state.flashcardSets=state.flashcardSets||[];state.flashcardSets.unshift(savedSet);state.flashcardSets=state.flashcardSets.slice(0,30);state.flashcardsGenerated=state.flashcardSets.reduce((sum,set)=>sum+(set.cards?.length||0),0);await saveState();updateStats();renderSavedFlashcardSets();renderFlashcard();addStudySession();
    } catch(error){ toast(error.message||'Flashcard tidak berhasil dibuat.','error'); }
    finally{$('#generateFlashcards').disabled=false;$('#generateFlashcards').textContent='Buat flashcard';}
  }
  function buildLocalFlashcards(material) {
    const sentences=getSentences(currentText(material)); const keywords=getKeywords(currentText(material),12);
    if(!sentences.length)throw new Error('Materi belum cukup panjang untuk membuat flashcard.');
    const cards=keywords.map(keyword=>{const sentence=sentences.find(s=>s.toLowerCase().includes(keyword))||sentences[0];return {question:`Apa yang perlu kamu pahami tentang “${keyword}” dalam materi ini?`,answer:sentence};});
    if(cards.length<4)sentences.slice(0,8).forEach((sentence,i)=>cards.push({question:i===0?`Apa inti dari materi “${material.title}”?`:`Apa gagasan penting berikutnya dalam materi “${material.title}”?`,answer:sentence}));
    return {cards:cards.slice(0,16),mode:'local'};
  }
  function renderFlashcard() {
    const stage=$('#flashStage'); if(!flashState || !flashState.cards.length)return showOutputPlaceholder(stage,'▱','mint-symbol','Belum ada kartu','Pilih materi dengan teks agar flashcard bisa dibuat.');
    const card=flashState.cards[flashState.idx]; const total=flashState.cards.length;
    stage.innerHTML=`<div class="flashcard ${flashState.flipped?'flipped':''}" id="flashCardFace" role="button" tabindex="0" aria-label="Balik kartu untuk melihat ${flashState.flipped?'pertanyaan':'jawaban'}"><div class="card-kicker">${flashState.flipped?'JAWABAN':'PERTANYAAN'} · ${escapeHTML(flashState.mode.toUpperCase())}</div><div class="card-content">${escapeHTML(flashState.flipped?card.answer:card.question)}</div><div class="card-help">Klik kartu untuk ${flashState.flipped?'melihat pertanyaan':'membalik ke jawaban'} ↻</div></div><div class="flash-controls"><button id="flashPrev" ${flashState.idx===0?'disabled':''}>← Sebelumnya</button><span class="flash-progress">${flashState.idx+1} / ${total}</span><button id="markLearned" class="primary-flash">${flashState.flipped?'Saya paham ✓':'Tandai paham'}</button><button id="flashNext" ${flashState.idx===total-1?'disabled':''}>Berikutnya →</button></div><div style="font-size:9px;color:#a2a3b7">Materi: ${escapeHTML(getMaterial(flashState.materialId)?.title || '')}</div>`;
    const face=$('#flashCardFace'); const flip=()=>{flashState.flipped=!flashState.flipped;renderFlashcard();};face.addEventListener('click',flip);face.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();flip();}});
    $('#flashPrev').addEventListener('click',()=>{flashState.idx--;flashState.flipped=false;renderFlashcard();}); $('#flashNext').addEventListener('click',()=>{flashState.idx++;flashState.flipped=false;renderFlashcard();});
    $('#markLearned').addEventListener('click',()=>{if(!flashState.flipped){flashState.flipped=true;renderFlashcard();return;}state.learnedCards=(state.learnedCards||0)+1;saveState();toast('Kartu ditandai sudah dipahami.'); if(flashState.idx<total-1){flashState.idx++;flashState.flipped=false;renderFlashcard();}else toast('Bagus! Kamu sudah meninjau semua kartu.');});
  }


  function renderSavedFlashcardSets() {
    const target = $('#savedFlashcardSets'); if (!target) return;
    const sets = state.flashcardSets || [];
    if (!sets.length) { target.innerHTML = ''; return; }
    target.innerHTML = `<div class="saved-sets-heading">Koleksi tersimpan <span>${sets.length} set</span></div>` + sets.slice(0,5).map(set => `<button class="saved-set-button" data-load-flashset="${set.id}"><span class="saved-set-icon">▱</span><span class="saved-set-copy"><strong>${escapeHTML(set.title || 'Flashcard')}</strong><small>${set.cards?.length || 0} kartu · ${readableDate(set.createdAt)}</small></span><span class="saved-set-arrow">→</span></button>`).join('');
  }
  function loadFlashcardSet(id) {
    const set = (state.flashcardSets || []).find(item => item.id === id); if (!set) return;
    $('#flashMaterial').value = set.materialId || '';
    flashState = { materialId:set.materialId, cards:set.cards || [], idx:0, flipped:false, mode:'tersimpan' };
    renderFlashcard();
  }

  function buildLocalMindmap(material) {
    const text=currentText(material); if(!text)throw new Error('Materi ini belum memiliki teks untuk dipetakan.');
    const keywords=getKeywords(text,6); const sentences=getSentences(text); if(!keywords.length||!sentences.length)throw new Error('Teks terlalu singkat untuk membentuk peta konsep.');
    const nodes=keywords.slice(0,6).map((keyword,i)=>({label:keyword[0].toUpperCase()+keyword.slice(1),description:trimText(sentences.find(s=>s.toLowerCase().includes(keyword))||sentences[i%sentences.length],95)}));
    return {nodes,mode:'local'};
  }
  async function generateMindmap() {
    const material=getMaterial($('#mapMaterial').value); if(!material)return toast('Pilih materi terlebih dahulu.','error');
    const target=$('#mindmapOutput'); if(!currentText(material))return showOutputPlaceholder(target,'⌘','blue-symbol','Materi belum memiliki teks',material.warning||'Tambahkan teks dari bahan kuliah untuk membuat peta konsep.');
    $('#generateMindmap').disabled=true;$('#generateMindmap').textContent='Menyusun peta…';
    try { let data;try{data=await tryAI('mindmap',{material:{title:material.title,course:material.course,text:currentText(material)}});if(!Array.isArray(data.nodes)||!data.nodes.length)throw new Error('format AI tidak sesuai');data.mode='AI';}catch{data=buildLocalMindmap(material);}renderMindmap(material,data);addStudySession(); }
    catch(error){showOutputPlaceholder(target,'⌘','blue-symbol','Peta konsep belum bisa dibuat',error.message||'Coba tambahkan isi materi lebih lengkap.');}
    finally{$('#generateMindmap').disabled=false;$('#generateMindmap').innerHTML='Buat peta konsep <span>→</span>';}
  }
  function renderMindmap(material,data) {
    const nodes=(data.nodes||[]).slice(0,8).map(n=>typeof n==='string'?{label:n,description:''}:{label:n.label||n.title||n.name||'Konsep',description:n.description||n.detail||''});
    if(!nodes.length) return;
    const coords=[{x:17,y:22},{x:50,y:12},{x:83,y:22},{x:17,y:78},{x:50,y:87},{x:83,y:78},{x:50,y:34},{x:50,y:66}].slice(0,nodes.length);
    const lines=coords.map(p=>`<line x1="500" y1="210" x2="${p.x*10}" y2="${p.y*4.2}" stroke="#d8d3ff" stroke-width="2" stroke-linecap="round"/><circle cx="${p.x*10}" cy="${p.y*4.2}" r="4" fill="#b8afff"/>`).join('');
    const content=nodes.map((n,i)=>`<div class="map-node" style="left:${coords[i].x}%;top:${coords[i].y}%" title="${escapeHTML(n.description)}">${escapeHTML(n.label)}</div>`).join('');
    $('#mindmapOutput').innerHTML=`<div class="mindmap-canvas"><svg class="mindmap-svg" viewBox="0 0 1000 420" preserveAspectRatio="none" aria-hidden="true">${lines}</svg><div class="map-node central" style="left:50%;top:50%">${escapeHTML(trimText(material.title,75))}</div>${content}</div><div class="mindmap-legend"><span class="legend-dot"></span> Materi utama <span style="width:18px;height:1px;background:#d8d3ff;margin-left:8px"></span> <span>Konsep terkait · mode ${escapeHTML(data.mode||'lokal')}</span></div>`;
  }

  async function searchJournals(query) {
    query=query.trim(); if(!query)return toast('Masukkan kata kunci atau judul materi untuk mencari artikel.','error');
    const target=$('#journalResults');$('#journalResultsTitle').textContent='Sedang mencari…';$('#journalResultsSubtitle').textContent=`Mencari publikasi terkait “${query}”.`;$('#journalResultCount').textContent='';
    target.innerHTML='<div class="journal-empty"><span>⌕</span><strong>Menghubungkan ke Crossref…</strong><p>Meminta metadata publikasi yang relevan.</p></div>';
    try {
      const params=new URLSearchParams({ 'query.bibliographic':query, rows:'10', select:'title,author,published,published-print,published-online,container-title,URL,DOI,type,issued,publisher,score' });
      const response=await fetch(`https://api.crossref.org/works?${params.toString()}`,{headers:{'Accept':'application/json'}});
      if(!response.ok)throw new Error(`Layanan pencarian merespons ${response.status}.`);
      const json=await response.json();const items=(json.message?.items||[]).filter(item=>Array.isArray(item.title)&&item.title[0]);
      renderJournalResults(query,items);
    } catch(error) {
      $('#journalResultsTitle').textContent='Pencarian belum berhasil';$('#journalResultsSubtitle').textContent='Koneksi internet atau layanan Crossref tidak tersedia.';
      target.innerHTML=`<div class="journal-empty"><span>⌕</span><strong>Tidak dapat mengambil referensi saat ini</strong><p>${escapeHTML(error.message||'Periksa koneksi internet lalu coba lagi.')}</p></div>`;
    }
  }
  function renderJournalResults(query,items) {
    $('#journalResultsTitle').textContent='Artikel yang relevan';$('#journalResultsSubtitle').textContent=`Hasil untuk “${query}” dari metadata Crossref.`;$('#journalResultCount').textContent=`${items.length} hasil`;
    if(!items.length){$('#journalResults').innerHTML='<div class="journal-empty"><span>⌕</span><strong>Belum ada hasil yang cocok</strong><p>Coba kata kunci lebih ringkas, versi bahasa Inggris, atau istilah yang lebih spesifik.</p></div>';return;}
    $('#journalResults').innerHTML=items.map(item=>{
      const title=item.title?.[0]||'Tanpa judul';const authors=(item.author||[]).slice(0,4).map(a=>[a.given,a.family].filter(Boolean).join(' ')).join(', ')+(item.author?.length>4?' et al.':'');
      const journal=item['container-title']?.[0]||item.publisher||item.type||'Informasi publikasi';
      const dateParts=item.published?.['date-parts']?.[0]||item['published-print']?.['date-parts']?.[0]||item.issued?.['date-parts']?.[0]||[];const year=dateParts[0]||'Tahun tidak diketahui';
      const doi=item.DOI||'';const url=doi?`https://doi.org/${encodeURIComponent(doi)}`:(item.URL||'https://search.crossref.org/');
      const safeURL=/^https?:\/\//i.test(url)?url:'https://search.crossref.org/';
      return `<article class="journal-card"><div class="journal-card-top"><span class="journal-type">${escapeHTML(item.type||'publikasi')}</span><span class="journal-year">${escapeHTML(year)}</span></div><h3>${escapeHTML(title)}</h3><p class="journal-authors">${escapeHTML(authors||'Nama penulis tidak tercantum')}</p><p class="journal-container">${escapeHTML(journal)}</p><div class="journal-card-bottom"><span class="doi-label">${doi?`DOI: ${escapeHTML(doi)}`:'DOI tidak tercantum'}</span><a class="journal-link" href="${escapeHTML(safeURL)}" target="_blank" rel="noopener noreferrer">Buka publikasi ↗</a></div></article>`;
    }).join('');
  }

  function deleteMaterial(id) {
    const material=getMaterial(id);if(!material)return;
    if(!window.confirm(`Hapus materi “${material.title}” dari penyimpanan lokal?`))return;
    state.materials=state.materials.filter(m=>m.id!==id);saveState();renderAll();toast('Materi dihapus.');
  }
  function exportData() {
    const exportState={...state,materials:state.materials.map(({imageData,...m})=>m),exportedAt:new Date().toISOString(),note:'Foto pratinjau tidak disertakan di file ekspor. Teks hasil ekstraksi dan metadata materi ikut disimpan.'};
    const blob=new Blob([JSON.stringify(exportState,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`studia-cadangan-${todayISO()}.json`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);toast('Cadangan data berhasil diunduh.');
  }

  function setupEvents() {
    $$('.nav-item[data-view]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.view)));
    $$('[data-go]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.go)));
    $('#openAddFromHero').addEventListener('click',openAddModal);$('#openAddFromMaterials').addEventListener('click',openAddModal);$('#closeAddModal').addEventListener('click',closeAddModal);$('#cancelAdd').addEventListener('click',closeAddModal);$('#addModal').addEventListener('click',e=>{if(e.target===$('#addModal'))closeAddModal();});
    $('#materialKind').addEventListener('change',setKindFields);$('#pickFile').addEventListener('click',()=>$('#materialFile').click());$('#materialFile').addEventListener('change',e=>setPendingFile(e.target.files?.[0]));$('#addMaterialForm').addEventListener('submit',saveMaterial);
    const zone=$('#uploadZone');['dragenter','dragover'].forEach(evt=>zone.addEventListener(evt,e=>{e.preventDefault();zone.classList.add('dragover');}));['dragleave','drop'].forEach(evt=>zone.addEventListener(evt,e=>{e.preventDefault();zone.classList.remove('dragover');}));zone.addEventListener('drop',e=>setPendingFile(e.dataTransfer?.files?.[0]));
    $('#materialSearch').addEventListener('input',renderMaterialGrid);$('#courseFilter').addEventListener('change',renderMaterialGrid);
    document.addEventListener('click',e=>{const savedSetButton=e.target.closest('[data-load-flashset]');if(savedSetButton){loadFlashcardSet(savedSetButton.dataset.loadFlashset);return;}const action=e.target.closest('[data-action]');if(!action)return;const id=action.dataset.id;const mode=action.dataset.action;if(mode==='delete')return deleteMaterial(id);if(mode==='summarize'){ $('#summaryMaterial').value=id;navigate('summary');generateSummary();}if(mode==='journals'){const m=getMaterial(id);$('#journalQuery').value=m?.title||'';$('#journalMaterialSelect').value=id;navigate('journals');searchJournals(m?.title||'');}});
    $('#generateSummary').addEventListener('click',generateSummary);$('#startQuiz').addEventListener('click',startQuiz);$('#generateFlashcards').addEventListener('click',generateFlashcards);$('#generateMindmap').addEventListener('click',generateMindmap);
    $$('input[name="difficulty"]').forEach(input=>input.addEventListener('change',()=>{$$('.difficulty-option').forEach(label=>label.classList.toggle('selected',label.querySelector('input').checked));}));
    $('#journalSearchForm').addEventListener('submit',e=>{e.preventDefault();searchJournals($('#journalQuery').value);});$('#journalMaterialSelect').addEventListener('change',()=>{const m=getMaterial($('#journalMaterialSelect').value);if(m)$('#journalQuery').value=m.title;});
    $('#exportData').addEventListener('click',exportData);$('#clearData').addEventListener('click',async()=>{if(!confirm('Yakin menghapus SEMUA materi dan progres dari browser ini? Tindakan ini tidak bisa dibatalkan.'))return;state={materials:[],sessions:0,questionsDone:0,dailySessions:0,lastStudyDate:'',flashcardsGenerated:0,flashcardSets:[],learnedCards:0};await saveState();renderAll();toast('Semua data lokal telah dihapus.');});
    $('#menuToggle').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
    $('#helpButton').addEventListener('click',()=>$('#helpModal').classList.remove('hidden'));$('#closeHelp').addEventListener('click',()=>$('#helpModal').classList.add('hidden'));$('#gotHelp').addEventListener('click',()=>$('#helpModal').classList.add('hidden'));
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeAddModal();$('#helpModal').classList.add('hidden');$('#sidebar').classList.remove('open');}});
  }

  async function init() {
    $('#todayLabel').textContent=new Date().toLocaleDateString('id-ID',{weekday:'short',day:'numeric',month:'short'});$('#yearLabel').textContent=new Date().getFullYear();
    await loadState();setupEvents();setKindFields();renderAll();
    // Seed data is not fabricated: show a helpful first-run hint instead.
    const params=new URLSearchParams(location.search);if(params.get('help')==='1')$('#helpModal').classList.remove('hidden');
    try { const response=await fetch('/api/health',{headers:{'Accept':'application/json'}});if(response.ok){const info=await response.json();if(info.aiConfigured){$('#aiSettingsStatus').textContent='AI tersedia untuk fitur opsional';$('#aiSettingsStatus').classList.remove('muted-badge');} } } catch { /* Static hosting/local fallback */ }
  }

  document.addEventListener('DOMContentLoaded',init);
})();
