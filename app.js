// app.js (ESM)
// Firebase v9 modular CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, serverTimestamp,
  collection, addDoc, getDocs, deleteDoc, query, orderBy
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* =========================
   Utilities
========================= */
const el = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad2 = (n) => String(n).padStart(2, "0");

function toISODate(d){
  const dt = (d instanceof Date) ? d : new Date(d);
  dt.setHours(0,0,0,0);
  return dt.toISOString().slice(0,10);
}
function parseISODate(s){
  const dt = new Date(s);
  dt.setHours(0,0,0,0);
  return dt;
}
function addDays(dateISO, days){
  const d = parseISODate(dateISO);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}
function diffDays(startISO, endISO){
  const s = parseISODate(startISO), e = parseISODate(endISO);
  return Math.round((e - s) / 86400000);
}

/* =========================
   Firebase init
========================= */
const fbCfg = window.GANTT_FIREBASE_CONFIG;
if(!fbCfg) {
  alert("חסר firebase-config.js או window.GANTT_FIREBASE_CONFIG");
}
const app = initializeApp(fbCfg);
const auth = getAuth(app);
const db = getFirestore(app);

/* =========================
   Data model (in-memory)
========================= */
/**
 * Project document at: users/{uid}/projects/{projectId}
 * {
 *   name, createdAt, updatedAt,
 *   topics: [{id, name, color}],
 *   tasks: [{id, topicId, topicName, title, desc, start, end}]
 * }
 */
let currentUser = null;
let currentProjectId = null;
let project = null;

const DEFAULT_TOPIC = { id:"unassigned", name:"לא משויך", color:"#9aa4b2" };

/* =========================
   Gantt rendering state
========================= */
let pxDay = 26;
let DATES = [];    // ISO date strings
let WEEKS = [];    // {week, start, end}
let selectedTopicIds = new Set(); // filter

function daysCount(){ return DATES.length; }
function leftPx(dayIdx){ return dayIdx * pxDay; }
function totalW(){ return leftPx(daysCount()); }
function cellLeft(i){ return totalW() - ((i+1) * pxDay); } // RTL
function centerX(i){ return cellLeft(i) + (pxDay/2); }

/* =========================
   UI enable/disable
========================= */
function setUIEnabled(enabled){
  const ids = [
    "btnNewProject","btnOpenProject","btnSaveProject",
    "btnAddTopic","btnUpdateTopic","btnDeleteTopic","topicSelect",
    "taskTopic","taskTitle","taskDesc","taskStart","taskEnd","taskDuration",
    "btnAddTask","btnUpdateTask","btnClearTaskForm",
    "btnExportCSV","btnImportCSV"
  ];
  ids.forEach(id => {
    const e = el(id);
    if(e) e.disabled = !enabled;
  });
}

function setProjectPill(){
  const pill = el("projectPill");
  if(!project){
    pill.textContent = "אין פרויקט";
    pill.title = "Project";
  }else{
    pill.textContent = project.name || "פרויקט";
    pill.title = `Project ID: ${currentProjectId}`;
  }
}

/* =========================
   Auth UI
========================= */
function openModal(modalId){
  const m = el(modalId);
  if(!m) return;
  m.setAttribute("aria-hidden","false");
}
function closeModal(modalId){
  const m = el(modalId);
  if(!m) return;
  m.setAttribute("aria-hidden","true");
}

el("btnOpenAuth").addEventListener("click", () => openModal("authModal"));
el("btnCloseAuth").addEventListener("click", () => closeModal("authModal"));

el("btnLogin").addEventListener("click", async () => {
  const email = el("authEmail").value.trim();
  const pass  = el("authPass").value;
  try{
    await signInWithEmailAndPassword(auth, email, pass);
    el("authMsg").textContent = "התחברת בהצלחה.";
    closeModal("authModal");
  }catch(err){
    el("authMsg").textContent = err?.message || String(err);
  }
});

el("btnRegister").addEventListener("click", async () => {
  const email = el("authEmail").value.trim();
  const pass  = el("authPass").value;
  try{
    await createUserWithEmailAndPassword(auth, email, pass);
    el("authMsg").textContent = "נוצר משתמש והתחברת.";
    closeModal("authModal");
  }catch(err){
    el("authMsg").textContent = err?.message || String(err);
  }
});

el("btnLogout").addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async (u) => {
  currentUser = u || null;

  const btnOpen = el("btnOpenAuth");
  const btnOut  = el("btnLogout");
  if(currentUser){
    btnOpen.style.display = "none";
    btnOut.style.display = "";
    setUIEnabled(true);
  }else{
    btnOpen.style.display = "";
    btnOut.style.display = "none";
    setUIEnabled(false);
    // reset
    currentProjectId = null;
    project = null;
    renderAll();
  scheduleAutosave();
    setProjectPill();
  }
});

/* =========================
   Project CRUD
========================= */
async function listProjects(){
  const listEl = el("projectsList");
  listEl.innerHTML = "";
  if(!currentUser) return;

  const colRef = collection(db, "users", currentUser.uid, "projects");
  const q = query(colRef, orderBy("updatedAt","desc"));
  const snap = await getDocs(q);

  if(snap.empty){
    listEl.innerHTML = `<div class="hint">אין עדיין פרויקטים. צור חדש למעלה.</div>`;
    return;
  }

  snap.forEach(docSnap => {
    const d = docSnap.data();
    const item = document.createElement("div");
    item.className = "list-item";

    const left = document.createElement("div");
    left.innerHTML = `
      <div class="name">${escapeHTML(d.name || "ללא שם")}</div>
      <div class="meta">${d.updatedAt?.toDate ? ("עודכן: " + d.updatedAt.toDate().toLocaleString("he-IL")) : ""}</div>
    `;

    const right = document.createElement("div");
    right.className = "right";

    const btnOpen = document.createElement("button");
    btnOpen.className = "btn primary";
    btnOpen.textContent = "פתח";
    btnOpen.addEventListener("click", async () => {
      await loadProject(docSnap.id);
      closeModal("projectModal");
    });

  btnDel.addEventListener("click", async (e) => {
  e.preventDefault();

  if(!currentUser || !currentUser.uid) return;

  const ok = confirm(
    `למחוק את הפרויקט "${d.name}"?\n\n` +
    `⚠️ פעולה זו תמחק את כל המשימות והנתונים ואינה ניתנת לשחזור.`
  );
  if(!ok) return;

  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "projects", docSnap.id));

    if(currentProjectId === docSnap.id){
      currentProjectId = null;
      project = null;
      renderAll();
      setProjectPill();
    }

    await listProjects();
  } catch(err){
    console.error("Failed to delete project:", err);
    alert("אירעה שגיאה במחיקת הפרויקט");
  }
});


    right.appendChild(btnOpen);
    right.appendChild(btnDel);

    item.appendChild(left);
    item.appendChild(right);
    listEl.appendChild(item);
  });
}

async function createProject(name){
  if(!currentUser) return;
  const docRef = await addDoc(collection(db, "users", currentUser.uid, "projects"), {
    name: name || "פרויקט ללא שם",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    topics: [DEFAULT_TOPIC],
    tasks: []
  });
  await loadProject(docRef.id);
}

async function loadProject(projectId){
  if(!currentUser) return;
  const ref = doc(db, "users", currentUser.uid, "projects", projectId);
  const snap = await getDoc(ref);
  if(!snap.exists()){
    alert("הפרויקט לא נמצא.");
    return;
  }
  currentProjectId = projectId;
  project = normalizeProject(snap.data());
  // default selection = all topics visible
  selectedTopicIds = new Set(project.topics.map(t=>t.id));
  persistSelection();
  renderAll();
  setProjectPill();
}

async function saveProject(){
  if(!currentUser || !project || !currentProjectId) return;
  const ref = doc(db, "users", currentUser.uid, "projects", currentProjectId);
  await updateDoc(ref, {
    name: project.name,
    topics: project.topics,
    tasks: project.tasks,
    updatedAt: serverTimestamp()
  });
  // refresh list (optional)
}

// Debounced autosave: persists edits (topics/tasks/import) without requiring manual "שמור"
let _autosaveTimer = null;
async function autosaveNow(){
  try{
    await saveProject();
    // optional: lightweight indicator (no alert)
    const pill = document.getElementById("projectPill");
    if(pill){
      pill.dataset.savedAt = String(Date.now());
    }
  }catch(err){
    console.error("Autosave failed:", err);
    // If rules/auth issues, this will show in console (and you'll see it in Network)
  }
}
function scheduleAutosave(){
  if(!currentUser || !project || !currentProjectId) return;
  if(_autosaveTimer) clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(autosaveNow, 450);
}


function normalizeProject(p){
  const topics = Array.isArray(p.topics) ? p.topics : [];
  const tasks  = Array.isArray(p.tasks) ? p.tasks : [];
  // ensure DEFAULT_TOPIC exists
  let hasUn = topics.some(t => t.id === DEFAULT_TOPIC.id);
  const t2 = hasUn ? topics : [DEFAULT_TOPIC, ...topics];
  return {
    name: p.name || "פרויקט",
    topics: t2.map(t => ({
      id: String(t.id || ""),
      name: String(t.name || ""),
      color: String(t.color || "#9aa4b2")
    })),
    tasks: tasks.map(t => ({
      id: String(t.id || crypto.randomUUID()),
      topicId: String(t.topicId || DEFAULT_TOPIC.id),
      title: String(t.title || ""),
      desc: String(t.desc || ""),
      start: String(t.start || ""),
      end: String(t.end || "")
    }))
  };
}

/* Project modal wiring */
el("btnOpenProject").addEventListener("click", async () => {
  if(!currentUser) return;
  await listProjects();
  openModal("projectModal");
});
el("btnCloseProjectModal").addEventListener("click", () => closeModal("projectModal"));

el("btnNewProject").addEventListener("click", () => {
  el("projectModalTitle").textContent = "פרויקט חדש / פתיחה";
  openModal("projectModal");
  // focus on name input
  setTimeout(()=> el("newProjectName").focus(), 50);
});
el("btnCreateProject").addEventListener("click", async () => {
  const name = el("newProjectName").value.trim();
  if(!name){
    alert("צריך שם לפרויקט.");
    return;
  }
  await createProject(name);
  el("newProjectName").value = "";
  closeModal("projectModal");
});
el("btnSaveProject").addEventListener("click", async () => {
  try{
    await saveProject();
    alert("נשמר ✅");
  }catch(e){
    console.error(e);
    alert("שגיאה בשמירה. בדוק Console/Network");
  }
});

/* =========================
   Topics CRUD
========================= */
function topicById(id){
  return project?.topics?.find(t => t.id === id) || null;
}
function rebuildTopicSelects(){
  const sel = el("topicSelect");
  const taskSel = el("taskTopic");
  if(!sel || !taskSel) return;

  sel.innerHTML = "";
  taskSel.innerHTML = "";

  // topic select (for edit)
  project.topics.forEach(t => {
    const o = document.createElement("option");
    o.value = t.id;
    o.textContent = t.name || t.id;
    sel.appendChild(o);
  });

  // task topic select (include unassigned)
  project.topics.forEach(t => {
    const o = document.createElement("option");
    o.value = t.id;
    o.textContent = t.name || t.id;
    taskSel.appendChild(o);
  });
}

function refreshChips(){
  const host = el("topicsChips");
  host.innerHTML = "";

  project.topics.forEach(t => {
    const label = document.createElement("label");
    label.className = "chip";
    if(selectedTopicIds.has(t.id)) label.classList.add("active");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selectedTopicIds.has(t.id);
    cb.addEventListener("change", () => {
      if(cb.checked) selectedTopicIds.add(t.id);
      else selectedTopicIds.delete(t.id);
      label.classList.toggle("active", cb.checked);
      persistSelection();
      renderAll(); // re-render gantt blocks
    });

    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = t.color;

    const txt = document.createElement("span");
    txt.textContent = t.name;

    label.appendChild(cb);
    label.appendChild(sw);
    label.appendChild(txt);
    host.appendChild(label);
  });
}

function persistSelection(){
  try{
    if(!project || !currentProjectId) return;
    localStorage.setItem(`gantt_sel_${currentProjectId}`, JSON.stringify([...selectedTopicIds]));
  }catch(e){}
}
function restoreSelection(){
  try{
    if(!project || !currentProjectId) return;
    const raw = localStorage.getItem(`gantt_sel_${currentProjectId}`);
    if(!raw) return;
    const arr = JSON.parse(raw);
    if(Array.isArray(arr)){
      selectedTopicIds = new Set(arr);
    }
  }catch(e){}
}

el("btnAll").addEventListener("click", () => {
  if(!project) return;
  selectedTopicIds = new Set(project.topics.map(t=>t.id));
  persistSelection();
  refreshChips();
  renderAll();
});
el("btnClear").addEventListener("click", () => {
  if(!project) return;
  selectedTopicIds = new Set();
  persistSelection();
  refreshChips();
  renderAll();
});

el("btnAddTopic").addEventListener("click", () => {
  if(!project) return;
  const name = el("topicName").value.trim();
  const color = el("topicColor").value || "#1f77b4";
  if(!name){ alert("צריך שם נושא."); return; }

  const id = slugId(name);
  if(project.topics.some(t=>t.id === id)){
    alert("נושא כבר קיים (לפי מזהה). נסה שם אחר.");
    return;
  }
  project.topics.push({id, name, color});
  selectedTopicIds.add(id);
  rebuildTopicSelects();
  refreshChips();
  renderAll();
  scheduleAutosave();
  el("topicName").value = "";
});

el("topicSelect").addEventListener("change", () => {
  if(!project) return;
  const id = el("topicSelect").value;
  const t = topicById(id);
  if(!t) return;
  el("topicName").value = t.name;
  el("topicColor").value = t.color;
});

el("btnUpdateTopic").addEventListener("click", () => {
  if(!project) return;
  const id = el("topicSelect").value;
  const t = topicById(id);
  if(!t) return;

  if(id === DEFAULT_TOPIC.id){
    alert('את "לא משויך" לא משנים (שמור כמערכת).');
    return;
  }

  const name = el("topicName").value.trim();
  const color = el("topicColor").value || t.color;

  if(!name){ alert("צריך שם נושא."); return; }
  t.name = name;
  t.color = color;

  // update tasks that depend on topic name in table or chips - we store id only, so OK.
  rebuildTopicSelects();
  refreshChips();
  renderAll();
});

el("btnDeleteTopic").addEventListener("click", () => {
  if(!project) return;
  const id = el("topicSelect").value;
  if(id === DEFAULT_TOPIC.id){
    alert('את "לא משויך" לא מוחקים.');
    return;
  }
  const t = topicById(id);
  if(!t) return;

  if(!confirm(`למחוק את הנושא "${t.name}"?`)) return;

  // move tasks to unassigned
  project.tasks.forEach(tsk => {
    if(tsk.topicId === id) tsk.topicId = DEFAULT_TOPIC.id;
  });

  project.topics = project.topics.filter(x => x.id !== id);
  selectedTopicIds.delete(id);

  rebuildTopicSelects();
  refreshChips();
  renderAll();
  scheduleAutosave();
});

function slugId(name){
  // stable id, allow Hebrew/English, remove spaces
  const s = name.trim().toLowerCase().replace(/\s+/g,'-');
  return s || crypto.randomUUID();
}

/* =========================
   Tasks CRUD
========================= */
let editingTaskId = null;

function clearTaskForm(){
  editingTaskId = null;
  el("taskTopic").value = DEFAULT_TOPIC.id;
  el("taskTitle").value = "";
  el("taskDesc").value = "";
  el("taskStart").value = "";
  el("taskEnd").value = "";
  el("taskDuration").value = "";
  el("btnAddTask").disabled = false;
  el("btnUpdateTask").disabled = true;
}

el("btnClearTaskForm").addEventListener("click", clearTaskForm);

el("taskDuration").addEventListener("input", () => {
  const start = el("taskStart").value;
  const dur = parseInt(el("taskDuration").value,10);
  if(start && Number.isFinite(dur) && dur > 0){
    // end inclusive: start + (dur-1)
    el("taskEnd").value = addDays(start, dur-1);
  }
});

el("taskStart").addEventListener("change", () => {
  const dur = parseInt(el("taskDuration").value,10);
  const start = el("taskStart").value;
  if(start && Number.isFinite(dur) && dur > 0){
    el("taskEnd").value = addDays(start, dur-1);
  }
});

el("taskEnd").addEventListener("change", () => {
  const s = el("taskStart").value;
  const e = el("taskEnd").value;
  if(s && e){
    const d = diffDays(s,e) + 1; // inclusive
    if(d > 0) el("taskDuration").value = String(d);
  }
});

el("btnAddTask").addEventListener("click", () => {
  if(!project) return;
  const topicId = el("taskTopic").value || DEFAULT_TOPIC.id;
  const title = el("taskTitle").value.trim();
  const desc  = el("taskDesc").value.trim();
  const start = el("taskStart").value;
  let end = el("taskEnd").value;

  if(!title){ alert("צריך כותרת."); return; }
  if(!start){ alert("צריך תאריך התחלה."); return; }

  // If end missing but duration exists => compute
  const dur = parseInt(el("taskDuration").value,10);
  if(!end && Number.isFinite(dur) && dur>0){
    end = addDays(start, dur-1);
    el("taskEnd").value = end;
  }
  if(!end){ alert("צריך תאריך סיום או משך."); return; }

  if(parseISODate(end) < parseISODate(start)){
    alert("תאריך סיום לא יכול להיות לפני התחלה.");
    return;
  }

  project.tasks.push({
    id: crypto.randomUUID(),
    topicId,
    title,
    desc,
    start,
    end
  });

  clearTaskForm();
  renderAll();
  scheduleAutosave();
});

el("btnUpdateTask").addEventListener("click", () => {
  if(!project || !editingTaskId) return;
  const t = project.tasks.find(x => x.id === editingTaskId);
  if(!t) return;

  const topicId = el("taskTopic").value || DEFAULT_TOPIC.id;
  const title = el("taskTitle").value.trim();
  const desc  = el("taskDesc").value.trim();
  const start = el("taskStart").value;
  const end   = el("taskEnd").value;

  if(!title || !start || !end){
    alert("חסר מידע (כותרת/תאריך).");
    return;
  }
  if(parseISODate(end) < parseISODate(start)){
    alert("תאריך סיום לא יכול להיות לפני התחלה.");
    return;
  }

  t.topicId = topicId;
  t.title = title;
  t.desc = desc;
  t.start = start;
  t.end = end;

  clearTaskForm();
  renderAll();
  scheduleAutosave();
});

function startEditTask(taskId){
  const t = project.tasks.find(x => x.id === taskId);
  if(!t) return;
  editingTaskId = taskId;

  el("taskTopic").value = t.topicId;
  el("taskTitle").value = t.title;
  el("taskDesc").value = t.desc || "";
  el("taskStart").value = t.start;
  el("taskEnd").value = t.end;

  const d = diffDays(t.start,t.end) + 1;
  el("taskDuration").value = String(d);

  el("btnAddTask").disabled = true;
  el("btnUpdateTask").disabled = false;
}

function deleteTask(taskId){
  const t = project.tasks.find(x => x.id === taskId);
  if(!t) return;
  if(!confirm(`למחוק את המשימה "${t.title}"?`)) return;
  project.tasks = project.tasks.filter(x => x.id !== taskId);
  if(editingTaskId === taskId) clearTaskForm();
  renderAll();
}

/* =========================
   Tasks table
========================= */
function renderTasksTable(){
  const tbody = el("tasksTbody");
  tbody.innerHTML = "";
  if(!project) return;

  const topicsMap = new Map(project.topics.map(t=>[t.id,t]));
  const rows = [...project.tasks].sort((a,b) => (a.start||"").localeCompare(b.start||""));

  rows.forEach(task => {
    const tr = document.createElement("tr");
    const topic = topicsMap.get(task.topicId) || DEFAULT_TOPIC;
    const dur = (task.start && task.end) ? (diffDays(task.start, task.end) + 1) : "";

    tr.innerHTML = `
      <td><span class="mono" style="color:${escapeAttr(topic.color)}">${escapeHTML(topic.name)}</span></td>
      <td>${escapeHTML(task.title)}</td>
      <td class="mono">${escapeHTML(task.start)}</td>
      <td class="mono">${escapeHTML(task.end)}</td>
      <td class="mono">${dur}</td>
      <td>${escapeHTML(task.desc||"")}</td>
      <td class="actions">
        <button class="btn" data-act="edit">ערוך</button>
        <button class="btn danger" data-act="del">מחק</button>
      </td>
    `;

    tr.querySelector('[data-act="edit"]').addEventListener("click", ()=> startEditTask(task.id));
    tr.querySelector('[data-act="del"]').addEventListener("click", ()=> deleteTask(task.id));
    tbody.appendChild(tr);
  });
}

/* =========================
   CSV import / export
========================= */
el("btnExportCSV").addEventListener("click", () => {
  if(!project) return;
  const csv = buildCSV(project);
  downloadText(csv, `${safeFile(project.name)}.csv`, "text/csv;charset=utf-8");
});

el("btnImportCSV").addEventListener("click", () => {
  el("csvFile").click();
});

el("csvFile").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if(!f) return;

  const text = await f.text();
  try{
    const imported = parseCSV(text);
    applyImportedTasks(imported);
    renderAll();
    alert("יבוא CSV הושלם ✅");
  }catch(err){
    alert("יבוא CSV נכשל: " + (err?.message || String(err)));
  }finally{
    e.target.value = "";
  }
});

// Columns (Hebrew) - matches UI
const CSV_COLUMNS = ["topic","title","start","end","duration_days","desc"];

function buildCSV(proj){
  const topicsMap = new Map(proj.topics.map(t=>[t.id,t]));
  const rows = [CSV_COLUMNS.join(",")];

  proj.tasks.forEach(t => {
    const topic = topicsMap.get(t.topicId) || DEFAULT_TOPIC;
    const dur = (t.start && t.end) ? (diffDays(t.start,t.end) + 1) : "";
    const vals = [
      topic.name,
      t.title,
      t.start,
      t.end,
      dur,
      t.desc || ""
    ].map(csvEscape);
    rows.push(vals.join(","));
  });

  return "\uFEFF" + rows.join("\n"); // BOM for Excel Hebrew
}

function parseCSV(text){
  // minimal CSV parser supporting quotes
  const rows = [];
  let i=0, field="", row=[], inQuotes=false;

  const pushField=()=>{ row.push(field); field=""; };
  const pushRow=()=>{ rows.push(row); row=[]; };

  while(i < text.length){
    const c = text[i];

    if(inQuotes){
      if(c === '"'){
        if(text[i+1] === '"'){ field += '"'; i+=2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }else{
      if(c === '"'){ inQuotes=true; i++; continue; }
      if(c === ','){ pushField(); i++; continue; }
      if(c === '\n'){ pushField(); pushRow(); i++; continue; }
      if(c === '\r'){ i++; continue; }
      field += c; i++; continue;
    }
  }
  pushField(); pushRow();

  // remove empty last row
  while(rows.length && rows[rows.length-1].every(x => (x||"").trim()==="")) rows.pop();

  // header
  const header = rows.shift() || [];
  const idx = {};
  header.forEach((h, j)=> idx[(h||"").trim()] = j);

  // accept both English/Hebrew headers
  const get = (r, key) => {
    const j = idx[key];
    return (j==null) ? "" : (r[j] ?? "");
  };

  return rows.map(r => ({
    topic: (get(r,"topic") || get(r,"נושא") || "").trim(),
    title: (get(r,"title") || get(r,"כותרת") || "").trim(),
    start: (get(r,"start") || get(r,"תאריך התחלה") || "").trim(),
    end: (get(r,"end") || get(r,"תאריך סיום") || "").trim(),
    duration_days: (get(r,"duration_days") || get(r,"משך (ימים)") || "").trim(),
    desc: (get(r,"desc") || get(r,"תיאור") || "").trim()
  }));
}

function applyImportedTasks(imported){
  if(!project) return;
  const nameToId = new Map(project.topics.map(t => [t.name, t.id]));

  imported.forEach(row => {
    if(!row.title) return;

    // topic: create if doesn't exist
    let topicId = DEFAULT_TOPIC.id;
    if(row.topic){
      if(nameToId.has(row.topic)){
        topicId = nameToId.get(row.topic);
      }else{
        const newId = slugId(row.topic);
        if(!project.topics.some(t=>t.id===newId)){
          project.topics.push({id:newId, name: row.topic, color: randomColorFromName(row.topic)});
        }
        topicId = newId;
        nameToId.set(row.topic, newId);
      }
    }

    // dates
    let start = row.start;
    let end = row.end;

    // If duration exists and end missing => compute
    const dur = parseInt(row.duration_days,10);
    if(start && !end && Number.isFinite(dur) && dur>0){
      end = addDays(start, dur-1);
    }
    if(!start || !end) return;

    // normalize
    start = toISODate(start);
    end = toISODate(end);

    project.tasks.push({
      id: crypto.randomUUID(),
      topicId,
      title: row.title,
      desc: row.desc || "",
      start,
      end
    });
  });

  // refresh selects/chips
  rebuildTopicSelects();
  refreshChips();
}

function randomColorFromName(name){
  // deterministic-ish color from string
  let h = 0;
  for(let i=0;i<name.length;i++) h = (h*31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 70% 60%)`;
}

function csvEscape(v){
  const s = String(v ?? "");
  if(/[",\n\r]/.test(s)) return `"${s.replaceAll('"','""')}"`;
  return s;
}
function downloadText(text, filename, mime){
  const blob = new Blob([text], {type: mime || "text/plain"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(()=> URL.revokeObjectURL(a.href), 1500);
}
function safeFile(name){
  return (name || "project").replace(/[^\w\u0590-\u05FF-]+/g, "_").slice(0,80);
}

/* =========================
   Gantt: build date range + week/month bands
========================= */
function computeDateRange(){
  if(!project || project.tasks.length === 0){
    // fallback: today +- 15 days
    const today = new Date(); today.setHours(0,0,0,0);
    const start = new Date(today); start.setDate(start.getDate()-15);
    const end = new Date(today); end.setDate(end.getDate()+45);
    return {min: toISODate(start), max: toISODate(end)};
  }

  let min = project.tasks[0].start;
  let max = project.tasks[0].end;
  project.tasks.forEach(t => {
    if(t.start && t.start < min) min = t.start;
    if(t.end && t.end > max) max = t.end;
  });

  // add padding
  // add padding
  min = addDays(min, -2);
  max = addDays(max,  2);

  // --- FORCE timeline to fill available width ---
  const dateCol = el("dateCol");
  const viewportW = dateCol ? dateCol.clientWidth : 0;
  const minDaysToFill = Math.max(30, Math.ceil(viewportW / pxDay)); // לפחות 30 יום
  const spanDays = diffDays(min, max) + 1;

  if (spanDays < minDaysToFill) {
    const extra = minDaysToFill - spanDays;
    // RTL אצלך: הרחבת max תאריך "שמאלה" תגדיל את הציר לרוחב
    max = addDays(max, extra);
  }

  return {min, max};

}

function buildDATES(minISO, maxISO){
  const out = [];
  let d = parseISODate(minISO);
  const end = parseISODate(maxISO);
  while(d <= end){
    out.push(toISODate(d));
    d.setDate(d.getDate()+1);
  }
  return out;
}

function buildWEEKS(){
  // ISO week number (approx) for labeling; segments use Monday boundaries
  // We'll compute week segments by scanning dates and starting a new segment on Monday.
  const segs = [];
  if(DATES.length === 0) return segs;

  const weekNum = (date) => {
    // ISO week number
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  };

  let segStart = 0;
  let curWeek = null;

  for(let i=0;i<DATES.length;i++){
    const dt = parseISODate(DATES[i]);
    const w = weekNum(dt);

    // start new segment on Monday (day 1) except for i=0
    const isMonday = (dt.getDay() === 1);
    if(i === 0){
      curWeek = w;
      segStart = 0;
    }else if(isMonday){
      segs.push({week: curWeek, start: segStart, end: i});
      curWeek = w;
      segStart = i;
    }
  }
  segs.push({week: curWeek, start: segStart, end: DATES.length});
  return segs;
}

function renderScale(){
  const monthBand = el("monthBand");
  const weekBand  = el("weekBand");
  const dayScale  = el("dayScale");
  const grid      = el("grid");

  monthBand.innerHTML = "";
  weekBand.innerHTML  = "";
  grid.innerHTML      = "";

  // remove previous .day nodes
  dayScale.querySelectorAll(".day").forEach(n => n.remove());

  // Months segments
  const monthSegs = [];
  let curM = null, segStart = 0;

  for(let i=0;i<DATES.length;i++){
    const dt = parseISODate(DATES[i]);
    const m = dt.toLocaleString("en-GB", {month:"short", year:"numeric"});
    if(m !== curM){
      if(curM !== null){
        monthSegs.push({label: curM, width: (leftPx(i) - leftPx(segStart))});
      }
      curM = m; segStart = i;
    }
  }
  monthSegs.push({label: curM, width: (leftPx(daysCount()) - leftPx(segStart))});

  for(let ms = monthSegs.length-1; ms>=0; ms--){
    const div = document.createElement("div");
    div.style.width = monthSegs[ms].width + "px";
    div.style.textAlign = "center";
    div.textContent = monthSegs[ms].label;
    monthBand.appendChild(div);
  }

  // Weeks
  for(let w=WEEKS.length-1; w>=0; w--){
    const segW = leftPx(WEEKS[w].end) - leftPx(WEEKS[w].start);
    const div = document.createElement("div");
    div.className = "week-cell";
    div.style.width = segW + "px";
    div.textContent = "Week " + WEEKS[w].week;
    weekBand.appendChild(div);
  }

  // Days + grid
  for(let j=0;j<daysCount();j++){
    const g = document.createElement("div");
    g.style.left = cellLeft(j) + "px";
    g.style.width = pxDay + "px";
    grid.appendChild(g);

    const d = document.createElement("div");
    d.className = "day";
    d.style.left = cellLeft(j) + "px";

    const s = document.createElement("span");
    s.className = "txt";
    const dt = parseISODate(DATES[j]);
    s.textContent = `${pad2(dt.getDate())}.${pad2(dt.getMonth()+1)}`;
    d.appendChild(s);
    dayScale.appendChild(d);
  }

  // today line
  const todayLine = el("todayLine");
  const today = new Date(); today.setHours(0,0,0,0);
  const min = parseISODate(DATES[0]);
  const idx = Math.round((today - min) / 86400000);
  const safeIdx = clamp(idx, 0, daysCount()-1);
  todayLine.style.left = centerX(safeIdx) + "px";
}

function positionMarkers(){
  const boundaryX = totalW(); // right edge of timeline (near labels)
  document.querySelectorAll(".connector").forEach(elm => {
    const s = parseInt(elm.getAttribute("data-start"),10);
    const xs = centerX(s);
    const left = Math.min(xs, boundaryX);
    const w = Math.abs(boundaryX - xs);
    elm.style.left = left + "px";
    elm.style.width = w + "px";
  });

  document.querySelectorAll(".pin[data-start]").forEach(p => {
    const s = parseInt(p.getAttribute("data-start"),10);
    p.style.left = (centerX(s) - 5) + "px";
  });

  document.querySelectorAll(".date-tag[data-start]").forEach(t => {
    const s = parseInt(t.getAttribute("data-start"),10);
    t.style.left = centerX(s) + "px";
  });

  document.querySelectorAll(".range-line").forEach(rl => {
    const s = parseInt(rl.getAttribute("data-start"),10);
    const e = parseInt(rl.getAttribute("data-end"),10);
    const xs = centerX(s), xe = centerX(e);
    rl.style.left = Math.min(xs,xe) + "px";
    rl.style.width = Math.abs(xe-xs) + "px";
  });

  document.querySelectorAll(".pin[data-end]").forEach(p => {
    const e = parseInt(p.getAttribute("data-end"),10);
    p.style.left = (centerX(e) - 5) + "px";
  });

  document.querySelectorAll(".date-tag[data-end]").forEach(t => {
    const e = parseInt(t.getAttribute("data-end"),10);
    t.style.left = centerX(e) + "px";
  });

  el("timeline").style.minWidth = totalW() + "px";
}

/* Draw dashed links from label boundary to each start pin */
function drawLinks(){
  const gantt = el("gantt");
  const svg = el("linkLayer");
  const labelCol = el("labelCol");
  if(!gantt || !svg || !labelCol) return;

  svg.innerHTML = "";

  const ganttRect = gantt.getBoundingClientRect();
  if(ganttRect.width < 10 || ganttRect.height < 10) return;

  svg.setAttribute("width", Math.round(ganttRect.width));
  svg.setAttribute("height", Math.round(ganttRect.height));
  svg.setAttribute("viewBox", `0 0 ${Math.round(ganttRect.width)} ${Math.round(ganttRect.height)}`);

  const labelColRect = labelCol.getBoundingClientRect();

  const labelBlocks = document.querySelectorAll(".label-col .topic-block.label-block");
  labelBlocks.forEach(lb => {
    const topicId = lb.getAttribute("data-topic-id");
    const db = document.querySelector(`.date-col .topic-block.date-block[data-topic-id="${cssEscape(topicId)}"]`);
    if(!db) return;
    if(getComputedStyle(lb).display === "none" || getComputedStyle(db).display === "none") return;

    const tc = (getComputedStyle(lb).getPropertyValue("--tc") || "").trim() || "#ddd";
    const dateRows = db.querySelectorAll(".rows > .row");
    dateRows.forEach(dr => {
      const pinEl = dr.querySelector(".pin[data-start]");
      if(!pinEl) return;

      const r2 = pinEl.getBoundingClientRect();
      const y = (r2.top + r2.height/2) - ganttRect.top;

      const x1 = (labelColRect.right - ganttRect.left) - 6;
      const x2 = (r2.left + r2.width/2) - ganttRect.left;

      if(!isFinite(x1) || !isFinite(x2) || !isFinite(y)) return;

      const line = document.createElementNS("http://www.w3.org/2000/svg","line");
      line.setAttribute("x1", x1.toFixed(1));
      line.setAttribute("y1", y.toFixed(1));
      line.setAttribute("x2", x2.toFixed(1));
      line.setAttribute("y2", y.toFixed(1));
      line.setAttribute("stroke", tc);
      line.setAttribute("stroke-width", "1");
      line.setAttribute("stroke-dasharray", "3 4");
      line.setAttribute("opacity", "0.35");
      svg.appendChild(line);
    });
  });
}

/* =========================
   Gantt blocks rendering (dynamic)
========================= */
function buildTaskGroups(){
  const groups = new Map(); // topicId -> tasks
  project.topics.forEach(t => groups.set(t.id, []));
  project.tasks.forEach(task => {
    const tid = groups.has(task.topicId) ? task.topicId : DEFAULT_TOPIC.id;
    if(!groups.has(tid)) groups.set(tid, []);
    groups.get(tid).push(task);
  });

  // sort each group by start
  groups.forEach(arr => arr.sort((a,b) => (a.start||"").localeCompare(b.start||"")));

  return groups;
}

function renderBlocks(){
  const labelCol = el("labelCol");
  const dateBlocksHost = el("dateBlocks");
  labelCol.innerHTML = "";
  dateBlocksHost.innerHTML = "";

  if(!project) return;

  const topics = project.topics;
  const groups = buildTaskGroups();

  // for each topic, if not selected -> hide
  topics.forEach(topic => {
    const visible = selectedTopicIds.has(topic.id);

    // LABEL BLOCK
    const lb = document.createElement("div");
    lb.className = "topic-block label-block";
    lb.setAttribute("data-topic-id", topic.id);
    lb.style.setProperty("--tc", topic.color);

    lb.style.display = visible ? "block" : "none";

    const rows = document.createElement("div");
    rows.className = "rows";

    const tasks = groups.get(topic.id) || [];
    tasks.forEach((task, idx) => {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `
        <div class="row-bg"></div>
        <div class="label" style="color:${escapeAttr(topic.color)}" title="${escapeAttr(task.title)}">
          ${escapeHTML(task.title)}
        </div>
      `;
      rows.appendChild(row);
    });

    // If no tasks in this topic, still show a single empty row to keep topic visible? (optional)
    if(tasks.length === 0){
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<div class="row-bg"></div><div class="label" style="color:${escapeAttr(topic.color)}; opacity:0.55">—</div>`;
      rows.appendChild(row);
    }

    lb.appendChild(rows);
    labelCol.appendChild(lb);

    // DATE BLOCK
    const db = document.createElement("div");
    db.className = "topic-block date-block";
    db.setAttribute("data-topic-id", topic.id);
    db.style.setProperty("--tc", topic.color);
    db.style.display = visible ? "block" : "none";

    const drows = document.createElement("div");
    drows.className = "rows";

    const tasks2 = groups.get(topic.id) || [];
    tasks2.forEach(task => {
      const row = document.createElement("div");
      row.className = "row";

      // convert dates to indices
      const sIdx = DATES.indexOf(task.start);
      const eIdx = DATES.indexOf(task.end);

      const tagStart = task.start ? formatDDMM(task.start) : "";
      const tagEnd   = task.end ? formatDDMM(task.end) : "";

      // fallback if out of range
      const s = clamp(sIdx, 0, daysCount()-1);
      const e = clamp(eIdx, 0, daysCount()-1);

      if(e > s){
        row.innerHTML = `
          <div class="connector" data-start="${s}"></div>
          <div class="pin" data-start="${s}"></div>
          <div class="date-tag" data-start="${s}">${escapeHTML(tagStart)}</div>

          <div class="range-line" data-start="${s}" data-end="${e}"></div>

          <div class="pin" data-end="${e}"></div>
          <div class="date-tag" data-end="${e}">${escapeHTML(tagEnd)}</div>
        `;
      }else{
        row.innerHTML = `
          <div class="connector" data-start="${s}"></div>
          <div class="pin" data-start="${s}"></div>
          <div class="date-tag" data-start="${s}">${escapeHTML(tagStart)}</div>
        `;
      }

      drows.appendChild(row);
    });

    if(tasks2.length === 0){
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<div class="row-bg"></div>`;
      drows.appendChild(row);
    }

    db.appendChild(drows);
    dateBlocksHost.appendChild(db);
  });
}

function formatDDMM(iso){
  const d = parseISODate(iso);
  return `${pad2(d.getDate())}.${pad2(d.getMonth()+1)}`;
}

function renderAll(){
  setProjectPill();

  if(!project){
    el("labelCol").innerHTML = `<div class="pad small"><div class="hint">התחבר, ואז צור/פתח פרויקט.</div></div>`;
    el("dateBlocks").innerHTML = "";
    el("monthBand").innerHTML = "";
    el("weekBand").innerHTML = "";
    el("grid").innerHTML = "";
    el("dayScale").querySelectorAll(".day").forEach(n=>n.remove());
    el("tasksTbody").innerHTML = "";
    return;
  }

  // rebuild selects
  rebuildTopicSelects();
  refreshChips();

  // date range
  const {min, max} = computeDateRange();
  DATES = buildDATES(min, max);
  WEEKS = buildWEEKS();

  // render timeline + blocks
  renderScale();
  renderBlocks();
  renderTasksTable();

  positionMarkers();
  drawLinks();

  // ensure default topic is selected in edit dropdowns
  if(!el("taskTopic").value) el("taskTopic").value = DEFAULT_TOPIC.id;

  // enable correct buttons
  el("btnSaveProject").disabled = false;
  el("btnExportCSV").disabled = false;
  el("btnImportCSV").disabled = false;
}

window.addEventListener("resize", drawLinks);
el("dateCol").addEventListener("scroll", () => drawLinks(), {passive:true});

/* =========================
   Zoom
========================= */
function setPxDay(val){
  pxDay = clamp(val, 16, 48);
  document.documentElement.style.setProperty("--pxDay", pxDay + "px");
  el("pxInfo").textContent = pxDay;
  renderScale();
  positionMarkers();
  drawLinks();
}

el("zoomOut").addEventListener("click", () => setPxDay(pxDay - 2));
el("zoomIn").addEventListener("click", () => setPxDay(pxDay + 2));
el("zoomReset").addEventListener("click", () => setPxDay(26));

/* =========================
   Top buttons
========================= */
el("btnNewProject").addEventListener("click", () => openModal("projectModal"));
el("btnOpenProject").addEventListener("click", () => openModal("projectModal"));

/* =========================
   Init
========================= */
document.addEventListener("DOMContentLoaded", async () => {
  setPxDay(26);
  setProjectPill();

  // enable project buttons only when authenticated
  onAuthStateChanged(auth, async (u) => {
    if(u){
      el("btnNewProject").disabled = false;
      el("btnOpenProject").disabled = false;

      // open project picker on first login
      await listProjects();
    }else{
      el("btnNewProject").disabled = true;
      el("btnOpenProject").disabled = true;
    }
  });

  // keep "topicSelect" in sync to show current values
  el("topicSelect").dispatchEvent(new Event("change"));
  clearTaskForm();
});

/* =========================
   Security helpers
========================= */
function escapeHTML(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}
function escapeAttr(s){ return escapeHTML(s).replace(/`/g,"&#96;"); }
function cssEscape(s){
  // basic CSS escape for attribute selectors
  return String(s ?? "").replace(/"/g, '\\"');
}
