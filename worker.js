// Cloudflare Worker : reçoit le bilan d'un élève et l'ajoute en une ligne à resultats.txt
// dans un dépôt GitHub PRIVÉ. Variables à définir dans Cloudflare :
//   GH_TOKEN       (secret)  jeton GitHub "fine-grained", limité au dépôt privé, droit Contents : Read and write
//   REPO           ex. "ton-compte/resultats-prives"
//   ALLOWED_ORIGIN ex. "https://ton-compte.github.io"   (l'adresse de ton site, sans / final)
//   FILE           (facultatif) nom du fichier, "resultats.txt" par défaut
const dec = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, '')), c => c.charCodeAt(0)));
const enc = t => { let s = ''; new TextEncoder().encode(t).forEach(b => s += String.fromCharCode(b)); return btoa(s); };
const clean = s => String(s || '').replace(/[\r\n|]+/g, ' ').trim().slice(0, 60);
const num = x => Number(x) || 0;

export default {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
    if (env.ALLOWED_ORIGIN && req.headers.get('Origin') !== env.ALLOWED_ORIGIN)
      return new Response('Forbidden', { status: 403, headers: cors });

    let d;
    try { d = await req.json(); } catch { return new Response('Bad JSON', { status: 400, headers: cors }); }
    if (!d.nom || !d.prenom || !d.classe) return new Response('Missing fields', { status: 400, headers: cors });

    const line = [
      new Date().toISOString().slice(0, 16).replace('T', ' '),
      clean(d.classe),
      clean(d.nom).toUpperCase() + ' ' + clean(d.prenom),
      `${num(d.pct)} % (${num(d.ok)}/${num(d.tot)})`,
      (Array.isArray(d.missions) ? d.missions.slice(0, 5) : [])
        .map((m, i) => `M${i + 1}: ${num(m.a)} tent., meilleur ${num(m.best)}/${num(m.n)}, ${num(m.pct)} %`).join(' ; ')
    ].join(' | ');

    const url = `https://api.github.com/repos/${env.REPO}/contents/${env.FILE || 'resultats.txt'}`;
    const H = { Authorization: `Bearer ${env.GH_TOKEN}`, 'User-Agent': 'mission-pole-nord', Accept: 'application/vnd.github+json' };

    for (let i = 0; i < 4; i++) { // réessaie si deux élèves envoient en même temps
      const g = await fetch(url, { headers: H });
      let sha, old = '';
      if (g.ok) { const j = await g.json(); sha = j.sha; old = dec(j.content); }
      else if (g.status !== 404) break;
      const p = await fetch(url, {
        method: 'PUT', headers: H,
        body: JSON.stringify({ message: 'Nouveau bilan', content: enc(old + line + '\n'), sha })
      });
      if (p.ok) return new Response('ok', { headers: cors });
      if (p.status !== 409 && p.status !== 422) break;
    }
    return new Response('error', { status: 502, headers: cors });
  }
};
