# H5P-Export (Web)

Wandelt eine `.h5p`-Datei **im Browser** in ein HTML5-Paket um, das per Doppelklick offline läuft.
Die Datei wird nicht hochgeladen. Nur wenn Bibliotheken fehlen und das Nachladen eingeschaltet ist,
wird der Name des Inhaltstyps beim offiziellen H5P-Hub (`api.h5p.org`) abgefragt.

**Online:** https://zwetschk.github.io/h5p-export/

Enthalten: [h5p-standalone](https://github.com/tunapanda/h5p-standalone) 3.8.2 (MIT) als Player und
63 H5P-Bibliotheken (Lizenz jeweils in der `library.json`). H5P ist eine Marke der H5P Group AS;
dies ist kein offizielles H5P-Angebot.

Diese Dateien werden automatisch aus `web/build.js` erzeugt und mit `web/deploy.js` veröffentlicht.
