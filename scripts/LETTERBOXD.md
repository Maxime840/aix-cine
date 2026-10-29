# Notes et fiches Letterboxd

Le site affiche un seul accès Letterboxd près du titre de chaque film. La note
moyenne est exprimée sur 5 avec deux décimales. Son infobulle indique la date de
collecte et le nombre d'évaluations lorsqu'il est publié. Les fiches et notes non
confirmées proposent une recherche clairement identifiée.

## Collecte

`letterboxd.py` lit uniquement les pages publiques `/film/<slug>/`. Il vérifie
l'identité du film avec l'année et le réalisateur, puis extrait :

1. `aggregateRating.ratingValue` dans le JSON-LD de type `Movie`, avec
   `ratingCount` ou, à défaut, `reviewCount` ;
2. à défaut, les métadonnées Twitter `twitter:labelN = Average rating` et
   `twitter:dataN = <note> out of 5`.

Les pages de recherche ne sont jamais interrogées par le collecteur. Une page
protégée, une erreur réseau, une mauvaise correspondance ou une note invalide
ne fournit aucune nouvelle note. Une note antérieure vérifiée reste disponible
avec sa date réelle et le statut `stale`. Les anciennes notes numériques sans
provenance sont rejetées.

`data/letterboxd_films.json` associe les identifiants du programme aux fiches
candidates. Les redirections canoniques sont suivies, puis l'identité est vérifiée.
Une entrée peut contenir `url` et `director_aliases` pour documenter un nom
différent dans le flux Pathé. Ces exceptions sont propres à un film et ne
modifient pas les informations pratiques affichées.

## Actualisation

Le générateur horaire `fetch_seances.py` appelle automatiquement le collecteur.
Le cache `data/letterboxd_ratings.json` conserve identité, source, dates et note.
Une fiche valide est conservée 24 heures ; un échec est réessayé après 6 heures.
La collecte utilise deux requêtes simultanées au maximum, des délais de 10
secondes et un budget total de 120 secondes.

Pour actualiser uniquement Letterboxd, sans modifier les séances :

```powershell
python scripts/update_letterboxd.py
```

`--offline` applique seulement les données déjà vérifiées en cache. Le JSON du
programme et `data/bundle.js` sont synchronisés par la même commande ; le site
continue à fonctionner en ouverture directe de `index.html`.

## Vérification

Les tests utilisent des réponses locales, sans connexion réseau :

```powershell
python -m unittest discover -s scripts -p test_letterboxd.py -v
```
