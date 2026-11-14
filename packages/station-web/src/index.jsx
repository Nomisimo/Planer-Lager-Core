// Arbeitsplatz-Web (R-11a–g) und Ladezonen-Anzeige (R-59). Seiten folgen in Phase 8.
import React from "react";
import { createRoot } from "react-dom/client";
import { wendeDesignAn } from "@lager/ui/huelle.jsx";
import { Section, Meldung } from "@lager/ui/bausteine.jsx";
import STIL from "@lager/ui/stil.css";

const s = document.createElement("style"); s.textContent = STIL; document.head.appendChild(s);
wendeDesignAn({ dichte: "gross" });
createRoot(document.getElementById("root")).render(
  <div className="lp-login"><Section titel="Lager-Arbeitsplatz" icon="Monitor"><Meldung level="info" text="Dieser Arbeitsplatz ist noch nicht eingerichtet. Melde dich beim Admin." /></Section></div>
);
