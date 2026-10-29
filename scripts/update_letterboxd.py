#!/usr/bin/env python3
"""Actualise les notes Letterboxd sans modifier la programmation des séances."""
import argparse
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile

try:
    from .letterboxd import enrich_films
except ImportError:
    from letterboxd import enrich_films

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def write_atomic(path, text):
    with NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(text)
        temporary = handle.name
    try:
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="Utiliser seulement les métadonnées déjà vérifiées en cache")
    args = parser.parse_args()
    source = DATA / "seances.json"
    program = json.loads(source.read_text(encoding="utf-8"))
    original = {fid: (film.get("title"), film.get("year"), film.get("director")) for fid, film in program["films"].items()}
    cache_path = DATA / "letterboxd_ratings.json"
    cache = enrich_films(program["films"], refresh=not args.offline, cache_path=cache_path)

    # Une mise à jour des séances peut avoir eu lieu pendant la collecte.
    # On fusionne seulement les champs Letterboxd des films dont l'identité est restée identique.
    latest = json.loads(source.read_text(encoding="utf-8"))
    for fid, film in latest["films"].items():
        identity = (film.get("title"), film.get("year"), film.get("director"))
        if fid not in original or identity != original[fid]:
            continue
        for key in list(film):
            if key.startswith("letterboxd_"):
                del film[key]
        film.update({key: value for key, value in program["films"][fid].items() if key.startswith("letterboxd_")})

    write_atomic(cache_path, json.dumps(cache, ensure_ascii=False, indent=2) + "\n")
    write_atomic(source, json.dumps(latest, ensure_ascii=False, indent=2) + "\n")
    salles = json.loads((DATA / "salles.json").read_text(encoding="utf-8"))
    write_atomic(DATA / "bundle.js", "// Fichier généré automatiquement par scripts/fetch_seances.py\nwindow.__AIX_CINE_DATA__ = " +
                 json.dumps({"salles": salles, "seances": latest}, ensure_ascii=False) + ";\n")
    verified = [film for film in latest["films"].values() if film.get("letterboxd_verified")]
    rated = [film for film in verified if film.get("letterboxd_rating") is not None]
    print(f"Letterboxd : {len(verified)} fiches vérifiées, {len(rated)} notes pour {len(latest['films'])} films.")


if __name__ == "__main__":
    main()
