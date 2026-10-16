/**
 * app.js – H5P-Export im Browser.
 * Gleicher Ablauf wie tools/h5p2html.js, aber vollständig im Browser:
 * die .h5p-Datei verlässt den Rechner nicht. Ergebnis ist eine ZIP-Datei mit
 * demselben HTML5-Paket (index.html, h5p/, player/, start.bat, start.command).
 *
 * Bibliotheksquellen (in dieser Reihenfolge):
 *   1. die hochgeladene Datei selbst
 *   2. die mitgelieferten Bibliotheken (libs/<Ordner>.zip, Verzeichnis libs/index.json)
 *   3. optional der H5P-Hub (api.h5p.org) – liefert nur die AKTUELLE Version
 */
(function () {
  'use strict';
  const H = window.H5PHtml;
  const HUB = 'https://api.h5p.org/v1/content-types/';
  const VERSION = window.H5P_EXPORT_VERSION || 'lokal';
  const v = (url) => url + '?v=' + encodeURIComponent(VERSION); // Cache-Busting, siehe build.js

  const $ = (id) => document.getElementById(id);
  const folderName = (d) => d.machineName + '-' + d.majorVersion + '.' + d.minorVersion;
  const machineNameOf = (folder) => folder.replace(/-\d+\.\d+$/, '');
  const baseNameOf = (file) => file.name.replace(/\.[^.]+$/, '') || 'h5p';

  // ---------------------------------------------------------------- Ausgabe

  function logTo(el) {
    return function (msg, kind) {
      const line = document.createElement('div');
      line.className = 'log-line' + (kind ? ' log-' + kind : '');
      line.textContent = msg;
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    };
  }

  function offerDownload(container, blob, filename) {
    const url = URL.createObjectURL(blob);
    container.innerHTML = '';
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.className = 'button button-primary';
    a.textContent = 'Herunterladen: ' + filename + ' (' + formatSize(blob.size) + ')';
    container.appendChild(a);
    a.click();
  }

  function formatSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  // ---------------------------------------------------------------- Bibliotheksquellen

  /** Mitgelieferte Bibliotheken der Seite. */
  const bundled = {
    index: null,
    readers: new Map(),
    async load() {
      if (!this.index) {
        const res = await fetch(v('libs/index.json'));
        if (!res.ok) throw new Error('Bibliotheksverzeichnis nicht ladbar (HTTP ' + res.status + ').');
        this.index = await res.json();
      }
      return this.index;
    },
    has(folder) { return !!(this.index && this.index[folder]); },
    libJson(folder) { return this.index[folder]; },
    async reader(folder) {
      if (!this.readers.has(folder)) {
        this.readers.set(folder, (async () => {
          const res = await fetch(v('libs/' + encodeURIComponent(folder) + '.zip'));
          if (!res.ok) throw new Error('Bibliothek ' + folder + ' nicht ladbar (HTTP ' + res.status + ').');
          return ZipReader.open(await res.arrayBuffer());
        })());
      }
      return this.readers.get(folder);
    }
  };

  /** H5P-Hub: ein Paket je Inhaltstyp (machineName), im Speicher zwischengespeichert. */
  const hub = {
    packages: new Map(), // machineName -> Promise<ZipReader|null>
    get(machineName, log) {
      if (!this.packages.has(machineName)) {
        this.packages.set(machineName, (async () => {
          try {
            log('  Hub: lade Inhaltstyp ' + machineName + ' …');
            const res = await fetch(HUB + encodeURIComponent(machineName));
            if (!res.ok) { log('    nicht verfügbar (HTTP ' + res.status + ')'); return null; }
            const z = await ZipReader.open(await res.arrayBuffer());
            log('    enthält: ' + foldersIn(z).join(', '));
            return z;
          } catch (e) {
            // Der Hub sendet bei 404 keine CORS-Freigabe – der Browser meldet dann nur "Failed to fetch".
            log('    kein eigenständiger Inhaltstyp im Hub (oder keine Verbindung)');
            return null;
          }
        })());
      }
      return this.packages.get(machineName);
    },
    async all() {
      const out = [];
      for (const p of this.packages.values()) { const z = await p; if (z) out.push(z); }
      return out;
    }
  };

  function foldersIn(zip) {
    const out = [];
    for (const n of zip.names()) {
      const m = n.match(/^([^/]+)\/library\.json$/);
      if (m && m[1] !== 'content') out.push(m[1]);
    }
    return out.sort();
  }

  /** Bibliotheken, die nur in content.json referenziert sind (Sub-Inhaltstypen). */
  function contentLibraries(raw) {
    const out = [];
    for (const m of raw.matchAll(/"library"\s*:\s*"([^"]+)"/g)) {
      const [machineName, version] = m[1].trim().split(/\s+/);
      if (!machineName || !version) continue;
      const [majorVersion, minorVersion] = version.split('.');
      out.push({ machineName, majorVersion, minorVersion });
    }
    return out;
  }

  /**
   * Ermittelt die komplette Bibliothekskette.
   * Liefert { items: [{ folder, libJson, deps, source }], missing, skipped, hubOffers }.
   * source: { kind: 'file'|'bundle'|'hub', zip? }
   *
   * Verbindlich sind nur h5p.json und die library.json-Abhängigkeiten. Treffer, die
   * NUR in content.json stehen, sind optional – dort stehen auch Kennungen, die keine
   * Bibliotheken sind (z. B. "H5P.DragQuestionDropzone 0.1" bei Drag and Drop).
   */
  async function resolveDependencies(upload, h5pJson, contentRaw, useHub, log) {
    const seen = new Set();
    const items = [];
    const missing = [];
    const skipped = [];
    const hubOffers = new Map();

    // parents: Inhaltstypen, über die diese Bibliothek gebraucht wird. Deren Hub-Pakete
    // enthalten die Abhängigkeit – so wird nur gezielt nachgeladen.
    async function findInHub(folder, parents) {
      for (const z of await hub.all()) if (z.has(folder + '/library.json')) return z;
      const names = [...new Set([machineNameOf(folder), ...parents.slice().reverse(), h5pJson.mainLibrary])];
      for (const name of names) {
        const z = await hub.get(name, log);
        if (!z) continue;
        for (const f of foldersIn(z)) {
          const m = machineNameOf(f);
          if (!hubOffers.has(m)) hubOffers.set(m, new Set());
          hubOffers.get(m).add(f);
        }
        if (z.has(folder + '/library.json')) return z;
      }
      return null;
    }

    async function load(dep, optional, parents) {
      const folder = folderName(dep);
      if (seen.has(folder)) return;
      seen.add(folder);
      const notFound = () => (optional ? skipped : missing).push(folder);
      let libJson, source;
      if (upload.has(folder + '/library.json')) {
        libJson = await upload.json(folder + '/library.json');
        source = { kind: 'file', zip: upload };
      } else if (bundled.has(folder)) {
        libJson = bundled.libJson(folder);
        source = { kind: 'bundle' };
        log('  + aus mitgelieferten Bibliotheken: ' + folder);
      } else if (useHub) {
        const z = await findInHub(folder, parents);
        if (!z) { notFound(); return; }
        libJson = await z.json(folder + '/library.json');
        source = { kind: 'hub', zip: z };
        log('  + vom H5P-Hub: ' + folder, 'ok');
      } else {
        notFound();
        return;
      }
      const deps = [];
      for (const key of ['preloadedDependencies', 'dynamicDependencies']) {
        for (const d of libJson[key] || []) deps.push(d);
      }
      items.push({ folder, libJson, deps: deps.map(folderName), source });
      for (const d of deps) await load(d, optional, [...parents, dep.machineName]);
    }

    // Erst alle verbindlichen Abhängigkeiten, danach die optionalen Treffer aus content.json.
    for (const d of h5pJson.preloadedDependencies || []) await load(d, false, []);
    for (const d of contentLibraries(contentRaw)) await load(d, true, []);
    return { items, missing, skipped, hubOffers };
  }

  /** Topologische Sortierung: Abhängigkeiten zuerst. */
  function topoSort(items) {
    const byFolder = new Map(items.map((i) => [i.folder, i]));
    const visited = new Set();
    const order = [];
    function visit(folder) {
      if (visited.has(folder) || !byFolder.has(folder)) return;
      visited.add(folder);
      for (const dep of byFolder.get(folder).deps) visit(dep);
      order.push(folder);
    }
    for (const item of items) visit(item.folder);
    return order;
  }

  /** Liefert die ZIP-Quelle einer Bibliothek (Datei, Bundle oder Hub). */
  async function zipOf(item) {
    return item.source.kind === 'bundle' ? bundled.reader(item.folder) : item.source.zip;
  }

  // ---------------------------------------------------------------- Umwandeln

  async function convert(file, useHub, log, setProgress) {
    const base = baseNameOf(file);
    const root = base + '-html5/';

    log('H5P-Export Web, Version ' + VERSION);
    log('1/4  Lese ' + file.name + ' (' + formatSize(file.size) + ') …');
    const upload = await ZipReader.open(await file.arrayBuffer());
    for (const n of upload.names()) {
      if (H.safeEntryName(n) !== n) throw new Error('Unsicherer Pfad im Archiv: ' + n);
    }
    if (!upload.has('h5p.json')) throw new Error('Die Datei enthält kein h5p.json – keine gültige H5P-Datei.');
    if (!upload.has('content/content.json')) throw new Error('content/content.json fehlt.');
    const h5pJson = await upload.json('h5p.json');
    const contentRaw = await upload.text('content/content.json');
    const title = h5pJson.title || base;
    log('  Titel: ' + title);

    log('2/4  Analysiere Bibliotheken …');
    await bundled.load();
    const mainDep = (h5pJson.preloadedDependencies || []).find((d) => d.machineName === h5pJson.mainLibrary);
    if (!mainDep) throw new Error('Hauptbibliothek "' + h5pJson.mainLibrary + '" nicht gefunden.');
    log('  Inhaltstyp: ' + mainDep.machineName + ' ' + mainDep.majorVersion + '.' + mainDep.minorVersion);

    const { items, missing, skipped, hubOffers } = await resolveDependencies(upload, h5pJson, contentRaw, useHub, log);
    if (skipped.length) {
      log('  Hinweis: in content.json genannt, aber nicht als Bibliothek vorhanden (übersprungen): ' + skipped.join(', '));
    }
    if (missing.length) {
      const lines = ['Es fehlen ' + missing.length + ' Bibliothek(en):'];
      for (const f of missing) {
        const offer = hubOffers.get(machineNameOf(f));
        lines.push('  ' + f + (offer ? '  (Hub bietet nur: ' + [...offer].join(', ') + ' – H5P braucht die exakte Version)' : ''));
      }
      if (!useHub) lines.push('', 'Tipp: Option „Fehlende Bibliotheken vom H5P-Hub nachladen" einschalten.');
      else lines.push('', 'Lösung: Die Datei auf der Ursprungsplattform als vollständiges Paket (mit Bibliotheken) exportieren.');
      throw new Error(lines.join('\n'));
    }
    const ordered = topoSort(items);
    const counts = { file: 0, bundle: 0, hub: 0 };
    items.forEach((i) => counts[i.source.kind]++);
    log('  ' + items.length + ' Bibliotheken (' + counts.file + ' aus der Datei, ' + counts.bundle +
      ' mitgeliefert, ' + counts.hub + ' vom Hub)');

    const styles = [];
    const scripts = [];
    for (const folder of ordered) {
      const item = items.find((i) => i.folder === folder);
      const z = await zipOf(item);
      for (const [list, key] of [[styles, 'preloadedCss'], [scripts, 'preloadedJs']]) {
        for (const f of item.libJson[key] || []) {
          if (!z.has(folder + '/' + f.path)) throw new Error('Datei fehlt in Bibliothek: ' + folder + '/' + f.path);
          list.push('h5p/' + folder + '/' + f.path);
        }
      }
    }
    log('  ' + styles.length + ' CSS- und ' + scripts.length + ' JS-Dateien geprüft');

    log('3/4  Packe Inhalt, Bibliotheken und Player …');
    const out = new ZipWriter();
    const uploadNames = upload.names();
    const extra = [];
    for (const item of items) {
      if (item.source.kind === 'file') continue;
      const z = await zipOf(item);
      for (const n of z.names()) {
        if (!n.startsWith(item.folder + '/')) continue;
        if (H.safeEntryName(n) !== n) throw new Error('Unsicherer Pfad in Bibliothek: ' + n);
        extra.push([z, n]);
      }
    }
    const playerRes = await fetch(v('player.zip'));
    if (!playerRes.ok) throw new Error('H5P-Player nicht ladbar (HTTP ' + playerRes.status + ').');
    const player = await ZipReader.open(await playerRes.arrayBuffer());
    const total = uploadNames.length + extra.length + H.PLAYER_FILES.length;
    let done = 0;
    const tick = () => { done++; if (done % 25 === 0 || done === total) setProgress(done / total); };

    for (const n of uploadNames) { await out.add(root + 'h5p/' + n, await upload.bytes(n)); tick(); }
    for (const [z, n] of extra) { await out.add(root + 'h5p/' + n, await z.bytes(n)); tick(); }
    for (const f of H.PLAYER_FILES) {
      if (!player.has(f)) throw new Error('Im Player fehlt: ' + f);
      await out.add(root + 'player/' + f, await player.bytes(f));
      tick();
    }

    log('4/4  Erzeuge index.html …');
    const l10n = H.l10nFor(h5pJson.language);
    const metadata = H.buildMetadata(h5pJson, title);
    const mainLibrary = mainDep.machineName + ' ' + mainDep.majorVersion + '.' + mainDep.minorVersion;
    await out.add(root + 'index.html', H.buildIndexHtml({ title, mainLibrary, contentJson: contentRaw, styles, scripts, l10n, metadata }));
    await out.add(root + 'start.bat', H.startBat());
    await out.add(root + 'start.command', H.startCommand());
    await out.add(root + 'README.txt', H.packageReadme(title, 'H5P-Export (Web)'));
    if (H.hasRightsInfo(metadata)) log('  Lizenzangaben übernommen: ' + metadata.license);

    log('Fertig! ' + ordered.length + ' Bibliotheken, ' + scripts.length + ' JS-, ' + styles.length + ' CSS-Dateien.', 'ok');
    return { blob: out.finish(), filename: base + '-html5.zip' };
  }

  // ---------------------------------------------------------------- Core-API senken (Lumi)

  async function patchCoreApi(file, targetMinor, log) {
    const z = await ZipReader.open(await file.arrayBuffer());
    const out = new ZipWriter();
    const patched = [];
    for (const name of z.names()) {
      if (H.safeEntryName(name) !== name) throw new Error('Unsicherer Pfad im Archiv: ' + name);
      let data = await z.bytes(name);
      const m = name.match(/^([^/]+)\/library\.json$/);
      if (m) {
        try {
          const lj = JSON.parse(new TextDecoder().decode(data));
          const c = lj.coreApi;
          if (c && (c.majorVersion > 1 || (c.majorVersion === 1 && c.minorVersion > targetMinor))) {
            patched.push(m[1] + '  (' + c.majorVersion + '.' + c.minorVersion + ' -> 1.' + targetMinor + ')');
            lj.coreApi = { majorVersion: 1, minorVersion: targetMinor };
            data = JSON.stringify(lj);
          }
        } catch (e) { /* defekte library.json unverändert übernehmen */ }
      }
      await out.add(name, data);
    }
    if (patched.length === 0) log('Keine Änderung nötig – keine Bibliothek verlangt mehr als Core 1.' + targetMinor + '.', 'ok');
    else {
      log('Core-API gesenkt bei ' + patched.length + ' Bibliotheken:', 'ok');
      patched.forEach((p) => log('  ' + p));
      log('ACHTUNG: Nutzt eine Bibliothek wirklich eine neuere Core-Funktion, kann es in Lumi trotzdem Fehler geben – bitte testen.', 'warn');
    }
    return { blob: out.finish(), filename: baseNameOf(file) + '-coreapi' + targetMinor + '.h5p' };
  }

  // ---------------------------------------------------------------- Oberfläche

  function setupDropzone(zone, input, onFile) {
    const nameEl = zone.querySelector('.dz-file');
    const pick = (file) => {
      if (!file) return;
      nameEl.textContent = file.name + ' (' + formatSize(file.size) + ')';
      zone.classList.add('has-file');
      onFile(file);
    };
    input.addEventListener('change', () => pick(input.files[0]));
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag');
      pick(e.dataTransfer.files[0]);
    });
  }

  function setupTask(prefix, run) {
    let file = null;
    const btn = $(prefix + '-run');
    const logEl = $(prefix + '-log');
    const result = $(prefix + '-result');
    const bar = $(prefix + '-progress');
    setupDropzone($(prefix + '-drop'), $(prefix + '-file'), (f) => { file = f; btn.disabled = false; });
    btn.addEventListener('click', async () => {
      if (!file) return;
      btn.disabled = true;
      logEl.innerHTML = '';
      logEl.hidden = false;
      result.innerHTML = '';
      if (bar) { bar.hidden = false; bar.value = 0; }
      const log = logTo(logEl);
      const t0 = performance.now();
      try {
        const { blob, filename } = await run(file, log, (p) => { if (bar) bar.value = p; });
        log('Dauer: ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s');
        offerDownload(result, blob, filename);
      } catch (e) {
        for (const line of String(e && e.message || e).split('\n')) log(line, 'error');
        console.error(e);
      } finally {
        btn.disabled = false;
        if (bar) bar.hidden = true;
      }
    });
  }

  function checkBrowser() {
    if (typeof DecompressionStream === 'undefined' || typeof CompressionStream === 'undefined') {
      $('browser-warning').hidden = false;
      document.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      return false;
    }
    try { new DecompressionStream('deflate-raw'); } catch (e) { $('browser-warning').hidden = false; return false; }
    return true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!checkBrowser()) return;
    setupTask('conv', (file, log, progress) => convert(file, $('conv-hub').checked, log, progress));
    setupTask('patch', (file, log) => patchCoreApi(file, parseInt($('patch-minor').value, 10) || 27, log));
  });

  // Für Tests im Browser erreichbar.
  window.H5PExportWeb = { convert, patchCoreApi };
})();
