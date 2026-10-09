# 🎾 Super Padel

Jeu de padel 3D aux personnages mignons, inspiré de *Virtua Tennis* et *Smash Court Tennis*.
Solo contre l'IA (5 niveaux) ou jusqu'à **4 joueurs en ligne** : les places libres sont prises par l'IA.

- Toutes les règles du padel : service à la cuillère en diagonale, faute de grillage au service, let,
  double faute, rebonds sur les vitres, vitre directe, double rebond, balle qui revient, *por 3 / por 4*,
  balle qui touche un joueur, tie-break, point d'or ou avantages, rotation des serveurs.
- Coups : Liftado, Cortado, Globo, plus Remate (smash), Bandeja et Víbora sur les balles hautes,
  volées, amorties (cortado + bas). Puissance en maintenant le bouton, visée avec la direction.
- Bruitages synthétisés en WebAudio (raquette, sol, vitres, grillage, filet, public), aucune musique.
- Clavier (QWERTY/AZERTY), manette, écran tactile.

## Jouer en local

```bash
npm install
npm run dev          # wrangler dev : le jeu + le relais multijoueur sur http://localhost:8787
```

Ou, pour le solo uniquement : `npm run serve` puis http://localhost:8080.

## Déployer sur Cloudflare (jeu + relais multijoueur)

Le Worker (`worker/index.js`) sert le dossier `public/` et héberge le relais : chaque salle
est un Durable Object (stockage SQLite, compatible avec le plan gratuit) qui fait suivre
les messages WebSocket entre les joueurs.

```bash
npm install
npx wrangler login     # ouvre le navigateur pour autoriser ton compte Cloudflare
npx wrangler deploy    # publie sur https://superpadel.<ton-sous-domaine>.workers.dev
```

Ensuite : ouvre l'URL, *Multijoueur en ligne* → *Créer une salle*, et envoie le code
(ou le lien) à tes amis. Le champ « Serveur relais » est prérempli avec l'adresse du site.

Si tu héberges les fichiers du jeu ailleurs (GitHub Pages…), indique l'adresse du Worker
dans ce champ, ou ajoute `?server=https://superpadel.xxx.workers.dev` à l'URL.

### Coût

Sur le plan gratuit, les Durable Objects ont 100 000 requêtes par jour et Cloudflare compte
20 messages WebSocket entrants pour 1 requête. L'hôte envoie 30 instantanés/s et chaque
client 20 entrées/s : un match à 4 consomme environ 5 000 requêtes par heure, soit
plusieurs heures de jeu par jour gratuitement.

## Architecture

| Fichier | Rôle |
| --- | --- |
| `public/js/core/physics.js` | Balle : gravité, traînée, effet Magnus, rebonds sol/vitres/grillage/filet |
| `public/js/core/rules.js` | Score (jeux, sets, tie-break, point d'or) et arbitrage de l'échange |
| `public/js/core/shots.js` | Calcul des coups (types, visée, erreurs) |
| `public/js/core/ai.js` | IA : lecture de trajectoire, placement, choix tactique, 5 niveaux |
| `public/js/core/sim.js` | Simulation complète d'un match (tourne aussi dans Node) |
| `public/js/core/client.js` | Prédiction côté client en ligne |
| `public/js/render/*` | Rendu Three.js : personnages, piste, tribunes, effets |
| `public/js/audio.js` | Bruitages synthétisés |
| `worker/index.js` | Worker Cloudflare + Durable Object `Room` (relais) |

En ligne, l'hôte (créateur de la salle) fait tourner la simulation et l'IA ; chaque client
prédit sa balle et son joueur localement et a autorité sur ses propres frappes, ce qui
garde le jeu fluide malgré la latence.

## Tests

```bash
node tools/simtest.mjs 2 3     # 3 matchs IA contre IA, niveau Confirmé
node tools/humantest.mjs 2     # un "humain" scripté contre l'IA
node tools/nettest.mjs 0.08    # hôte + client avec 80 ms de latence simulée
```
