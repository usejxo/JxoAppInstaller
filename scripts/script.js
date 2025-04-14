// --- CONFIG & STATE ---
const APPS_JSON_URL = 'https://usejxo.github.io/JxoAppInstaller/apps/apps.json';
const params       = new URLSearchParams(location.search);
const devMode      = params.get('pwa') === 'false';
let deferredPrompt = null;
let appInstallerDirHandle = null;
let installedApps  = [];

// --- UTILITIES ---
function showError(msg) {
  const e = document.getElementById('error-container');
  e.textContent = msg; e.style.display = 'block';
}
function clearError() {
  const e = document.getElementById('error-container');
  e.textContent = ''; e.style.display = 'none';
}
async function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('jxo-installer-db', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('handles');
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}
async function saveDirectoryHandle(handle) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('handles','readwrite');
    const store = tx.objectStore('handles');
    const r = store.put(handle, 'appInstaller');
    r.onsuccess = () => res();
    r.onerror   = () => rej(r.error);
  });
}
async function getSavedDirectoryHandle() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('handles','readonly');
    const store = tx.objectStore('handles');
    const r = store.get('appInstaller');
    r.onsuccess = () => res(r.result || null);
    r.onerror   = () => rej(r.error);
  });
}

// --- PWA INSTALL FLOW ---
window.addEventListener('beforeinstallprompt', e => {
  if (devMode) return;
  e.preventDefault();
  deferredPrompt = e;
  // show our banner
  document.getElementById('pwa-prompt').style.display = 'block';
});
document.getElementById('pwa-install-btn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  if (choice.outcome === 'accepted') {
    document.getElementById('pwa-prompt').style.display = 'none';
    init(); // now proceed
  } else {
    showError('PWA install is required to continue.');
  }
});
window.addEventListener('appinstalled', () => {
  document.getElementById('pwa-prompt').style.display = 'none';
  init();
});

// --- APP LOGIC ---
async function init() {
  clearError();
  installedApps = JSON.parse(localStorage.getItem('installedApps') || '[]');
  appInstallerDirHandle = await getSavedDirectoryHandle();

  if (appInstallerDirHandle) {
    document.getElementById('directory-picker-container').style.display = 'none';
    document.getElementById('app-list-container').style.display = 'block';
    await renderAppList();
  } else {
    document.getElementById('pick-directory-btn')
      .addEventListener('click', pickDirectory);
  }
}

async function pickDirectory() {
  clearError();
  try {
    const root = await window.showDirectoryPicker();
    const perm = await root.requestPermission({mode:'readwrite'});
    if (perm !== 'granted') throw new Error('Write permission denied');
    appInstallerDirHandle = await root.getDirectoryHandle('AppInstaller', {create:true});
    await saveDirectoryHandle(appInstallerDirHandle);
    document.getElementById('directory-picker-container').style.display = 'none';
    document.getElementById('app-list-container').style.display = 'block';
    await renderAppList();
  } catch (e) {
    showError(e.message);
  }
}

async function renderAppList() {
  clearError();
  const ul = document.getElementById('app-list');
  ul.innerHTML = '';
  let apps;
  try {
    const res = await fetch(APPS_JSON_URL);
    if (!res.ok) throw new Error(`Failed to fetch apps.json (${res.status})`);
    apps = await res.json();
  } catch (e) {
    return showError(e.message);
  }

  for (const app of apps) {
    const installed = installedApps.find(a=>a.id===app.id);
    const li = document.createElement('li');
    li.innerHTML = `
      <img src="${app.icon}" alt="${app.name}">
      <div class="app-name">${app.name}</div>
      <div class="buttons">
        ${installed
          ? `<button data-action="open" data-id="${app.id}" class="btn">Open</button>
             <button data-action="uninstall" data-id="${app.id}" class="btn">Uninstall</button>`
          : `<button data-action="install" data-id="${app.id}" class="btn">Install</button>`
        }
      </div>`;
    ul.appendChild(li);
  }

  ul.onclick = async e => {
    if (e.target.tagName !== 'BUTTON') return;
    clearError();
    const { action, id } = e.target.dataset;
    const app = apps.find(a=>a.id===id);
    try {
      if (action==='install')   await installApp(app);
      if (action==='open')      await openApp(app);
      if (action==='uninstall') await uninstallApp(app);
      await renderAppList();
    } catch (err) {
      showError(err.message);
    }
  };
}

async function installApp(app) {
  // download
  const r = await fetch(app.zip_url);
  if (!r.ok) throw new Error(`Download failed (${r.status})`);
  const blob = await r.blob();
  const zip  = await JSZip.loadAsync(blob);

  // find root
  let rootPath = '';
  zip.forEach((path,file) => {
    if (!file.dir && path.endsWith('index.html')) {
      rootPath = path.slice(0, path.lastIndexOf('/'));
    }
  });
  if (!rootPath) throw new Error('No index.html found in ZIP');

  // extract
  await extractZipToDir(zip, rootPath, appInstallerDirHandle);

  // save state
  installedApps.push({ id: app.id, rootPath });
  localStorage.setItem('installedApps', JSON.stringify(installedApps));
}

async function extractZipToDir(zip, rootPath, dirHandle) {
  const entries = [];
  zip.forEach((path,file) => {
    if (path.startsWith(rootPath + '/')) entries.push({path,file});
  });
  for (const {path,file} of entries) {
    const rel = path.slice(rootPath.length+1);
    const parts = rel.split('/');
    const name = parts.pop();
    let cur = dirHandle;
    for (const p of parts) {
      cur = await cur.getDirectoryHandle(p,{create:true});
    }
    const fh = await cur.getFileHandle(name,{create:true});
    const w  = await fh.createWritable();
    await w.write(await file.async('uint8array'));
    await w.close();
  }
}

async function openApp(app) {
  const dir = await appInstallerDirHandle.getDirectoryHandle(app.rootPath);
  const fh  = await dir.getFileHandle('index.html');
  const file = await fh.getFile();
  const url  = URL.createObjectURL(file);
  const iframe = document.getElementById('app-iframe');
  iframe.src = url;
  iframe.style.display = 'block';
}

async function uninstallApp(app) {
  await appInstallerDirHandle.removeEntry(app.rootPath, {recursive:true});
  installedApps = installedApps.filter(a=>a.id!==app.id);
  localStorage.setItem('installedApps', JSON.stringify(installedApps));
}

// kick off
if (devMode) {
  // skip PWA prompt
  init();
} else {
  // wait for PWA install
  // if already standalone, go straight in:
  if (window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true) {
    init();
  }
  // else wait for beforeinstallprompt/appinstalled
}
