# BERICHT – ehrlicher Stand (Spec 1.4 „Ehrlicher Bericht“, 10.1 Nr. 6)

Je Phase ein Eintrag, neueste oben. Kurz, sachlich.

```
## Phase N – <Titel> – <Datum Uhrzeit>
Gebaut: <IDs>
Geprüft: Unit x/x, API x/x, E2E <T-/INT-IDs> grün; Screenshots angesehen: ja/nein (welche)
Nicht geprüft: <z. B. echter Scanner, echter Drucker, macOS-Build, Windows-Build, echter Cloud-Host>
Bekannte Fehler/Grenzen: <…>
Annahmen: D-xx, D-yy
```

## Phase 0+1 – Gerüst, Server-Grundgerüst, App-Hüllen – 14.11.2026
Gebaut: npm-Workspaces (domain, db, server, client, ui, shell, station-web), Migrations-Runner, Electron-Hülle beider Apps (gemeinsam in @lager/shell), CI-Workflows; R-01–R-11, FA-54 (TOTP), FA-48 Grundteil, FA-52, NFA-01 (Header, CSRF, CSV-Schutz), UI-1, UI-2, UI-4–UI-8, WebSocket-Hub, Handoff/Deep-Links, INT-01.
Geprüft: Unit+API alle grün (domain, db, server, client, ui, shell); E2E rauchtest + huelle (UI-1, INT-01) grün; Screenshots angesehen: ja (Productionplaner Admin hell). spec-pruefer Phase 0/1: Befunde zu R-10 (Cookie gleitend), R-05 (Seite Zugriff verweigert), R-08 (Fenster-Test), CSV, Design-Prüfung, UI-6 (Systemwechsel) behoben; R-01/R-09/UI-1/3.15-download als D-33–D-36 eingetragen.
Nicht geprüft: CI-Läufe auf GitHub (Secret LAGER_REPO_TOKEN evtl. nötig, D-25), macOS/Windows-Builds, echter Cloud-Host, Deep-Link-Registrierung im Betriebssystem (im Test über argv simuliert), safeStorage-Verschlüsselung unter Linux-Testmodus (Fallback ohne Schlüsselbund).
Bekannte Fehler/Grenzen: Startseiten sind Platzhalter (FA-35 folgt Phase 10).
Annahmen: D-21–D-36

