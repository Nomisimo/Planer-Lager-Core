// Plan-Symbole für yEd (FA-53): je Artikel ein Piktogramm, Symbolbibliothek als GraphML, SVG je Artikel.
// Aussehen bewusst schlicht; soll später angepasst werden (Wunsch des Auftraggebers).

/** Piktogramme: Schlüssel → Titel + SVG-Inhalt im 48×48-Feld (Strichzeichnung, currentColor). */
export const PIKTOGRAMME = Object.freeze({
  lautsprecher: { titel: "Lautsprecher", svg: '<rect x="12" y="4" width="24" height="40" rx="3"/><circle cx="24" cy="30" r="8"/><circle cx="24" cy="13" r="4"/>' },
  subwoofer: { titel: "Subwoofer", svg: '<rect x="6" y="8" width="36" height="32" rx="3"/><circle cx="24" cy="24" r="11"/><circle cx="24" cy="24" r="3"/>' },
  monitor: { titel: "Bühnenmonitor", svg: '<path d="M4 38 L14 12 H40 L44 38 Z"/><circle cx="27" cy="26" r="6"/>' },
  mikrofon: { titel: "Mikrofon", svg: '<rect x="18" y="4" width="12" height="22" rx="6"/><path d="M12 22 a12 12 0 0 0 24 0 M24 34 V44 M16 44 H32"/>' },
  mischpult: { titel: "Mischpult", svg: '<rect x="4" y="12" width="40" height="26" rx="2"/><path d="M12 18 V32 M20 18 V32 M28 18 V32 M36 18 V32"/><path d="M9 24 H15 M17 28 H23 M25 21 H31 M33 26 H39"/>' },
  scheinwerfer: { titel: "Scheinwerfer", svg: '<path d="M10 14 H30 L40 8 V40 L30 34 H10 Z"/><path d="M6 24 H10 M20 34 V44 M14 44 H26"/>' },
  movinghead: { titel: "Moving Head", svg: '<rect x="12" y="34" width="24" height="10" rx="2"/><path d="M16 34 V22 M32 34 V22"/><circle cx="24" cy="18" r="10"/><circle cx="24" cy="18" r="4"/>' },
  led: { titel: "LED-Leiste / Bar", svg: '<rect x="4" y="18" width="40" height="12" rx="2"/><circle cx="11" cy="24" r="2"/><circle cx="19" cy="24" r="2"/><circle cx="27" cy="24" r="2"/><circle cx="35" cy="24" r="2"/>' },
  dimmer: { titel: "Dimmer / Strom", svg: '<rect x="8" y="6" width="32" height="36" rx="3"/><path d="M26 12 L18 25 H25 L22 36 L31 22 H24 Z"/>' },
  stromverteiler: { titel: "Stromverteiler", svg: '<rect x="6" y="8" width="36" height="32" rx="3"/><circle cx="16" cy="18" r="4"/><circle cx="32" cy="18" r="4"/><circle cx="16" cy="32" r="4"/><circle cx="32" cy="32" r="4"/>' },
  netzwerk: { titel: "Netzwerk / Switch", svg: '<rect x="4" y="16" width="40" height="16" rx="2"/><path d="M10 22 h4 v4 h-4 z M18 22 h4 v4 h-4 z M26 22 h4 v4 h-4 z M34 22 h4 v4 h-4 z"/>' },
  video: { titel: "Video / Display", svg: '<rect x="4" y="8" width="40" height="26" rx="2"/><path d="M18 42 H30 M24 34 V42"/>' },
  beamer: { titel: "Beamer", svg: '<rect x="4" y="14" width="40" height="20" rx="3"/><circle cx="32" cy="24" r="6"/><path d="M8 20 H20 M8 26 H20"/>' },
  kamera: { titel: "Kamera", svg: '<rect x="4" y="14" width="30" height="22" rx="3"/><path d="M34 20 L44 14 V36 L34 30"/>' },
  traverse: { titel: "Traverse", svg: '<path d="M4 16 H44 M4 32 H44 M4 16 L12 32 L20 16 L28 32 L36 16 L44 32"/>' },
  stativ: { titel: "Stativ", svg: '<path d="M24 4 V30 M24 30 L10 44 M24 30 L38 44 M24 30 V44 M16 4 H32"/>' },
  buehne: { titel: "Bühnenelement", svg: '<path d="M4 18 L14 10 H44 L34 18 Z M4 18 V30 H34 V18 M34 30 L44 22 V10"/>' },
  kabel: { titel: "Kabel", svg: '<path d="M6 36 C 14 36, 14 12, 24 12 S 34 36, 42 36"/><rect x="2" y="32" width="8" height="8" rx="1"/><rect x="38" y="32" width="8" height="8" rx="1"/>' },
  funk: { titel: "Funkstrecke", svg: '<rect x="16" y="20" width="16" height="22" rx="2"/><path d="M24 20 V8 M14 10 a14 14 0 0 1 20 0 M10 5 a20 20 0 0 1 28 0"/>' },
  nebel: { titel: "Nebel / Effekt", svg: '<rect x="4" y="22" width="22" height="16" rx="2"/><path d="M26 28 C 32 22, 36 34, 42 26 M28 34 C 34 30, 38 40, 44 34"/>' },
  case: { titel: "Case / Tasche", svg: '<rect x="6" y="14" width="36" height="26" rx="3"/><path d="M18 14 V8 H30 V14 M6 24 H42"/>' },
  sonstiges: { titel: "Sonstiges", svg: '<rect x="8" y="8" width="32" height="32" rx="4"/><path d="M18 18 a6 6 0 1 1 8 6 v4 M24 34 v1"/>' },
});

/** Für Auswahllisten. */
export const PIKTOGRAMM_LISTE = Object.entries(PIKTOGRAMME).map(([wert, p]) => ({ wert, titel: p.titel }));

/** Prüft das Feld plansymbol: leer (automatisch) oder bekannter Schlüssel. */
export const plansymbolGueltig = (v) => v == null || v === "" || Object.hasOwn(PIKTOGRAMME, v);

const REGELN = [
  [/sub|bass/i, "subwoofer"], [/monitor|wedge/i, "monitor"], [/mikro|mic|sm ?58|headset/i, "mikrofon"], [/funk|sender|empf/i, "funk"],
  [/misch|pult|konsole|desk/i, "mischpult"], [/moving|spot|wash|beam/i, "movinghead"], [/\bled\b|\bbar\b|strip|leiste/i, "led"],
  [/dimmer/i, "dimmer"], [/verteil|strom|cee|schuko|power/i, "stromverteiler"], [/switch|netzwerk|router|access/i, "netzwerk"],
  [/beamer|projektor/i, "beamer"], [/kamera|camera/i, "kamera"], [/display|\btv\b|video|led-wand|screen/i, "video"],
  [/traverse|truss/i, "traverse"], [/stativ|\bstand\b/i, "stativ"], [/bühne|podest|stage/i, "buehne"], [/kabel|cable|dmx|xlr/i, "kabel"],
  [/nebel|haze|fog|effekt/i, "nebel"], [/scheinwerfer|\bpar\b|fresnel|profil|licht|lampe/i, "scheinwerfer"], [/lautsprecher|\bbox\b|\btop\b|speaker|\bpa\b/i, "lautsprecher"],
];

/** Piktogramm eines Artikels: gesetztes plansymbol, sonst aus Art/Name/Kategorie erraten. */
export function piktogrammVon(a) {
  if (a?.plansymbol && PIKTOGRAMME[a.plansymbol]) return a.plansymbol;
  if (a?.ist_case) return "case";
  if (a?.kabel || a?.laenge_m) return "kabel";
  const text = `${a?.name || ""} ${a?.kategorie || ""}`;
  return REGELN.find(([re]) => re.test(text))?.[1] || "sonstiges";
}

const xml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Dateiname für die SVG eines Artikels (ASCII, eindeutig über die ID). */
export function svgDateiname(a) {
  const n = String(a.name || "artikel").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "artikel";
  return `${String(a.id).padStart(4, "0")}-${n}.svg`;
}

/** SVG eines Artikels: Piktogramm (64×64) mit Kurzname darunter. */
export function symbolSvg(a) {
  const p = PIKTOGRAMME[piktogrammVon(a)];
  const name = String(a.name || "").slice(0, 22);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="76" viewBox="0 0 64 76">
  <title>${xml(a.name)}</title>
  <rect x="0.5" y="0.5" width="63" height="63" rx="6" fill="#ffffff" stroke="#333333"/>
  <g transform="translate(8 8)" fill="none" stroke="#1f2933" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${p.svg}</g>
  <text x="32" y="73" font-family="Helvetica, Arial, sans-serif" font-size="8" text-anchor="middle" fill="#1f2933">${xml(name)}</text>
</svg>
`;
}

/**
 * yEd-Symbolbibliothek (GraphML mit SVG-Knoten). In yEd: Palette → „Sektion importieren“ → Datei wählen.
 * @param {{id:number,name:string,kategorie?:string}[]} artikel
 */
export function symbolbibliothekGraphml(artikel) {
  const knoten = artikel.map((a, i) => `    <node id="n${i}">
      <data key="d5">${xml(a.name)}${a.kategorie ? ` (${xml(a.kategorie)})` : ""}</data>
      <data key="d6">
        <y:SVGNode>
          <y:Geometry height="76.0" width="64.0" x="${(i % 10) * 80}.0" y="${Math.floor(i / 10) * 100}.0"/>
          <y:Fill color="#CCCCFF" transparent="false"/>
          <y:BorderStyle color="#000000" type="line" width="1.0"/>
          <y:NodeLabel alignment="center" autoSizePolicy="content" fontFamily="Dialog" fontSize="10" fontStyle="plain" hasBackgroundColor="false" hasLineColor="false" modelName="sandwich" modelPosition="s" textColor="#000000" visible="true">${xml(a.name)}</y:NodeLabel>
          <y:SVGNodeProperties usingVisualBounds="true"/>
          <y:SVGModel svgBoundsPolicy="0"><y:SVGContent refid="${i + 1}"/></y:SVGModel>
        </y:SVGNode>
      </data>
    </node>`).join("\n");
  const res = artikel.map((a, i) => `      <y:Resource id="${i + 1}">${xml(symbolSvg(a))}</y:Resource>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:y="http://www.yworks.com/xml/graphml" xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://www.yworks.com/xml/schema/graphml/1.1/ygraphml.xsd">
  <key for="node" id="d5" attr.name="description" attr.type="string"/>
  <key for="node" id="d6" yfiles.type="nodegraphics"/>
  <key for="graphml" id="d7" yfiles.type="resources"/>
  <graph edgedefault="directed" id="G">
${knoten}
  </graph>
  <data key="d7">
    <y:Resources>
${res}
    </y:Resources>
  </data>
</graphml>
`;
}
