const APPS_JSON_URL = 'https://usejxo.github.io/JxoAppInstaller/apps/apps.json';
let appInstallerDirHandle = null;
let installedApps = [];

// Utility: show an error in the UI
function showError(msg) {
  const errEl = document.getElementById('error-container');
  errEl.textContent = msg;
}

// Clear previous errors
function clearError() {
  document.getElementById('error-container').textContent = '';
}

// IndexedDB helpers
async function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('jxo-installer-db', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('handles');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDirectoryHandle(handle) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    const store = tx.objectStore('handles');
    const r = store.put(handle, 'appInstaller');
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

async function getSavedDirectoryHandle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readonly');
    const store = tx.objectStore('handles');
    const r = store.get('appInstaller');
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

// Feature‑detect FS Access API
if (!window.showDirectoryPicker) {
  showError('⚠️ Your browser does not support the File System Access API. Please use Chrome/Edge 86+.');
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    installedApps = JSON.parse(localStorage.getItem('installedApps') || '[]');
    appInstallerDirHandle = await getSavedDirectoryHandle();

    if (appInstallerDirHandle) {
      document.getElementById('directory-picker-container').style.display = 'none';
      document.getElementById('app-list-container').style.display = 'block';
      await renderAppList();
    } else {
      document.getElementById('pick-directory-btn').addEventListener('click', async () => {
        clearError();
        try {
          const rootHandle = await window.showDirectoryPicker();
          const perm = await rootHandle.requestPermission({ mode: 'readwrite' });
          if (perm !== 'granted') throw new Error('Write permission was denied');
          // create (or open) our installer folder
          appInstallerDirHandle = await rootHandle.getDirectoryHandle('AppInstaller', { create: true });
          await saveDirectoryHandle(appInstallerDirHandle);
          document.getElementById('directory-picker-container').style.display = 'none';
          document.getElementById('app-list-container').style.display = 'block';
          await renderAppList();
        } catch (e) {
          showError('❌ ' + e.message);
        }
      });
    }
  } catch (e) {
    showError('Initialization error: ' + e.message);
  }
});

async function renderAppList() {
  clearError();
  try {
    const res = await fetch(APPS_JSON_URL);
    if (!res.ok) throw new Error(`Could not fetch apps.json (${res.status})`);
    const apps = await res.json();
    const listEl = document.getElementById('app-list');
    listEl.innerHTML = '';

    for (const app of apps) {
      const isInstalled = installedApps.some(a => a.id === app.id);
      const li = document.createElement('li');
      li.innerHTML = `
        <img src="${app.icon}" alt="${app.name}" width="32" height="32">
        <strong>${app.name}</strong>
        ${isInstalled
          ? `<button data-action="open" data-id="${app.id}">Open</button>
             <button data-action="uninstall" data-id="${app.id}">Uninstall</button>`
          : `<button data-action="install" data-id="${app.id}">Install</button>`
        }
      `;
      listEl.appendChild(li);
    }

    listEl.onclick = async e => {
      if (e.target.tagName !== 'BUTTON') return;
      clearError();
      const action = e.target.dataset.action;
      const appId = e.target.dataset.id;
      const apps = await (await fetch(APPS_JSON_URL)).json();
      const app = apps.find(a => a.id === appId);
      try {
        if (action === 'install')   await installApp(app);
        if (action === 'open')      await openApp(app);
        if (action === 'uninstall') await uninstallApp(app);
        await renderAppList();
      } catch (err) {
        showError('❌ ' + err.message);
      }
    };
  } catch (e) {
    showError('Failed to load app list: ' + e.message);
  }
}

async function installApp(app) {
  // download & unzip
  const zipRes = await fetch(app.zip_url);
  if (!zipRes.ok) throw new Error(`Download failed (${zipRes.status})`);
  const blob = await zipRes.blob();
  const zip = await JSZip.loadAsync(blob);

  // find index.html root
  let rootPath = '';
  zip.forEach((path, file) => {
    if (!file.dir && path.endsWith('index.html')) {
      rootPath = path.slice(0, path.lastIndexOf('/'));
    }
  });
  if (!rootPath) throw new Error('No index.html in ZIP');

  // extract
  await extractZipToDir(zip, rootPath, appInstallerDirHandle);

  installedApps.push({ id: app.id, rootPath });
  localStorage.setItem('installedApps', JSON.stringify(installedApps));
}

async function extractZipToDir(zip, rootPath, dirHandle) {
  const entries = [];
  zip.forEach((path, file) => {
    if (path.startsWith(rootPath + '/')) entries.push({ path, file });
  });

  for (const { path, file } of entries) {
    const rel = path.slice(rootPath.length + 1);
    const parts = rel.split('/');
    const fileName = parts.pop();
    let currentDir = dirHandle;
    for (const part of parts) {
      currentDir = await currentDir.getDirectoryHandle(part, { create: true });
    }
    // <-- now guaranteed DirectoryHandle -->
    const fh = await currentDir.getFileHandle(fileName, { create: true });
    const writable = await fh.createWritable();
    await writable.write(await file.async('uint8array'));
    await writable.close();
  }
}

async function openApp(app) {
  const dir = await appInstallerDirHandle.getDirectoryHandle(app.rootPath);
  const fh = await dir.getFileHandle('index.html');
  const blob = await (await fh.getFile()).arrayBuffer();
  const url = URL.createObjectURL(new Blob([blob], { type: 'text/html' }));
  const iframe = document.getElementById('app-iframe');
  iframe.src = url;
  iframe.style.display = 'block';
}

async function uninstallApp(app) {
  await appInstallerDirHandle.removeEntry(app.rootPath, { recursive: true });
  installedApps = installedApps.filter(a => a.id !== app.id);
  localStorage.setItem('installedApps', JSON.stringify(installedApps));
}
