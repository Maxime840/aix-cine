# AGENT.md — Aix-Ciné (inspiré de paris-cine.info)

## 1. Vision & Objectif du Projet
Créer un site web ultra-simple, rapide, sans publicité et sans fioritures (dans l'esprit de **paris-cine.info**) qui recense toutes les séances de cinéma de la semaine pour **Aix-en-Provence et ses alentours**.

L'objectif est d'aller droit à l'essentiel pour choisir sa séance dans les meilleures conditions de projection :
- Voir la **liste des séances de la semaine par cinéma** (et filtrer par jour, film, VO/VF).
- Connaître pour chaque séance **le numéro/nom de la salle**, **la taille de l'écran (en mètres)**, **le nombre de fauteuils** et **la technologie** (IMAX Laser, Dolby Atmos, 4DX, 35mm).

---

## 2. Stack Technique Retenue

Pour garantir un site aussi rapide et léger que `paris-cine.info`, facile à maintenir et hébergeable gratuitement :

- **Frontend (Site Statique)** :
  - **HTML5 + CSS3 natif (design dense, sombre/clair, ultra-lisible) + JavaScript Vanilla (ES Modules)**.
  - Aucun framework lourd requis : chargement instantané (`< 50 ms`), fonctionne directement dans le navigateur ou via un simple serveur local.
- **Stockage des données (`data/`)** :
  - Fichiers JSON statiques consommés directement par le front-end :
    - `data/salles.json` : Référentiel technique complet des 33 salles des 5 cinémas (fauteuils, dimensions d'écran en mètres, technologies).
    - `data/seances.json` : Programme complet des séances de la semaine (films, horaires, versions VOST/VF, salle attribuée, lien billetterie).
- **Collecte des séances (`scripts/`)** :
  - **Python 3** via `scripts/fetch_seances.py` (zéro dépendance externe) :
    - Génère `data/seances.json` ainsi que `data/bundle.js` (qui permet d'ouvrir `index.html` directement en double-cliquant dessus en local sans erreur CORS).
    - Centralise la programmation hebdomadaire pour **Le Renoir**, **Le Mazarin**, **Le Cézanne**, **Pathé Plan de Campagne** et **L'Institut de l'Image**.
- **Hébergement & Automatisation** :
  - Hébergement statique gratuit (**GitHub Pages** ou **Cloudflare Pages**).
  - **GitHub Actions** (`.github/workflows/update-seances.yml`) exécuté automatiquement chaque jour pour rafraîchir `data/seances.json`.

---

## 3. Référentiel Complet des 5 Cinémas et de leurs Salles

> **Note sur les tailles d'écran** : Les dimensions marquées *(officiel)* proviennent des fiches techniques publiques des exploitants. Les dimensions marquées *(estimé)* sont calculées à partir de la jauge/superficie officielle de chaque salle selon les ratios standards SMPTE/CST, et sont identifiées par `"screen_estimated": true` dans `salles.json`.

### 1. Le Renoir *(24 Cours Mirabeau, Aix-en-Provence)*
- **Réseau** : Les Cinémas Aixois / Pathé (`cinema-le-renoir`) — *Art & Essai*
- **3 salles (430 fauteuils)** :

| Salle | Fauteuils | Taille d'écran (Base × Haut.) | Catégorie | Technologies / Notes |
| :--- | :---: | :---: | :---: | :--- |
| **Salle 1** | 212 pl. | ~10,0 m × 4,2 m *(estimé)* | Moyen + | Numérique 2K, Son 7.1 |
| **Salle 2** | 138 pl. | ~8,0 m × 3,4 m *(estimé)* | Moyen | Numérique 2K, Son 5.1 |
| **Salle 3** | 80 pl. | ~6,0 m × 2,6 m *(estimé)* | Intime | Numérique 2K, Boucle magnétique |

### 2. Le Mazarin *(6 rue Laroque, Aix-en-Provence)*
- **Réseau** : Les Cinémas Aixois / Pathé (`cinema-le-mazarin`) — *Art & Essai*
- **3 salles (393 fauteuils)** :

| Salle | Fauteuils | Taille d'écran (Base × Haut.) | Catégorie | Technologies / Notes |
| :--- | :---: | :---: | :---: | :--- |
| **Salle 1** | 174 pl. | ~9,0 m × 3,8 m *(estimé)* | Moyen | Numérique 2K, PMR, Twavox |
| **Salle 2** | 64 pl. | ~5,5 m × 2,4 m *(estimé)* | Intime | Petite salle, Numérique 2K, PMR |
| **Salle 3** | 155 pl. | ~8,5 m × 3,6 m *(estimé)* | Moyen | Numérique 2K, PMR, Twavox |

### 3. Le Cézanne *(1 rue Marcel Guillaume, Aix-en-Provence)*
- **Réseau** : Les Cinémas Aixois / Pathé (`cinema-le-cezanne`)
- **Statut** : *Actuellement fermé pour reconstruction complète (réouverture prévue en 2028)*. Conservé dans la base pour affichage informatif et réactivation automatique.
- **9 salles historiques (1 539 fauteuils)** :

| Salle | Fauteuils | Taille d'écran (Base × Haut.) | Catégorie | Technologies / Notes |
| :--- | :---: | :---: | :---: | :--- |
| **Salle 1** | 442 pl. | ~14,0 m × 5,0 m *(70 m² officiel)* | Grand | 4K, HFR, Son 7.1 / THX |
| **Salle 2** | 244 pl. | ~11,0 m × 4,6 m *(estimé)* | Moyen + | 2K, HFR, Son 7.1 |
| **Salle 3** | 278 pl. | ~11,5 m × 4,8 m *(estimé)* | Moyen + | 2K, Son 7.1, PMR |
| **Salle 4** | 108 pl. | ~7,5 m × 3,2 m *(estimé)* | Moyen | 2K, PMR |
| **Salle 5** | 70 pl. | ~6,0 m × 2,5 m *(estimé)* | Intime | 2K, PMR |
| **Salle 6** | 105 pl. | ~7,5 m × 3,2 m *(estimé)* | Moyen | 2K |
| **Salle 7** | 110 pl. | ~7,5 m × 3,2 m *(estimé)* | Moyen | 2K |
| **Salle 8** | 104 pl. | ~7,5 m × 3,2 m *(estimé)* | Moyen | 2K |
| **Salle 9** | 78 pl. | ~6,2 m × 2,6 m *(estimé)* | Intime | 2K |

### 4. Pathé Plan de Campagne *(Zone Commerciale Plan de Campagne, Les Pennes-Mirabeau)*
- **Réseau** : Pathé (`cinema-pathe-plan-de-campagne`)
- **17 salles actives numérotées de 1 à 6 et de 8 à 18 (~3 453 fauteuils)** *(la Salle 7 n'existe plus suite aux réaménagements IMAX)* :

| Salle | Fauteuils | Taille d'écran (Base × Haut.) | Catégorie | Technologies / Notes |
| :--- | :---: | :---: | :---: | :--- |
| **Salle 18 (IMAX)** | 308 pl. | **25,0 m × 15,0 m** *(officiel)* | Géant (IMAX) | **IMAX Laser**, écran incurvé 375 m² |
| **Salle 2** | 472 pl. | ~20,0 m × 8,5 m *(estimé)* | Très Grand | Plus grande salle (510 m²), Dolby 7.1 |
| **Salle 1** | 368 pl. | **17,0 m × 7,2 m** *(officiel)* | Très Grand | **Dolby Atmos / Pathé+**, 4K (450 m²) |
| **Salle 3** | 332 pl. | ~15,5 m × 6,5 m *(estimé)* | Grand | Projection 4K / Dolby 7.1 |
| **Salle 10** | 323 pl. | ~15,0 m × 6,3 m *(estimé)* | Grand | Projection 2K/4K, Dolby 7.1 |
| **Salle 4** | 278 pl. | ~14,0 m × 5,9 m *(estimé)* | Grand | Numérique 2K/4K, Dolby 7.1 |
| **Salle 5** | 258 pl. | ~13,5 m × 5,7 m *(estimé)* | Grand | Numérique 2K/4K, Dolby 7.1 |
| **Salle 9** | 192 pl. | ~11,5 m × 4,8 m *(estimé)* | Moyen + | Numérique 2K, Son 7.1 |
| **Salle 16** | 137 pl. | ~9,5 m × 4,0 m *(estimé)* | Moyen | Numérique 2K, Son 7.1 |
| **Salle 17** | 137 pl. | ~9,5 m × 4,0 m *(estimé)* | Moyen | Numérique 2K, Son 7.1 |
| **Salle 13** | 129 pl. | ~9,2 m × 3,9 m *(estimé)* | Moyen | Numérique 2K, Son 7.1 |
| **Salle 11** | 122 pl. | ~9,0 m × 3,8 m *(estimé)* | Moyen | Numérique 2K, Son 7.1 |
| **Salle 14** | 113 pl. | ~8,5 m × 3,6 m *(estimé)* | Moyen | Numérique 2K, Son 7.1 |
| **Salle 15** | 113 pl. | ~8,5 m × 3,6 m *(estimé)* | Moyen | Numérique 2K, Son 7.1 |
| **Salle 12** | 105 pl. | ~8,2 m × 3,5 m *(estimé)* | Moyen | Numérique 2K, Son 7.1 |
| **Salle 8 (4DX)** | 104 pl. | ~9,0 m × 3,8 m *(estimé)* | Spécial (4DX) | **4DX** (sièges mobiles et effets) |
| **Salle 6** | 91 pl. | ~7,5 m × 3,2 m *(estimé)* | Intime | Numérique 2K |

### 5. L'Institut de l'Image *(Cité du Livre — 8/10 rue des Allumettes, Aix-en-Provence)*
- **Réseau** : Indépendant / Associatif (`institut-image.org`) — *Patrimoine & Répertoire*
- **1 salle unique (156 fauteuils)** :

| Salle | Fauteuils | Taille d'écran (Base × Haut.) | Catégorie | Technologies / Notes |
| :--- | :---: | :---: | :---: | :--- |
| **Salle Armand Lunel** | 156 pl. | **7,0 m × 3,0 m** *(officiel)* | Moyen | **35 mm** + Numérique 2K, Dolby SR/SRD |

---

## 4. Structure du Projet

```text
cinema-aix-en-provence/
├── AGENT.md                  # Spécifications, stack et référentiel des salles
├── index.html                # Page unique ultra-rapide (style paris-cine.info)
├── style.css                 # Styles minimalistes (badges salles/écrans, responsive, dark/light)
├── app.js                    # Logique d'affichage, filtres (jour, cinéma, VO/VF, taille d'écran)
├── data/
│   ├── salles.json           # Base statique des 5 cinémas et des 33 salles (fauteuils, écrans)
│   ├── seances.json          # Séances de la semaine (généré par le script)
│   └── bundle.js             # Bundle JS auto-généré pour ouverture directe (file://) sans serveur
└── scripts/
    └── fetch_seances.py      # Script Python de génération/mise à jour des séances de la semaine
```

---

## 5. Expérience Utilisateur & Design (Style `paris-cine.info`)

1. **Barre de filtres fixe en haut** :
   - **Sélecteur de jour** : Mercredi → Mardi (7 jours de la semaine cinéma) avec bouton rapide *Aujourd'hui* / *Ce soir*.
   - **Filtre Cinémas** : Tout voir | Centre-ville (Renoir + Mazarin) | Le Renoir | Le Mazarin | Pathé Plan de Campagne | Institut de l'Image.
   - **Filtre Version & Écran** : `Toutes versions` / `VOST uniquement` | `Tous écrans` / `Grands écrans (≥ 14m)` / `IMAX`.
   - **Recherche rapide** : Filtrer par titre de film ou réalisateur.
2. **Affichage par Cinéma (ou par Film)** :
   - Chaque séance est affichée sous forme de **carte-horaire compacte** indiquant immédiatement :
     - **L'heure** (ex. `20:30`)
     - **La version** (`VOST` ou `VF`)
     - **La salle** (ex. `Salle 1`, `Salle IMAX`)
     - **La taille de l'écran et la capacité** avec un code couleur visuel :
       - Badge **Écran Géant / IMAX** (ex. `25m • 308 pl.`)
       - Badge **Grand Écran** (ex. `17m • 368 pl.`)
       - Badge **Écran Moyen / Intime** (ex. `9m • 174 pl.`)
3. **Conventions de code** :
   - Zéro dépendance externe inutile côté client.
   - Code clair, modulaire, en français pour le métier.
