import { writeFile } from "node:fs/promises";

const feeds = [
  { name: "IGN", url: "https://feeds.ign.com/ign/all" },
  { name: "Pocket Gamer", url: "https://www.pocketgamer.com/rss.xml" },
  { name: "Vandal", url: "https://vandal.elespanol.com/rss" },
  { name: "3DJuegos", url: "https://www.3djuegos.com/rss" }
];
const excluded = /\b(movie|movies|film|tv|television|watch order|amazon|preorder|deal|discount|best .*collaboration|how to|guide|review|opinion|podcast)\b/i;
const strip = value => (value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const tag = (xml, name) => (xml.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)</" + name + ">", "i")) || [])[1] || "";
function rssItems(xml, source) {
  return [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)].map(m => {
    const x = m[0];
    return { source: source.name, title: strip(tag(x, "title")), url: strip(tag(x, "link")), description: strip(tag(x, "description")).slice(0, 800), publishedAt: strip(tag(x, "pubDate")) };
  }).filter(x => x.title && x.url && !excluded.test(x.title + " " + x.description));
}
async function collect() {
  const batches = await Promise.all(feeds.map(async feed => {
    try {
      const response = await fetch(feed.url, { headers: { "User-Agent": "ALON-NEWS/1.0 editorial desk" }, signal: AbortSignal.timeout(15000) });
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
  }).slice(0, 16);
}
async function writeEdition(candidates) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing.");
  if (candidates.length < 5) throw new Error("Too few game-news leads were available; nothing was published.");
  const prompt = `You are the senior editor of ALON NEWS, a professional independent gaming publication. Select up to 10 genuinely newsworthy VIDEO GAME stories from these verified leads. Reject shopping, preorder, deal, film, TV, generic guide, review, opinion and low-information items. Return ONLY valid JSON: {"articles":[...]}. Every article must include slug, category (one of PC, Console, Mobile, Hardware, Industry, Crypto Gaming), title_en, title_es, dek_en, dek_es, body_en, body_es, source_url, source_name. body_en and body_es must each be an array of exactly 3 polished paragraphs of 45-75 words. Paragraph 1: reported lead with the concrete new fact. Paragraph 2: relevant game or industry context. Paragraph 3: explain why this matters to players or the market, without speculation. Write with precise newsroom language: no filler, no hype, no commands to buy, no phrases such as "has proven popular", "this highlights", "good time to", "should check out", or "worth watching". Never invent a detail missing from the lead. English is the original; Spanish must be a natural editorial translation. Keep other publications out of headlines and body; source_name is only for the source box. Use only the exact URL supplied for source_url.\n\nVERIFIED LEADS:\n${JSON.stringify(candidates)}`;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.OPENAI_API_KEY },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4.1-mini", temperature: 0.18, max_tokens: 6000, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] })
  });
  if (!response.ok) throw new Error("OpenAI request failed: " + response.status + " " + await response.text());
  const payload = await response.json();
  const generated = JSON.parse(payload.choices?.[0]?.message?.content || "{}").articles || [];
  const urls = new Set(candidates.map(x => x.url));
  const valid = generated.filter(x => x && x.slug && urls.has(x.source_url) && Array.isArray(x.body_en) && x.body_en.length === 3 && Array.isArray(x.body_es) && x.body_es.length === 3 && !excluded.test(x.title_en + " " + x.dek_en)).slice(0, 10);
  if (valid.length < 5) throw new Error("Editorial quality check rejected the generated edition.");
  await writeFile("articles.json", JSON.stringify({ generatedAt: new Date().toISOString(), articles: valid }, null, 2) + "\n");
  console.log("Published", valid.length, "edited gaming stories.");
}
await writeEdition(await collect());