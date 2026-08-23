import { writeFile } from "node:fs/promises";

const feeds = [
  { name: "IGN", url: "https://feeds.ign.com/ign/all" },
  { name: "Pocket Gamer", url: "https://www.pocketgamer.com/rss.xml" },
  { name: "Vandal", url: "https://vandal.elespanol.com/rss" },
  { name: "3DJuegos", url: "https://www.3djuegos.com/rss" }
];

const strip = value => (value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const tag = (xml, name) => (xml.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)</" + name + ">", "i")) || [])[1] || "";
function rssItems(xml, source) {
  return [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)].map(m => {
    const x = m[0];
    return { source: source.name, title: strip(tag(x, "title")), url: strip(tag(x, "link")), description: strip(tag(x, "description")).slice(0, 700), publishedAt: strip(tag(x, "pubDate")) };
  }).filter(x => x.title && x.url);
}
async function collect() {
  const batches = await Promise.all(feeds.map(async feed => {
    try {
      const response = await fetch(feed.url, { headers: { "User-Agent": "ALON-NEWS/1.0 editorial desk" } });
      if (!response.ok) throw new Error(response.status);
      return rssItems(await response.text(), feed);
    } catch (error) {
      console.warn("Skipping unavailable feed:", feed.name, error.message);
      return [];
    }
  }));
  const seen = new Set();
  return batches.flat().filter(item => {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 18);
}
async function writeEdition(candidates) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing. Add it in GitHub Actions secrets.");
  if (candidates.length < 5) throw new Error("Too few source items were available; nothing was published.");
  const prompt = `You are the careful editor of ALON NEWS, an independent English-first gaming publication. Create at most 10 original news briefs from the verified source leads below. Return ONLY valid JSON: {"articles":[...]}. Each article must have: slug, category, title_en, title_es, dek_en, dek_es, body_en (array of exactly 3 short original paragraphs), body_es (Spanish translation array), source_url, source_name. Use only claims supported by the individual lead. Do not copy wording, do not invent facts, no financial advice, and do not treat rumors as facts. Keep competitor names out of titles and body; source_name is for the transparent source box at the end only. Slugs must be unique lowercase hyphenated.\n\nLEADS:\n${JSON.stringify(candidates)}`;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.OPENAI_API_KEY },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4.1-mini", temperature: 0.35, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] })
  });
  if (!response.ok) throw new Error("OpenAI request failed: " + response.status + " " + await response.text());
  const payload = await response.json();
  const generated = JSON.parse(payload.choices?.[0]?.message?.content || "{}").articles || [];
  const candidateUrls = new Set(candidates.map(x => x.url));
  const articles = generated.filter(x => x && x.slug && candidateUrls.has(x.source_url) && Array.isArray(x.body_en) && Array.isArray(x.body_es)).slice(0, 10);
  if (articles.length < 5) throw new Error("Editorial quality check rejected the generated edition.");
  await writeFile("articles.json", JSON.stringify({ generatedAt: new Date().toISOString(), articles }, null, 2) + "\n");
  console.log("Published", articles.length, "original briefs.");
}
await writeEdition(await collect());