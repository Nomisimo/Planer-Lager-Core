-- Phase S (Oracle-Testserver): Einmal-Passwort (Wechsel beim ersten Login) und Protokollart „test“ für den Test-Token.
ALTER TABLE benutzer ADD COLUMN passwort_wechsel boolean NOT NULL DEFAULT false;
ALTER TABLE sicherheit_ereignis DROP CONSTRAINT sicherheit_ereignis_art_check;
ALTER TABLE sicherheit_ereignis ADD CONSTRAINT sicherheit_ereignis_art_check
  CHECK (art IN ('login', 'logout', 'fehlversuch', 'sperre', 'verweigert', 'aktion', 'download', 'zugriff', 'test'));
