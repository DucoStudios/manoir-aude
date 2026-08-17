// Skrapar det lokala turistagendat (CDT11/Tourinsoft-data, inbäddat via
// lagrandemaison-peyriacdemer.fr/tourismevent) och underhåller events.json.
// Inga npm-beroenden - kör på Node 20+ (globalt fetch), samma monster som
// husvagn-quests scripts/scrape.mjs.

import { writeFile } from "node:fs/promises";

const SOURCE_URL = "https://www.lagrandemaison-peyriacdemer.fr/tourismevent";
const USER_AGENT =
  "ManoirAudeEventsBot/1.0 (site vitrine Le Manoir d'Aude, contact: jean-claude@ducomaison.fr)";
const OUT_FILE = new URL("../events.json", import.meta.url);
const MAX_EVENTS = 40;

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&eacute;/gi, "é")
    .replace(/&egrave;/gi, "è")
    .replace(/&agrave;/gi, "à")
    .replace(/&ecirc;/gi, "ê")
    .replace(/&ocirc;/gi, "ô")
    .replace(/&ccedil;/gi, "ç");
}

function clean(str) {
  return decodeEntities(str.replace(/\s+/g, " ").trim());
}

async function fetchHtml() {
  const res = await fetch(SOURCE_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Fetch misslyckades (${res.status}) for ${SOURCE_URL}`);
  return res.text();
}

function parseEvents(html) {
  const events = [];
  const thumbRe =
    /<div class="lazy-thumb tourism_thumb[^"]*" role="button"[^>]*data-category="([a-z]+)" data-popover-content="#(myPopover\d+)" title="([^"]*)">/g;

  let match;
  while ((match = thumbRe.exec(html))) {
    const [, category, popoverId, titleRaw] = match;
    const title = clean(titleRaw);
    const windowAfter = html.slice(match.index, match.index + 3000);

    const imgMatch = windowAfter.match(/data-src="([^"]+)"/);
    const image = imgMatch ? imgMatch[1] : null;

    const locMatch = windowAfter.match(/fa-map-marker"><\/i>\s*<small><span>([^<]*)<\/span>/);
    const shortLocation = locMatch ? clean(locMatch[1]) : "";

    const popoverRe = new RegExp(`<div id="${popoverId}" class="hide">([\\s\\S]*?)</div>`);
    const popoverMatch = html.slice(match.index).match(popoverRe);
    if (!popoverMatch) continue;
    const popover = popoverMatch[1];

    const rangeMatch = popover.match(
      /<p>Du <span>([\d-]+)<\/span>\s*-\s*(?:Au|To)\s*<span>([\d-]+)<\/span><\/p>/
    );
    const singleMatch = popover.match(/<p>(?:Le|On) <span>([\d-]+)<\/span><\/p>/);
    if (!rangeMatch && !singleMatch) continue;
    const startDate = rangeMatch ? rangeMatch[1] : singleMatch[1];
    const endDate = rangeMatch ? rangeMatch[2] : singleMatch[1];

    const timesMatch = popover.match(/fa-clock-o[^>]*><\/i>([\s\S]*?)<\/p>/);
    const times = timesMatch
      ? [...timesMatch[1].matchAll(/<span>([\d:]+)<\/span>/g)].map((m) => m[1])
      : [];

    const addrMatch = popover.match(/fa-map-marker text-info"><\/i>\s*([\s\S]*?)<\/p>/);
    let address = "";
    if (addrMatch) {
      const spans = [...addrMatch[1].matchAll(/<span>([^<]*)<\/span>/g)]
        .map((m) => clean(m[1]))
        .filter(Boolean);
      address = spans.join(", ");
    }

    const descMatch = popover.match(/<strong>Description:<\/strong><\/p>\s*<p>([\s\S]*?)<\/p>/);
    const description = descMatch ? clean(descMatch[1].replace(/\n+/g, " ")) : "";

    if (!title || !startDate) continue;

    events.push({
      id: popoverId,
      title,
      category,
      image,
      startDate,
      endDate,
      times,
      location: shortLocation,
      address,
      description,
    });
  }
  return events;
}

function dedupe(events) {
  const seen = new Set();
  return events.filter((e) => {
    const key = `${e.title}__${e.startDate}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  const html = await fetchHtml();
  let events = parseEvents(html);
  events = dedupe(events);

  const today = new Date().toISOString().slice(0, 10);
  events = events.filter((e) => e.endDate >= today);
  events.sort((a, b) => a.startDate.localeCompare(b.startDate));
  events = events.slice(0, MAX_EVENTS);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: SOURCE_URL,
    sourceCredit:
      "Données : Comité Départemental du Tourisme de l'Aude (CDT11), via lagrandemaison-peyriacdemer.fr",
    count: events.length,
    events,
  };

  await writeFile(OUT_FILE, JSON.stringify(payload, null, 2) + "\n");
  console.log(`Skrev ${events.length} evenemang till events.json`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
