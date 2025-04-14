const APPS_JSON_URL = 'https://usejxo.github.io/JxoAppInstaller/apps/apps.json';
let appInstallerDirHandle;
let installedApps = [];

document.addEventListener('DOMContentLoaded', async () => {
  installedApps = JSON.parse(localStorage.getItem('installedApps') || '[]');
  appInstallerDirHandle = await getSavedDirectoryHandle();

  if (appInstallerDirHandle) {
    document.getElementById('directory-picker-container').style.display = 'none';
    document.getElementById('app-list-container').style.display = 'block';
    await renderAppList();
  } else {
    document.getElementById('pick-directory-btn').addEventListener('click', async () => {
      const dirHandle = await window.showDirectoryPicker();
      const permission = await dirHandle.requestPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        appInstallerDirHandle = await dirHandle.getDirectoryHandle('AppInstaller', { create: true });
        await saveDirectoryHandle(appInstallerDirHandle);
        document.getElementById('directory-picker-container').style.display = 'none';
        document.getElementById('app-list-container').style.display = 'block';
        await renderAppList();
      } else {
        alert('Permission denied');
      }
    });
  }
});

async function renderAppList() {
  const res = await fetch(APPS_JSON_URL);
  const apps = await res.json();
  const listEl = document.getElementById('app-list');
  listEl.innerHTML = '';

  for (const app of apps) {
    const isInstalled = installedApps.find(a => a.id === app.id);
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

  listEl.addEventListener('click', async e => {
    if (e.target.tagName === 'BUTTON') {
      const action = e.target.dataset.action;
      const appId = e.target.dataset.id;
      const apps = await (await fetch(APPS_JSON_URL)).json();
      const app = apps.find(a => a.id === appId);
      if (action === 'install') await installApp(app);
      if (action === 'open') await openApp(app);
      if (action === 'uninstall') await uninstallApp(app);
      await renderAppList();
    }
  });
}

async function installApp(app) {
  try {
    const zipRes = await fetch(app.zip_url);
    const blob = await zipRes.blob();
    const zip = await JSZip.loadAsync(blob);

    // find root folder containing index.html
    let rootPath = '';
    zip.forEach((relativePath, file) => {
      if (!file.dir && relativePath.endsWith('index.html')) {
        rootPath = relativePath.substring(0, relativePath.lastIndexOf('/'));
      }
    });
    if (!rootPath) throw new Error('No index.html found in zip');

    // extract files under rootPath
    await extractZipToDir(zip, rootPath, appInstallerDirHandle);

    installedApps.push({ id: app.id, rootPath });
    localStorage.setItem('installedApps', JSON.stringify(installedApps));
    alert(`${app.name} installed`);
  } catch (err) {
    console.error(err);
    alert('Install failed: ' + err.message);
  }
}

async function extractZipToDir(zip, rootPath, dirHandle) {
  const entries = [];
  zip.forEach((relativePath, file) => {
    if (relativePath.startsWith(rootPath + '/')) {
      entries.push({ path: relativePath, file });
    }
  });

  for (const { path, file } of entries) {
    const relative = path.substring(rootPath.length + 1);
    const parts = relative.split('/');
    const fileName = parts.pop();
    let currentDir = dirHandle;
    for (const part of parts) {
      currentDir = await currentDir.getDirectoryHandle(part, { create: true });
    }
    const writableHandle = await currentDir.getFileHandle(fileName, { create: true });
    const writable = await writableHandle.createWritable();
    const content = await file.async('uint8array');
    await writable.write(content);
    await writable.close();
  }
}

async function openApp(app) {
  const dir = await appInstallerDirHandle.getDirectoryHandle(app.rootPath);
  const fileHandle = await dir.getFileHandle('index.html');
  const file = await fileHandle.getFile();
  const url = URL.createObjectURL(file);
  const iframe = document.getElementById('app-iframe');
  iframe.src = url;
  iframe.style.display = 'block';
}

async function uninstallApp(app) {
  await appInstallerDirHandle.removeEntry(app.rootPath, { recursive: true });
  installedApps = installedApps.filter(a => a.id !== app.id);
  localStorage.setItem('installedApps', JSON.stringify(installedApps));
  alert(`${app.name} uninstalled`);
}

// Persist directory handle in IndexedDB
async function saveDirectoryHandle(handle) {
  const db = await openDB();
  const tx = db.transaction('handles', 'readwrite');
  tx.objectStore('handles').put(handle, 'appInstaller');
  await tx.complete;
}

async function getSavedDirectoryHandle() {
  const db = await openDB();
  const tx = db.transaction('handles', 'readonly');
  return tx.objectStore('handles').get('appInstaller');
}

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('jxo-installer-db', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('handles');
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
