/**
 * h5p-html.js – gemeinsame Bausteine für das erzeugte HTML5-Paket.
 * Wird von tools/h5p2html.js (Node) UND von der Web-Version (Browser) benutzt,
 * damit beide exakt dasselbe Paket erzeugen.
 *
 * Node:    const H = require('./h5p-html.js');
 * Browser: <script src="h5p-html.js"></script>  ->  window.H5PHtml
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.H5PHtml = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PLAYER_VERSION = '3.8.2';

  const PLAYER_FILES = [
    'frame.bundle.js',
    'styles/h5p.css',
    'styles/h5p-fonts.css',
    'fonts/h5p-core-30.woff2',
    'fonts/h5p-hub-publish.woff',
    'fonts/h5p-hub-publish.woff2',
    'fonts/h5p-theme.woff2',
    'fonts/inter/Inter-ExtraBold.woff2',
    'fonts/inter/Inter-ExtraBoldItalic.woff2',
    'fonts/inter/inter-v18-cyrillic_cyrillic-ext_greek_greek-ext_latin_latin-ext_vietnamese-600.woff2',
    'fonts/inter/inter-v18-cyrillic_cyrillic-ext_greek_greek-ext_latin_latin-ext_vietnamese-600italic.woff2',
    'fonts/inter/inter-v18-cyrillic_cyrillic-ext_greek_greek-ext_latin_latin-ext_vietnamese-italic.woff2',
    'fonts/inter/inter-v18-cyrillic_cyrillic-ext_greek_greek-ext_latin_latin-ext_vietnamese-regular.woff2',
    'fonts/open-sans/open-sans-v40-cyrillic_cyrillic-ext_greek_greek-ext_hebrew_latin_latin-ext_math_symbols_vietnamese-600.woff2',
    'fonts/open-sans/open-sans-v40-cyrillic_cyrillic-ext_greek_greek-ext_hebrew_latin_latin-ext_math_symbols_vietnamese-600italic.woff2',
    'fonts/open-sans/open-sans-v40-cyrillic_cyrillic-ext_greek_greek-ext_hebrew_latin_latin-ext_math_symbols_vietnamese-700.woff2',
    'fonts/open-sans/open-sans-v40-cyrillic_cyrillic-ext_greek_greek-ext_hebrew_latin_latin-ext_math_symbols_vietnamese-700italic.woff2',
    'fonts/open-sans/open-sans-v40-cyrillic_cyrillic-ext_greek_greek-ext_hebrew_latin_latin-ext_math_symbols_vietnamese-italic.woff2',
    'fonts/open-sans/open-sans-v40-cyrillic_cyrillic-ext_greek_greek-ext_hebrew_latin_latin-ext_math_symbols_vietnamese-regular.woff2',
    'images/h5p.svg',
    'images/throbber.gif'
  ];

  // ---------------------------------------------------------------- Sicherheit

  /**
   * Prüft einen Eintragsnamen aus einem ZIP-Archiv. Liefert den bereinigten
   * Namen (mit "/") oder null, wenn der Eintrag aus dem Zielordner ausbrechen
   * würde (Zip-Slip: "../", absolute Pfade, Laufwerksbuchstaben).
   */
  function safeEntryName(name) {
    const n = String(name).replace(/\\/g, '/');
    if (!n || n.startsWith('/') || /^[a-zA-Z]:/.test(n) || n.includes('\0')) return null;
    const parts = n.split('/');
    if (parts.some((p) => p === '..')) return null;
    return parts.filter((p) => p !== '' && p !== '.').join('/') + (n.endsWith('/') ? '/' : '');
  }

  /** Maskiert Text für die Verwendung im HTML. */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** JSON, das gefahrlos in einem <script>-Block stehen kann (kein "</script>", kein "<!--"). */
  const LS = String.fromCharCode(0x2028); // Zeilentrenner, in <script> problematisch
  const PS = String.fromCharCode(0x2029);
  function scriptJson(value) {
    return JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .split(LS).join('\\u2028')
      .split(PS).join('\\u2029');
  }

  // ---------------------------------------------------------------- Oberflächentexte (Kern)

  const L10N_EN = {
    fullscreen: 'Fullscreen', disableFullscreen: 'Disable fullscreen', download: 'Download',
    copyrights: 'Rights of use', embed: 'Embed', size: 'Size', showAdvanced: 'Show advanced',
    hideAdvanced: 'Hide advanced',
    advancedHelp: 'Include this script on your website if you want dynamic sizing of the embedded content:',
    copyrightInformation: 'Rights of use', close: 'Close', title: 'Title', author: 'Author',
    year: 'Year', source: 'Source', license: 'License', thumbnail: 'Thumbnail',
    noCopyrights: 'No copyright information available for this content.', reuse: 'Reuse',
    reuseContent: 'Reuse Content', reuseDescription: 'Reuse this content.',
    downloadDescription: 'Download this content as a H5P file.',
    copyrightsDescription: 'View copyright information for this content.',
    embedDescription: 'View the embed code for this content.',
    h5pDescription: 'Visit H5P.org to check out more cool content.',
    contentChanged: 'This content has changed since you last used it.',
    startingOver: "You'll be starting over.", by: 'by', showMore: 'Show more',
    showLess: 'Show less', subLevel: 'Sublevel', confirmDialogHeader: 'Confirm action',
    confirmDialogBody: 'Please confirm that you wish to proceed. This action is not reversible.',
    cancelLabel: 'Cancel', confirmLabel: 'Confirm', licenseU: 'Undisclosed',
    licenseCCBY: 'Attribution', licenseCCBYSA: 'Attribution-ShareAlike',
    licenseCCBYND: 'Attribution-NoDerivs', licenseCCBYNC: 'Attribution-NonCommercial',
    licenseCCBYNCSA: 'Attribution-NonCommercial-ShareAlike',
    licenseCCBYNCND: 'Attribution-NonCommercial-NoDerivs', licenseCC40: '4.0 International',
    licenseCC30: '3.0 Unported', licenseCC25: '2.5 Generic', licenseCC20: '2.0 Generic',
    licenseCC10: '1.0 Generic', licenseGPL: 'General Public License', licenseV3: 'Version 3',
    licenseV2: 'Version 2', licenseV1: 'Version 1', licensePD: 'Public Domain',
    licenseCC010: 'CC0 1.0 Universal (CC0 1.0) Public Domain Dedication',
    licensePDM: 'Public Domain Mark', licenseC: 'Copyright', contentType: 'Content Type',
    licenseExtras: 'License Extras', changes: 'Changelog',
    contentCopied: 'Content is copied to the clipboard',
    connectionLost: 'Connection lost. Results will be stored and sent when you regain connection.',
    connectionReestablished: 'Connection reestablished.',
    resubmitScores: 'Attempting to submit stored results.',
    offlineDialogHeader: 'Your connection to the server was lost',
    offlineDialogBody: 'We were unable to send information about your completion of this task. Please check your internet connection.',
    offlineDialogRetryMessage: 'Retrying in :num…',
    offlineDialogRetryButtonLabel: 'Retry now',
    offlineSuccessfulSubmit: 'Successfully submitted results.'
  };

  const L10N_DE = {
    fullscreen: 'Vollbild', disableFullscreen: 'Vollbild beenden', download: 'Herunterladen',
    copyrights: 'Nutzungsrechte', embed: 'Einbetten', size: 'Größe',
    showAdvanced: 'Erweitert anzeigen', hideAdvanced: 'Erweitert ausblenden',
    advancedHelp: 'Binden Sie dieses Skript auf Ihrer Website ein, wenn Sie eine dynamische Größenanpassung des eingebetteten Inhalts wünschen:',
    copyrightInformation: 'Nutzungsrechte', close: 'Schließen', title: 'Titel', author: 'Autor',
    year: 'Jahr', source: 'Quelle', license: 'Lizenz', thumbnail: 'Vorschaubild',
    noCopyrights: 'Für diesen Inhalt sind keine Nutzungsrechte verfügbar.',
    reuse: 'Weiterverwenden', reuseContent: 'Inhalt weiterverwenden',
    reuseDescription: 'Diesen Inhalt weiterverwenden.',
    downloadDescription: 'Diesen Inhalt als H5P-Datei herunterladen.',
    copyrightsDescription: 'Nutzungsrechte für diesen Inhalt anzeigen.',
    embedDescription: 'Den Einbettungscode für diesen Inhalt anzeigen.',
    h5pDescription: 'Besuchen Sie H5P.org, um mehr tolle Inhalte zu entdecken.',
    contentChanged: 'Dieser Inhalt hat sich geändert, seit Sie ihn zuletzt verwendet haben.',
    startingOver: 'Sie werden von vorne beginnen.', by: 'von', showMore: 'Mehr anzeigen',
    showLess: 'Weniger anzeigen', subLevel: 'Unterebene',
    confirmDialogHeader: 'Aktion bestätigen',
    confirmDialogBody: 'Bitte bestätigen Sie, dass Sie fortfahren möchten. Diese Aktion kann nicht rückgängig gemacht werden.',
    cancelLabel: 'Abbrechen', confirmLabel: 'Bestätigen', licenseU: 'Nicht angegeben',
    licenseCCBY: 'Namensnennung', licenseCCBYSA: 'Namensnennung – Weitergabe unter gleichen Bedingungen',
    licenseCCBYND: 'Namensnennung – Keine Bearbeitung',
    licenseCCBYNC: 'Namensnennung – Nicht kommerziell',
    licenseCCBYNCSA: 'Namensnennung – Nicht kommerziell – Weitergabe unter gleichen Bedingungen',
    licenseCCBYNCND: 'Namensnennung – Nicht kommerziell – Keine Bearbeitung',
    licenseCC40: '4.0 International', licenseCC30: '3.0 Unported', licenseCC25: '2.5 Generic',
    licenseCC20: '2.0 Generic', licenseCC10: '1.0 Generic',
    licenseGPL: 'General Public License', licenseV3: 'Version 3', licenseV2: 'Version 2',
    licenseV1: 'Version 1', licensePD: 'Public Domain',
    licenseCC010: 'CC0 1.0 Universal (CC0 1.0) Public Domain Dedication',
    licensePDM: 'Public Domain Mark', licenseC: 'Copyright', contentType: 'Inhaltstyp',
    licenseExtras: 'Lizenz-Zusätze', changes: 'Änderungsprotokoll',
    contentCopied: 'Der Inhalt wurde in die Zwischenablage kopiert',
    connectionLost: 'Verbindung verloren. Ergebnisse werden gespeichert und gesendet, sobald die Verbindung wiederhergestellt ist.',
    connectionReestablished: 'Verbindung wiederhergestellt.',
    resubmitScores: 'Es wird versucht, gespeicherte Ergebnisse zu senden.',
    offlineDialogHeader: 'Die Verbindung zum Server ist verloren gegangen',
    offlineDialogBody: 'Ihre Ergebnisse konnten nicht gesendet werden. Bitte überprüfen Sie Ihre Internetverbindung.',
    offlineDialogRetryMessage: 'Erneut versuchen in :num …',
    offlineDialogRetryButtonLabel: 'Jetzt erneut versuchen',
    offlineSuccessfulSubmit: 'Ergebnisse erfolgreich gesendet.'
  };

  /** Oberflächentexte passend zur Sprache aus h5p.json. */
  function l10nFor(language) {
    const lang = String(language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en';
    const l10n = Object.assign({}, L10N_EN, lang === 'de' ? L10N_DE : {});
    l10n.lang = lang;
    return l10n;
  }

  // ---------------------------------------------------------------- Metadaten / Lizenz

  const METADATA_KEYS = ['authors', 'source', 'license', 'licenseVersion', 'licenseExtras',
    'yearFrom', 'yearTo', 'changes', 'authorComments'];

  /** Übernimmt Titel, Autoren und Lizenz aus h5p.json in die Player-Metadaten. */
  function buildMetadata(h5pJson, title) {
    const meta = { title: title, license: 'U' };
    for (const key of METADATA_KEYS) {
      if (h5pJson[key] !== undefined && h5pJson[key] !== '') meta[key] = h5pJson[key];
    }
    return meta;
  }

  /** true, wenn es Lizenz-/Autorenangaben gibt, die angezeigt werden sollten. */
  function hasRightsInfo(meta) {
    return (meta.license && meta.license !== 'U') || (Array.isArray(meta.authors) && meta.authors.length > 0);
  }

  // ---------------------------------------------------------------- HTML erzeugen

  /**
   * Erzeugt die index.html des Pakets.
   * opts: { title, mainLibrary, contentJson (String), styles, scripts, l10n, metadata }
   */
  function buildIndexHtml(opts) {
    const { title, mainLibrary, contentJson, styles, scripts, l10n } = opts;
    const metadata = opts.metadata || { title: title, license: 'U' };
    // Mit Lizenzangaben: H5P-Leiste mit "Nutzungsrechte" anzeigen, sonst wie bisher ohne Leiste.
    const rights = hasRightsInfo(metadata);
    const displayOptions = { frame: rights, export: false, embed: false, copyright: rights, icon: !rights, copy: false };
    return `<!DOCTYPE html>
<html lang="${escapeHtml(l10n.lang)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="data:,">
<title>${escapeHtml(title)}</title>
<style>
  html, body { margin: 0; padding: 0; background: #f4f4f4; font-family: sans-serif; }
  #h5p-container { width: 100%; min-height: 100vh; }
  #h5p-loading { text-align:center; padding:60px 20px; color:#555; font-size:16px; }
  #h5p-loading .spinner { display:inline-block; width:32px; height:32px; border:4px solid #ccc; border-top-color:#1869b8; border-radius:50%; animation:h5pspin 1s linear infinite; margin-bottom:12px; }
  @keyframes h5pspin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div id="h5p-container">
  <div id="h5p-loading"><div class="spinner"></div><div>Inhalt wird geladen …</div></div>
</div>

<script>
/* Dieses Skript bettet alle H5P-Daten direkt ein (kein fetch), damit die Seite
   auch per Doppelklick vom Dateisystem (file://) funktioniert. */
(function () {
  var BASE = location.href.substring(0, location.href.lastIndexOf('/') + 1);
  var CONTENT_ID = '1';

  window.H5P = window.H5P || {};
  window.H5P.preventInit = true;
  window.H5PIntegration = {
    baseUrl: BASE,
    url: BASE + 'h5p',
    urlLibraries: BASE + 'h5p',
    saveFreq: false,
    postUserStatistics: false,
    ajax: {},
    l10n: { H5P: ${scriptJson(l10n)} },
    core: {
      styles: ['player/styles/h5p.css'],
      scripts: ['player/frame.bundle.js']
    },
    contents: {
      ['cid-' + CONTENT_ID]: {
        library: ${scriptJson(mainLibrary)},
        title: ${scriptJson(title)},
        url: BASE + 'h5p',
        contentUrl: BASE + 'h5p/content',
        jsonContent: ${scriptJson(contentJson)},
        styles: ${scriptJson(styles)},
        scripts: ${scriptJson(scripts)},
        fullScreen: true,
        displayOptions: ${scriptJson(displayOptions)},
        metadata: ${scriptJson(metadata)}
      }
    }
  };

  function loadCss(href) {
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function init() {
    var loading = document.getElementById('h5p-loading');
    if (loading) loading.remove();
    var wrapper = document.createElement('div');
    wrapper.className = 'h5p-iframe-wrapper';
    var iframe = document.createElement('iframe');
    iframe.className = 'h5p-iframe';
    iframe.setAttribute('data-content-id', CONTENT_ID);
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('frameBorder', '0');
    iframe.style.width = '100%';
    iframe.style.height = '100vh';
    iframe.style.border = 'none';
    iframe.style.display = 'block';
    wrapper.appendChild(iframe);
    document.getElementById('h5p-container').appendChild(wrapper);
    window.H5P.init();
  }

  loadCss('player/styles/h5p.css');
  loadScript('player/frame.bundle.js').then(init).catch(function (e) {
    var l = document.getElementById('h5p-loading');
    if (l) l.textContent = 'Fehler: ' + e.message;
  });
})();
</script>
</body>
</html>
`;
  }

  // ---------------------------------------------------------------- Startskripte / README

  function startBat() {
    return [
      '@echo off', 'chcp 65001 >nul', 'cd /d "%~dp0"',
      'where python >nul 2>nul && (start "" http://localhost:8765/ & python -m http.server 8765 & goto :eof)',
      'where py >nul 2>nul && (start "" http://localhost:8765/ & py -m http.server 8765 & goto :eof)',
      'where npx >nul 2>nul && (start "" http://localhost:8765/ & npx --yes http-server -p 8765 & goto :eof)',
      'start "" "%~dp0index.html"', ''
    ].join('\r\n');
  }

  function startCommand() {
    return [
      '#!/bin/bash', 'cd "$(dirname "$0")"',
      'if command -v python3 >/dev/null 2>&1; then python3 -m http.server 8765 &',
      'elif command -v python >/dev/null 2>&1; then python -m http.server 8765 &',
      'elif command -v npx >/dev/null 2>&1; then npx --yes http-server -p 8765 &',
      'else echo "Kein Webserver gefunden. Bitte index.html direkt öffnen."; exit 1; fi',
      'sleep 1',
      'if command -v open >/dev/null 2>&1; then open http://localhost:8765/;',
      'elif command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:8765/; fi',
      'wait', ''
    ].join('\n');
  }

  function packageReadme(title, creator) {
    return [
      title + ' – HTML5-Paket', '===================================', '',
      'START:', '  Einfach "index.html" doppelklicken.', '',
      '  Falls der Browser blockiert: "start.bat" (Windows) oder "start.command" (macOS/Linux) ausführen.',
      '', 'Erstellt mit ' + (creator || 'h5p2html.js'), ''
    ].join('\r\n');
  }

  return {
    PLAYER_VERSION, PLAYER_FILES, safeEntryName, escapeHtml, scriptJson,
    L10N_EN, L10N_DE, l10nFor, buildMetadata, hasRightsInfo, buildIndexHtml,
    startBat, startCommand, packageReadme
  };
});
