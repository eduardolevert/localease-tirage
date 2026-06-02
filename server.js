const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_FILE      = path.join(__dirname, 'participants.json');
const WINNERS_FILE = path.join(__dirname, 'winners.json');
const LOTS_FILE    = path.join(__dirname, 'lots.json');

function loadParticipants() {
  if (!fs.existsSync(DB_FILE)) return [];
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveParticipants(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}
function loadWinners() {
  if (!fs.existsSync(WINNERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(WINNERS_FILE, 'utf8'));
}
function saveWinners(data) {
  fs.writeFileSync(WINNERS_FILE, JSON.stringify(data, null, 2));
}
function loadLots() {
  if (!fs.existsSync(LOTS_FILE)) return [];
  return JSON.parse(fs.readFileSync(LOTS_FILE, 'utf8'));
}
function saveLots(data) {
  fs.writeFileSync(LOTS_FILE, JSON.stringify(data, null, 2));
}

// ── S'inscrire ──────────────────────────────────────────────────
app.post('/api/register', (req, res) => {
  const { nom, email } = req.body;
  if (!nom || !email) return res.status(400).json({ error: 'Nom et email requis' });

  const email_clean = email.trim().toLowerCase();
  const nom_clean   = nom.trim();

  const participants = loadParticipants();
  if (participants.find(p => p.email === email_clean)) {
    return res.status(409).json({ error: 'Vous êtes déjà inscrit !' });
  }

  const participant = {
    id: Date.now().toString(),
    nom: nom_clean,
    email: email_clean,
    inscrit_le: new Date().toISOString()
  };
  participants.push(participant);
  saveParticipants(participants);

  const winners = loadWinners();
  const winner  = winners.find(w => w.email === email_clean);
  res.json({ success: true, participant, isWinner: !!winner, lot: winner ? winner.lot : null });
});

// ── Vérifier si tirage effectué (public) ────────────────────────
app.get('/api/status/check-tirage', (req, res) => {
  const winners = loadWinners();
  res.json({ tirageEffectue: winners.length > 0 });
});

// ── Statut participant ──────────────────────────────────────────
app.get('/api/status/:email', (req, res) => {
  const email       = req.params.email.toLowerCase();
  const participants = loadParticipants();
  const participant  = participants.find(p => p.email === email);
  if (!participant) return res.status(404).json({ error: 'Non inscrit' });

  const winners = loadWinners();
  const winner  = winners.find(w => w.email === email);

  res.json({
    participant,
    isWinner:       !!winner,
    lot:            winner ? winner.lot : null,
    tirageEffectue: winners.length > 0
  });
});

// ── Lancer le tirage ────────────────────────────────────────────
app.post('/api/tirage', (req, res) => {
  const { adminKey } = req.body;
  if (adminKey !== (process.env.ADMIN_KEY || 'localease2026')) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  const participants = loadParticipants();
  if (participants.length < 1) return res.status(400).json({ error: 'Aucun participant' });

  const lots = loadLots();
  if (lots.length === 0) return res.status(400).json({ error: 'Aucun lot configuré. Ajoutez des lots avant de lancer le tirage.' });

  const nbWinners = lots.length;
  const shuffled  = [...participants].sort(() => Math.random() - 0.5);
  const drawn     = shuffled.slice(0, Math.min(nbWinners, participants.length));

  // Mélanger les lots et les attribuer
  const shuffledLots = [...lots].sort(() => Math.random() - 0.5);
  const winners = drawn.map((p, i) => ({
    ...p,
    lot: shuffledLots[i] || null
  }));

  saveWinners(winners);
  res.json({ success: true, winners, total: participants.length });
});

// ── Lots publics (page inscription) ────────────────────────────
app.get('/api/lots', (req, res) => {
  res.json({ lots: loadLots() });
});

// ── Lots — lecture admin ────────────────────────────────────────
app.get('/api/admin/lots', (req, res) => {
  const { key } = req.query;
  if (key !== (process.env.ADMIN_KEY || 'localease2026')) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  res.json({ lots: loadLots() });
});

// ── Lots — sauvegarde ───────────────────────────────────────────
app.post('/api/admin/lots', (req, res) => {
  const { adminKey, lots } = req.body;
  if (adminKey !== (process.env.ADMIN_KEY || 'localease2026')) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  if (!Array.isArray(lots)) return res.status(400).json({ error: 'Format invalide' });
  const clean = lots
    .filter(l => l.titre && l.titre.trim())
    .map((l, i) => ({ id: i + 1, titre: l.titre.trim(), description: (l.description || '').trim() }));
  saveLots(clean);
  res.json({ success: true, lots: clean });
});

// ── Export participants CSV ──────────────────────────────────────
app.get('/api/admin/export', (req, res) => {
  const { key } = req.query;
  if (key !== (process.env.ADMIN_KEY || 'localease2026')) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  const participants = loadParticipants();
  const winners      = loadWinners();
  const winnerMap    = new Map(winners.map(w => [w.email, w]));

  const esc = v => `"${(v || '').replace(/"/g, '""')}"`;

  const header = 'Prénom et Nom;Email;Date inscription;Statut;Lot gagné;Description lot\r\n';
  const rows = participants.map(p => {
    const winner = winnerMap.get(p.email);
    const date   = new Date(p.inscrit_le).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    const statut = winner ? 'Gagnant' : 'Participant';
    const lot    = winner && winner.lot ? winner.lot.titre : '';
    const desc   = winner && winner.lot && winner.lot.description ? winner.lot.description : '';
    return [esc(p.nom), esc(p.email), esc(date), esc(statut), esc(lot), esc(desc)].join(';');
  }).join('\r\n');

  const BOM      = '\uFEFF'; // UTF-8 BOM pour Excel
  const filename = `EFD2026_inscrits_${new Date().toISOString().slice(0,10)}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(BOM + header + rows);
});


app.get('/api/admin/stats', (req, res) => {
  const { key } = req.query;
  if (key !== (process.env.ADMIN_KEY || 'localease2026')) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  const participants = loadParticipants();
  const winners      = loadWinners();
  const lots         = loadLots();
  res.json({ participants, winners, lots, total: participants.length, tirageEffectue: winners.length > 0 });
});

// ── Reset ────────────────────────────────────────────────────────
app.post('/api/admin/reset', (req, res) => {
  const { adminKey } = req.body;
  if (adminKey !== (process.env.ADMIN_KEY || 'localease2026')) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  saveParticipants([]);
  saveWinners([]);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur démarré sur http://localhost:${PORT}`));
