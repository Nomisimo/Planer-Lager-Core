-- NFA-03: Protokoll über Zugriffe auf Kundendaten (Art „zugriff“).
ALTER TABLE sicherheit_ereignis DROP CONSTRAINT sicherheit_ereignis_art_check;
ALTER TABLE sicherheit_ereignis ADD CONSTRAINT sicherheit_ereignis_art_check CHECK (art IN ('login', 'logout', 'fehlversuch', 'sperre', 'verweigert', 'aktion', 'download', 'zugriff'));
