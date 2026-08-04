import { writeFile } from "node:fs/promises";

const SOURCES = [
  { label: "Bakluckeloppis i Skåne", url: "https://bakluckeloppisiskane.se/" },
  { label: "Österlens loppisguide", url: "https://osterlen.se/sv/guide/loppis-antikviteter/" },
];

const OUTPUT_PATH = process.env.OUTPUT_PATH || "markets.json";
const MODEL = process.env.OPENAI_MODEL || "gpt-5";
const BBOX = { west: 12.35, east: 14.65, south: 55.25, north: 56.35 };

function htmlToText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&aring;/gi, "å").replace(/&auml;/gi, "ä").replace(/&ouml;/gi, "ö")
    .replace(/&#\d+;/g, " ").replace(/\s+/g, " ").trim();
}

async function readSources() {
  const results = [];
  for (const source of SOURCES) {
    const response = await fetch(source.url, {
      headers: { "user-agent": "Loppisjakten-Skane/1.0 (GitHub Actions; source research)" },
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw new Error(`${source.url}: HTTP ${response.status}`);
    results.push({ ...source, text: htmlToText(await response.text()).slice(0, 45_000) });
  }
  return results;
}

function outputText(response) {
  return (response.output || []).flatMap(item => item.content || [])
    .filter(item => item.type === "output_text").map(item => item.text).join("\n");
}

function normalizeMarket(market, index) {
  const size = ["Liten", "Mellan", "Stor"].includes(market.size) ? market.size : "Liten";
  const day = market.day === "Söndag" ? "Söndag" : "Lördag";
  const longitude = Number(market.longitude);
  const latitude = Number(market.latitude);
  const hasCoordinates = Number.isFinite(longitude) && Number.isFinite(latitude);
  const x = hasCoordinates ? ((longitude - BBOX.west) / (BBOX.east - BBOX.west)) * 100 : 50;
  const y = hasCoordinates ? ((BBOX.north - latitude) / (BBOX.north - BBOX.south)) * 100 : 50;
  const sources = Array.isArray(market.sources) ? market.sources
    .filter(source => source?.url && SOURCES.some(allowed => source.url.startsWith(allowed.url)))
    .slice(0, 2) : [];

  return {
    id: index + 1,
    name: String(market.name || "Namnlös loppis"), place: String(market.place || "Skåne"),
    region: String(market.region || "Skåne"), distance: 0, day, date: String(market.date || "Datum saknas"),
    hours: String(market.hours || "Tid saknas"), size, type: String(market.type || "Okänt"),
    score: Math.min(5, Math.max(0, Number(market.score) || 0)),
    confidence: ["Hög", "Medel", "Låg"].includes(market.confidence) ? market.confidence : "Låg",
    sellers: String(market.sellers || "Storlek okänd"), x: Math.min(96, Math.max(4, x)), y: Math.min(96, Math.max(4, y)),
    note: String(market.note || "Ingen beskrivning tillgänglig."),
    verified: String(market.verified || "Ej verifierad"), tags: Array.isArray(market.tags) ? market.tags.slice(0, 3).map(String) : [],
    contact: String(market.contact || "Kontakt saknas"), sources,
  };
}

async function enrichWithOpenAI(sources) {
  const today = new Date().toISOString().slice(0, 10);
  const sourceText = sources.map(source => `KÄLLA: ${source.label}\nURL: ${source.url}\nTEXT: ${source.text}`).join("\n\n");
  const prompt = `Du är en noggrann researchagent för loppmarknader i Skåne. Dagens datum är ${today}.
Extrahera endast kommande, uttryckligen angivna loppmarknader ur källtexten. Hitta inte på fakta. Om öppettid, kontakt, storlek, koordinat eller omdöme saknas ska du skriva att uppgiften saknas eller använda null för koordinater. Kvalitetspoäng får bara anges om texten innehåller omdömen; annars 0. Datum ska vara kort på svenska, exempelvis "8 aug". longitude och latitude måste avse den nämnda platsen och ska vara null om exakta uppgifter saknas. sources får endast innehålla käll-URL:er nedan. Returnera enbart en giltig JSON-array med fälten name, place, region, day, date, hours, size (Liten/Mellan/Stor), type, score, confidence (Hög/Medel/Låg), sellers, note, verified, tags, contact, longitude, latitude, sources [{label,url}].

${sourceText}`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: prompt }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`OpenAI API: HTTP ${response.status} ${await response.text()}`);
  const text = outputText(await response.json()).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("AI-svaret var inte en JSON-array");
  return parsed.map(normalizeMarket).filter(market => market.sources.length > 0);
}

if (!process.env.OPENAI_API_KEY) {
  console.log("OPENAI_API_KEY saknas. Befintlig markets.json lämnas oförändrad.");
  process.exit(0);
}

const sources = await readSources();
const markets = await enrichWithOpenAI(sources);
if (markets.length === 0) throw new Error("Inga verifierbara kommande loppmarknader hittades; befintlig data lämnas oförändrad.");
await writeFile(OUTPUT_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), status: "live", markets }, null, 2)}\n`, "utf8");
console.log(`Skrev ${markets.length} loppmarknader till ${OUTPUT_PATH}.`);
