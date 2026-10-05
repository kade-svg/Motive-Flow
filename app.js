const USER_KEY = "motive-flow-users-v1";
const SESSION_KEY = "motive-flow-session-v1";
const THEME_KEY = "motive-flow-theme-v1";
const DATA_PREFIX = "motive-flow-data-v1:";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = (prefix = "id") => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

let authMode = "signin";
let currentUser = null;
let state = null;
let activeView = "today";
let taskFilter = "all";
let selectedNoteId = null;
let toastTimer = null;
let focusTimer = null;
let focusSeconds = 25 * 60;
let focusDuration = 25 * 60;
let focusRunning = false;

const defaultData = () => ({
  tasks: [
    { id: uid("task"), title: "Plan my day", due: "today", projectId: "", done: false, createdAt: Date.now() },
    { id: uid("task"), title: "Take a proper break", due: "today", projectId: "", done: false, createdAt: Date.now() },
  ],
  projects: [],
  notes: [{ id: uid("note"), title: "Welcome to Flow", body: "This note is stored locally on this device.\n\nTry adding a task, starting a focus session, or creating a project.", updatedAt: Date.now() }],
  focusSessions: [],
});

function normalizeUsername(value) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function getUsers() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || "{}"); } catch { return {}; }
}
function setUsers(users) { localStorage.setItem(USER_KEY, JSON.stringify(users)); }
function getUserData(username) {
  try { return JSON.parse(localStorage.getItem(DATA_PREFIX + username) || "null"); } catch { return null; }
}
function setUserData(username, data) { localStorage.setItem(DATA_PREFIX + username, JSON.stringify(data)); }

function makeSalt() {
  if (window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  return uid("salt");
}

function textHash(input) {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 16777619);
    h2 ^= c + i; h2 = Math.imul(h2, 2246822519);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

async function hashPassword(password, salt) {
  const input = `${salt}:${password}`;
  if (window.crypto?.subtle) {
    const data = new TextEncoder().encode(input);
    const buffer = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  return textHash(input);
}

function setAuthError(message = "") { $("#authError").textContent = message; }
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function setTheme(mode) {
  localStorage.setItem(THEME_KEY, mode);
  if (mode === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = mode;
  }
  $$("#themeChoices button").forEach(button => button.classList.toggle("active", button.dataset.theme === mode));
}

function getSavedTheme() {
  return localStorage.getItem(THEME_KEY) || "system";
}

function toggleAuthMode(nextMode) {
  authMode = nextMode;
  const signup = authMode === "signup";
  $("#authTitle").textContent = signup ? "Make it yours." : "Welcome back.";
  $("#authSubtitle").textContent = signup ? "Create a local Motive Flow account on this device." : "Sign in to your local Motive Flow account.";
  $("#authSubmit").innerHTML = signup ? "Create account <span>→</span>" : "Sign in <span>→</span>";
  $("#passwordInput").autocomplete = signup ? "new-password" : "current-password";
  $("#nameInput").hidden = !signup;
  $("#confirmPasswordWrap").hidden = !signup;
  $("#nameInput").required = signup;
  $("#confirmPasswordInput").required = signup;
  $("#signInTab").classList.toggle("active", !signup);
  $("#signUpTab").classList.toggle("active", signup);
  $("#signInTab").setAttribute("aria-selected", String(!signup));
  $("#signUpTab").setAttribute("aria-selected", String(signup));
  setAuthError("");
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  setAuthError("");
  const username = normalizeUsername($("#usernameInput").value);
  const password = $("#passwordInput").value;
  const users = getUsers();
  if (!/^[a-z0-9._-]{2,24}$/.test(username)) return setAuthError("Use 2–24 letters, numbers, dots, dashes, or underscores for your username.");
  if (password.length < 6) return setAuthError("Your password needs at least 6 characters.");

  if (authMode === "signup") {
    const name = $("#nameInput").value.trim();
    if (name.length < 2) return setAuthError("Add a display name.");
    if (users[username]) return setAuthError("That username is already used on this device.");
    if ($("#confirmPasswordInput").value !== password) return setAuthError("Those passwords do not match.");
    const salt = makeSalt();
    const passwordHash = await hashPassword(password, salt);
    users[username] = { name, salt, passwordHash, createdAt: Date.now() };
    setUsers(users);
    setUserData(username, defaultData());
    currentUser = { username, name };
    localStorage.setItem(SESSION_KEY, username);
    enterApp();
    showToast("Account created on this device.");
    return;
  }

  const user = users[username];
  if (!user) return setAuthError("No local account with that username was found.");
  const passwordHash = await hashPassword(password, user.salt);
  if (passwordHash !== user.passwordHash) return setAuthError("That password is not correct.");
  currentUser = { username, name: user.name };
  localStorage.setItem(SESSION_KEY, username);
  enterApp();
}

function enterApp() {
  state = getUserData(currentUser.username) || defaultData();
  saveState();
  $("#authView").hidden = true;
  $("#appView").hidden = false;
  updateProfileUI();
  setTheme(getSavedTheme());
  renderAll();
  switchView("today");
}

function exitApp() {
  stopFocusTimer();
  localStorage.removeItem(SESSION_KEY);
  currentUser = null;
  state = null;
  $("#appView").hidden = true;
  $("#authView").hidden = false;
  $("#authForm").reset();
  toggleAuthMode("signin");
}

function saveState() {
  if (!currentUser || !state) return;
  setUserData(currentUser.username, state);
}

function updateProfileUI() {
  const name = currentUser.name || "Flow User";
  const username = currentUser.username;
  const initial = name.trim().charAt(0).toUpperCase() || "F";
  $("#sidebarName").textContent = name;
  $("#sidebarUsername").textContent = `@${username}`;
  $("#avatar").textContent = initial;
  $("#mobileProfile").textContent = initial;
  $("#settingsName").textContent = name;
  $("#settingsUsername").textContent = `@${username}`;
}

function switchView(view) {
  activeView = view;
  $$(".app-page").forEach(page => page.classList.toggle("active", page.dataset.page === view));
  $$(".nav-item[data-view], .dock-item[data-view]").forEach(item => item.classList.toggle("active", item.dataset.view === view));
  $("#sidebar").classList.remove("mobile-open");
  if (view === "today") renderToday();
  if (view === "tasks") renderTasks();
  if (view === "projects") renderProjects();
  if (view === "focus") renderFocus();
  if (view === "notes") renderNotes();
  if (view === "settings") renderSettings();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderAll() {
  renderToday(); renderTasks(); renderProjects(); renderFocus(); renderNotes(); renderSettings();
  updateTaskBadge();
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));
}
function dayLabel(value) {
  if (value === "today") return "Today";
  if (value === "tomorrow") return "Tomorrow";
  return "Later";
}
function nowTimeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning.";
  if (hour < 18) return "Good afternoon.";
  return "Good evening.";
}

function updateTaskBadge() {
  const open = state.tasks.filter(t => !t.done).length;
  $("#taskCountBadge").textContent = open;
}

function taskMarkup(task) {
  const project = state.projects.find(p => p.id === task.projectId);
  return `<div class="task-row ${task.done ? "done" : ""}" data-task-id="${task.id}">
    <button class="task-check" data-action="toggle-task" aria-label="${task.done ? "Mark incomplete" : "Mark complete"}">${task.done ? "✓" : ""}</button>
    <div class="task-copy"><strong>${escapeHtml(task.title)}</strong><small>${dayLabel(task.due)}${project ? ` · ${escapeHtml(project.name)}` : ""}</small></div>
    <div class="task-actions"><button class="task-action" data-action="delete-task" aria-label="Delete task">×</button></div>
  </div>`;
}

function renderToday() {
  if (!state) return;
  $("#todayGreeting").textContent = nowTimeGreeting();
  $("#todayDate").textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date());
  const today = state.tasks.filter(t => t.due === "today");
  const open = today.filter(t => !t.done).length;
  $("#todayProgress").textContent = `${open} open`;
  $("#todayTasks").innerHTML = today.map(taskMarkup).join("");
  $("#todayEmpty").hidden = today.length > 0;
  updateTaskBadge();
}

function renderTasks() {
  if (!state) return;
  let tasks = [...state.tasks];
  if (taskFilter === "open") tasks = tasks.filter(t => !t.done);
  if (taskFilter === "done") tasks = tasks.filter(t => t.done);
  tasks.sort((a,b) => Number(a.done) - Number(b.done) || b.createdAt - a.createdAt);
  $("#allTasks").innerHTML = tasks.map(taskMarkup).join("");
  $("#tasksEmpty").hidden = tasks.length > 0;
  const open = state.tasks.filter(t => !t.done).length;
  $("#tasksSummary").textContent = `${open} open · ${state.tasks.length} total`;
  updateTaskBadge();
}

function renderProjects() {
  if (!state) return;
  if (!state.projects.length) {
    $("#projectGrid").innerHTML = `<div class="surface empty-state" style="grid-column: 1/-1"><div class="empty-icon">□</div><h3>Projects make room for bigger things.</h3><p>Create one when a task belongs to something larger.</p><button class="text-button" type="button" data-action="add-project">Create a project →</button></div>`;
    return;
  }
  $("#projectGrid").innerHTML = state.projects.map(project => {
    const count = state.tasks.filter(t => t.projectId === project.id).length;
    const done = state.tasks.filter(t => t.projectId === project.id && t.done).length;
    return `<article class="project-card project-${project.color}" data-project-id="${project.id}"><div class="project-meta"><span class="project-dot"></span><button class="project-delete" data-action="delete-project" aria-label="Delete project">Delete</button></div><h3>${escapeHtml(project.name)}</h3><p>${done} of ${count} tasks complete</p></article>`;
  }).join("");
}

function renderFocus() {
  updateFocusClockUI();
  const week = state.focusSessions.filter(s => Date.now() - s.finishedAt < 7 * 86400000);
  const minutes = week.reduce((sum, s) => sum + s.minutes, 0);
  $("#focusSessionsCount").textContent = `${week.length} session${week.length === 1 ? "" : "s"}`;
  $("#focusMinutesTotal").textContent = minutes;
  $("#focusCompletedTotal").textContent = week.length;
  $("#focusHistoryList").innerHTML = week.slice(-8).reverse().map(s => `<div class="history-row"><span>${s.minutes} minute focus</span><span>${formatDate(s.finishedAt)}</span></div>`).join("") || `<div class="empty-state" style="padding:35px 10px"><p>No focus sessions yet.</p></div>`;
  $("#todayFocusClock").textContent = formatSeconds(focusSeconds);
}

function renderNotes() {
  if (!state.notes.length) {
    selectedNoteId = null;
    $("#notesList").innerHTML = `<div class="surface empty-state"><div class="empty-icon">▤</div><h3>No notes yet.</h3><p>Capture an idea before it disappears.</p></div>`;
    $("#noteEditor").hidden = true;
    return;
  }
  if (!selectedNoteId || !state.notes.some(n => n.id === selectedNoteId)) selectedNoteId = state.notes[0].id;
  $("#notesList").innerHTML = state.notes.slice().sort((a,b) => b.updatedAt - a.updatedAt).map(note => `<button class="note-list-item ${note.id === selectedNoteId ? "active" : ""}" data-note-id="${note.id}"><strong>${escapeHtml(note.title || "Untitled note")}</strong><p>${escapeHtml((note.body || "").replace(/\s+/g, " ") || "No text yet.")}</p><time>${formatDate(note.updatedAt)}</time></button>`).join("");
  $("#noteEditor").hidden = false;
  renderSelectedNote();
}

function renderSelectedNote() {
  const note = state.notes.find(n => n.id === selectedNoteId);
  if (!note) return;
  $("#noteTitle").value = note.title || "";
  $("#noteBody").value = note.body || "";
  $("#noteSaveState").textContent = `Saved locally · ${formatDate(note.updatedAt)}`;
}

function renderSettings() { updateProfileUI(); }

function openTaskDialog() {
  const dialog = $("#taskDialog");
  $("#taskForm").reset();
  $("#taskProjectInput").innerHTML = `<option value="">No project</option>` + state.projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  dialog.showModal();
  setTimeout(() => $("#taskTitleInput").focus(), 50);
}

function openProjectDialog() {
  const dialog = $("#projectDialog");
  $("#projectForm").reset();
  dialog.showModal();
  setTimeout(() => $("#projectNameInput").focus(), 50);
}

function addTask() {
  const title = $("#taskTitleInput").value.trim();
  if (!title) return;
  state.tasks.unshift({ id: uid("task"), title, due: $("#taskDueInput").value, projectId: $("#taskProjectInput").value, done: false, createdAt: Date.now() });
  saveState(); renderAll();
  showToast("Task added.");
}

function addProject() {
  const name = $("#projectNameInput").value.trim();
  if (!name) return;
  state.projects.push({ id: uid("project"), name, color: $("#projectColorInput").value, createdAt: Date.now() });
  saveState(); renderAll(); showToast("Project created.");
}

function deleteProject(projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  if (!confirm(`Delete “${project.name}”? Tasks will remain, but become unassigned.`)) return;
  state.projects = state.projects.filter(p => p.id !== projectId);
  state.tasks.forEach(t => { if (t.projectId === projectId) t.projectId = ""; });
  saveState(); renderAll(); showToast("Project deleted.");
}

function toggleTask(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.done = !task.done;
  saveState(); renderAll();
  showToast(task.done ? "Nice. Task complete." : "Task reopened.");
}

function deleteTask(taskId) {
  state.tasks = state.tasks.filter(t => t.id !== taskId);
  saveState(); renderAll(); showToast("Task removed.");
}

function addNote() {
  const note = { id: uid("note"), title: "", body: "", updatedAt: Date.now() };
  state.notes.unshift(note); selectedNoteId = note.id; saveState(); renderNotes();
  setTimeout(() => $("#noteTitle").focus(), 50);
}

function saveSelectedNote() {
  const note = state.notes.find(n => n.id === selectedNoteId);
  if (!note) return;
  note.title = $("#noteTitle").value;
  note.body = $("#noteBody").value;
  note.updatedAt = Date.now();
  saveState();
  $("#noteSaveState").textContent = "Saved locally";
  renderNotesListOnly();
}

function renderNotesListOnly() {
  $("#notesList").innerHTML = state.notes.slice().sort((a,b) => b.updatedAt - a.updatedAt).map(note => `<button class="note-list-item ${note.id === selectedNoteId ? "active" : ""}" data-note-id="${note.id}"><strong>${escapeHtml(note.title || "Untitled note")}</strong><p>${escapeHtml((note.body || "").replace(/\s+/g, " ") || "No text yet.")}</p><time>${formatDate(note.updatedAt)}</time></button>`).join("");
}

function deleteSelectedNote() {
  const note = state.notes.find(n => n.id === selectedNoteId);
  if (!note) return;
  if (!confirm(`Delete “${note.title || "Untitled note"}”?`)) return;
  state.notes = state.notes.filter(n => n.id !== selectedNoteId);
  selectedNoteId = state.notes[0]?.id || null;
  saveState(); renderNotes(); showToast("Note deleted.");
}

function renameAccount() {
  const next = prompt("Display name", currentUser.name);
  if (next === null) return;
  const name = next.trim();
  if (name.length < 2) return showToast("Name is too short.");
  const users = getUsers();
  if (!users[currentUser.username]) return;
  users[currentUser.username].name = name;
  currentUser.name = name;
  setUsers(users);
  updateProfileUI();
  showToast("Display name updated.");
}

function exportBackup() {
  const payload = { app: "Motive Flow", version: 1, username: currentUser.username, exportedAt: new Date().toISOString(), data: state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `motive-flow-${currentUser.username}-backup.json`; anchor.click();
  URL.revokeObjectURL(url);
  showToast("Backup exported.");
}

async function importBackup(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (payload.app !== "Motive Flow" || !payload.data || !Array.isArray(payload.data.tasks) || !Array.isArray(payload.data.notes)) throw new Error("Invalid backup.");
    state = { ...defaultData(), ...payload.data };
    saveState(); renderAll(); showToast("Backup imported.");
  } catch {
    showToast("That backup file could not be imported.");
  }
}

function deleteAccount() {
  if (!confirm("Delete this local account and all its Flow data from this browser? This cannot be undone.")) return;
  const users = getUsers();
  delete users[currentUser.username];
  setUsers(users);
  localStorage.removeItem(DATA_PREFIX + currentUser.username);
  exitApp();
  showToast("Local account deleted.");
}

function formatSeconds(total) {
  const minutes = Math.floor(total / 60).toString().padStart(2, "0");
  const seconds = Math.floor(total % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function updateFocusClockUI() {
  const formatted = formatSeconds(focusSeconds);
  $("#focusClock").textContent = formatted;
  $("#todayFocusClock").textContent = formatted;
  $("#focusToggleButton").innerHTML = focusRunning ? "Pause focus" : "Start focus <span>→</span>";
  $("#todayFocusButton").innerHTML = focusRunning ? "Pause focus" : "Start focus <span>→</span>";
  $("#focusHint").textContent = focusRunning ? "Stay with it." : "Ready when you are.";
  const progress = focusDuration > 0 ? (focusDuration - focusSeconds) / focusDuration : 0;
  $("#focusModeLabel").textContent = focusRunning ? "FOCUSING" : "FOCUS";
  $("#focusClock").parentElement.parentElement.style.setProperty("--ring-progress", `${progress * 360}deg`);
}

function startFocusTimer() {
  if (focusRunning) { stopFocusTimer(); return; }
  focusRunning = true;
  updateFocusClockUI();
  focusTimer = setInterval(() => {
    focusSeconds -= 1;
    if (focusSeconds <= 0) {
      focusSeconds = 0;
      stopFocusTimer();
      state.focusSessions.push({ id: uid("session"), minutes: Math.round(focusDuration / 60), finishedAt: Date.now() });
      saveState(); renderFocus();
      showToast("Focus session complete. Nice work.");
      return;
    }
    updateFocusClockUI();
  }, 1000);
}

function stopFocusTimer() {
  clearInterval(focusTimer);
  focusTimer = null;
  focusRunning = false;
  updateFocusClockUI();
}

function resetFocusTimer() {
  stopFocusTimer();
  focusSeconds = focusDuration;
  updateFocusClockUI();
}

function setFocusDuration(minutes) {
  stopFocusTimer();
  focusDuration = minutes * 60;
  focusSeconds = focusDuration;
  $$(".timer-modes button").forEach(button => button.classList.toggle("active", Number(button.dataset.minutes) === minutes));
  updateFocusClockUI();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

/* Events */
$("#signInTab").addEventListener("click", () => toggleAuthMode("signin"));
$("#signUpTab").addEventListener("click", () => toggleAuthMode("signup"));
$("#authForm").addEventListener("submit", handleAuthSubmit);

$$(".nav-item[data-view], .dock-item[data-view]").forEach(button => button.addEventListener("click", () => switchView(button.dataset.view)));
$("#mobileProfile").addEventListener("click", () => switchView("settings"));
$("#sidebarCollapse").addEventListener("click", () => $("#sidebar").classList.remove("mobile-open"));
$("#logoutButton").addEventListener("click", exitApp);

["#todayAddButton", "#tasksAddButton", "#mobileQuickAdd"].forEach(selector => $(selector).addEventListener("click", openTaskDialog));
$("#taskForm").addEventListener("submit", event => { event.preventDefault(); addTask(); $("#taskDialog").close(); });
$("#projectAddButton").addEventListener("click", openProjectDialog);
$("#projectForm").addEventListener("submit", event => { event.preventDefault(); addProject(); $("#projectDialog").close(); });
$("#noteAddButton").addEventListener("click", addNote);
$("#deleteNoteButton").addEventListener("click", deleteSelectedNote);
$("#noteTitle").addEventListener("input", saveSelectedNote);
$("#noteBody").addEventListener("input", saveSelectedNote);
$("#renameButton").addEventListener("click", renameAccount);
$("#exportButton").addEventListener("click", exportBackup);
$("#importInput").addEventListener("change", event => importBackup(event.target.files[0]));
$("#deleteAccountButton").addEventListener("click", deleteAccount);
$("#focusToggleButton").addEventListener("click", startFocusTimer);
$("#todayFocusButton").addEventListener("click", () => { switchView("focus"); startFocusTimer(); });
$("#focusResetButton").addEventListener("click", resetFocusTimer);

$("#taskFilters").addEventListener("click", event => {
  const button = event.target.closest("button[data-filter]");
  if (!button) return;
  taskFilter = button.dataset.filter;
  $$("#taskFilters button").forEach(item => item.classList.toggle("active", item === button));
  renderTasks();
});

$(".timer-modes").addEventListener("click", event => {
  const button = event.target.closest("button[data-minutes]");
  if (button) setFocusDuration(Number(button.dataset.minutes));
});

$("#themeChoices").addEventListener("click", event => {
  const button = event.target.closest("button[data-theme]");
  if (button) setTheme(button.dataset.theme);
});

document.addEventListener("click", event => {
  const action = event.target.closest("[data-action]");
  if (action) handleActionClick(event);
  const noteButton = event.target.closest("[data-note-id]");
  if (noteButton && state?.notes) { selectedNoteId = noteButton.dataset.noteId; renderNotes(); }
});

function handleActionClick(event) {
  const actionElement = event.target.closest("[data-action]");
  if (!actionElement) return;
  const action = actionElement.dataset.action;
  if (action === "toggle-task") toggleTask(actionElement.closest("[data-task-id]").dataset.taskId);
  if (action === "delete-task") deleteTask(actionElement.closest("[data-task-id]").dataset.taskId);
  if (action === "delete-project") deleteProject(actionElement.closest("[data-project-id]").dataset.projectId);
  if (action === "add-task") openTaskDialog();
  if (action === "add-project") openProjectDialog();
}

window.addEventListener("beforeunload", saveState);

/* Startup */
setTheme(getSavedTheme());
const sessionUser = localStorage.getItem(SESSION_KEY);
if (sessionUser && getUsers()[sessionUser]) {
  const user = getUsers()[sessionUser];
  currentUser = { username: sessionUser, name: user.name };
  enterApp();
} else {
  $("#authView").hidden = false;
  $("#appView").hidden = true;
  toggleAuthMode("signin");
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
