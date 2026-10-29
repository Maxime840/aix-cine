#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/fetch_seances.py
Génère et met à jour `data/seances.json` et `data/bundle.js` pour les 7 prochains jours à Aix-en-Provence.

- Récupère en direct les séances et liens de paiement (`https://s.pathe.fr/fr/V...S.../booking`) via l'API
  publique pathe.fr (Pathé Plan de Campagne, Le Renoir, Le Mazarin).
- En cas d'échec réseau, réutilise la dernière copie valide (`data/pathe_raw.json`).
- Ajoute la programmation de L'Institut de l'Image (saisie manuelle ci-dessous).
- Exclut les séances déjà passées au moment de l'exécution.

Conçu pour tourner toutes les heures via GitHub Actions (.github/workflows/update-seances.yml).
"""

import html
import json
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
OUTPUT_FILE = DATA_DIR / "seances.json"
RAW_CACHE_FILE = DATA_DIR / "pathe_raw.json"

PARIS = ZoneInfo("Europe/Paris")
NOW = datetime.now(PARIS)
TODAY_DATE = NOW.strftime("%Y-%m-%d")
NOW_HHMM = NOW.strftime("%H:%M")

FR_DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]
FR_MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]
FR_MONTHS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre",
                  "octobre", "novembre", "décembre"]


def build_days(start, count=7):
    days = []
    for i in range(count):
        d = start + timedelta(days=i)
        name = FR_DAYS[d.weekday()]
        days.append({
            "date": d.strftime("%Y-%m-%d"),
            "label": f"{name} {d.day} {FR_MONTHS[d.month - 1]}",
            "short": f"{name[:3]} {d.strftime('%d')}",
            "day_name": name,
            "day_num": d.strftime("%d"),
        })
    return days


DAYS = build_days(NOW)
WEEK_DATES = {d["date"] for d in DAYS}

PATHE_CINEMAS = ["cinema-pathe-plan-de-campagne", "cinema-le-renoir", "cinema-le-mazarin"]
HTTP_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Referer": "https://www.pathe.fr/",
}


def fetch_json(url, retries=2):
    for _ in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=HTTP_HEADERS)
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception:
            continue
    return None


def fetch_live_pathe():
    """Télécharge la programmation Pathé de la semaine. Retourne None si l'API est injoignable."""
    pairs, show_slugs = [], set()
    for c_slug in PATHE_CINEMAS:
        data = fetch_json(f"https://www.pathe.fr/api/cinema/{c_slug}/shows?language=fr")
        if not data or not isinstance(data.get("shows"), dict):
            print(f"ATTENTION: impossible de lire {c_slug}", file=sys.stderr)
            return None
        for s_slug, info in data["shows"].items():
            if set((info or {}).get("days", {}).keys()) & WEEK_DATES:
                pairs.append((c_slug, s_slug))
                show_slugs.add(s_slug)

    with ThreadPoolExecutor(max_workers=8) as ex:
        shows_res = dict(zip(show_slugs, ex.map(
            lambda s: fetch_json(f"https://www.pathe.fr/api/show/{s}?language=fr"), show_slugs)))
        times_res = dict(zip([f"{c}::{s}" for c, s in pairs], ex.map(
            lambda p: fetch_json(f"https://www.pathe.fr/api/show/{p[1]}/showtimes/{p[0]}?language=fr"), pairs)))

    shows = {k: v for k, v in shows_res.items() if v}
    showtimes = {k: v for k, v in times_res.items() if v}
    print(f"API Pathé : {len(shows)}/{len(show_slugs)} films, {len(showtimes)}/{len(pairs)} listes de séances")
    if not showtimes or len(showtimes) < len(pairs) * 0.8:
        return None
    return {"shows": shows, "showtimes": showtimes, "fetched_at": NOW.isoformat(timespec="seconds")}


def is_past(date_str, time_hhmm, reservability_end=None):
    if date_str < TODAY_DATE:
        return True
    if date_str != TODAY_DATE:
        return False
    if reservability_end:
        try:
            return datetime.fromisoformat(reservability_end) <= NOW
        except ValueError:
            pass
    return time_hhmm < NOW_HHMM

CINEMA_SLUG_MAP = {
    "cinema-pathe-plan-de-campagne": "pathe-plan-de-campagne",
    "cinema-le-renoir": "le-renoir",
    "cinema-le-mazarin": "le-mazarin",
}

POSTER_GRADIENTS = [
    "from-indigo-950 via-slate-900 to-emerald-950",
    "from-amber-950 via-stone-900 to-red-950",
    "from-zinc-900 via-neutral-900 to-amber-950",
    "from-rose-950 via-neutral-950 to-purple-950",
    "from-sky-950 via-slate-950 to-indigo-950",
    "from-red-950 via-zinc-950 to-black",
    "from-teal-950 via-cyan-950 to-blue-950",
    "from-violet-950 via-slate-950 to-zinc-950",
]

INSTITUT_FILMS = {
    "frankenstein-1931": {
        "id": "frankenstein-1931",
        "title": "Frankenstein",
        "director": "James Whale",
        "cast": "Boris Karloff, Colin Clive",
        "year": 1931,
        "duration_min": 70,
        "rating": "4.5",
        "genres": ["Fantastique", "Patrimoine"],
        "country": "USA",
        "is_new": False,
        "poster_url": "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=600&q=80",
        "poster_bg": "from-stone-900 via-neutral-950 to-emerald-950",
        "ticket_url": "https://www.institut-image.org/horaires/",
        "synopsis": "Le classique fondateur avec Boris Karloff — Cycle Littérature fantastique à l’écran.",
    },
    "portrait-dorian-gray": {
        "id": "portrait-dorian-gray",
        "title": "Le Portrait de Dorian Gray",
        "director": "Albert Lewin",
        "cast": "Hurd Hatfield, George Sanders, Angela Lansbury",
        "year": 1945,
        "duration_min": 110,
        "rating": "4.3",
        "genres": ["Fantastique", "Patrimoine"],
        "country": "USA",
        "is_new": False,
        "poster_url": "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=600&q=80",
        "poster_bg": "from-amber-950 via-neutral-950 to-zinc-900",
        "ticket_url": "https://www.institut-image.org/horaires/",
        "synopsis": "D’après Oscar Wilde : un jeune dandy conserve sa jeunesse tandis que son portrait vieillit à sa place.",
    },
    "chambre-des-tortures": {
        "id": "chambre-des-tortures",
        "title": "La Chambre des tortures",
        "director": "Roger Corman",
        "cast": "Vincent Price, Barbara Steele",
        "year": 1961,
        "duration_min": 80,
        "rating": "4.1",
        "genres": ["Fantastique", "Patrimoine"],
        "country": "USA",
        "is_new": False,
        "poster_url": "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=600&q=80",
        "poster_bg": "from-purple-950 via-red-950 to-black",
        "ticket_url": "https://www.institut-image.org/horaires/",
        "synopsis": "Vincent Price dans le chef-d’œuvre gothique de Roger Corman adapté d’Edgar Allan Poe.",
    },
    "les-innocents-1961": {
        "id": "les-innocents-1961",
        "title": "Les Innocents (The Innocents)",
        "director": "Jack Clayton",
        "cast": "Deborah Kerr, Michael Redgrave",
        "year": 1961,
        "duration_min": 100,
        "rating": "4.6",
        "genres": ["Fantastique", "Patrimoine"],
        "country": "Royaume-Uni",
        "is_new": False,
        "poster_url": "https://images.unsplash.com/photo-1505843513577-22bb7d21e455?auto=format&fit=crop&w=600&q=80",
        "poster_bg": "from-zinc-900 via-slate-950 to-black",
        "ticket_url": "https://www.institut-image.org/horaires/",
        "synopsis": "Adaptation magistrale du Tour d’écrou d’Henry James avec Deborah Kerr, dialoguée par Truman Capote.",
    },
    "stand-by-me": {
        "id": "stand-by-me",
        "title": "Stand by Me",
        "director": "Rob Reiner",
        "cast": "River Phoenix, Wil Wheaton, Corey Feldman",
        "year": 1986,
        "duration_min": 89,
        "rating": "4.6",
        "genres": ["Aventure", "Drame"],
        "country": "USA",
        "is_new": False,
        "poster_url": "https://images.unsplash.com/photo-1474487548417-781cb71495f3?auto=format&fit=crop&w=600&q=80",
        "poster_bg": "from-amber-950 via-emerald-950 to-slate-950",
        "ticket_url": "https://www.institut-image.org/horaires/",
        "synopsis": "Cycle Stephen King : quatre adolescents partent le long des voies ferrées à la recherche du corps d’un enfant disparu.",
    },
    "entretien-vampire": {
        "id": "entretien-vampire",
        "title": "Entretien avec un vampire",
        "director": "Neil Jordan",
        "cast": "Brad Pitt, Tom Cruise, Kirsten Dunst",
        "year": 1994,
        "duration_min": 123,
        "rating": "4.2",
        "genres": ["Fantastique", "Drame"],
        "country": "USA",
        "is_new": False,
        "poster_url": "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=600&q=80",
        "poster_bg": "from-red-950 via-slate-950 to-indigo-950",
        "ticket_url": "https://www.institut-image.org/horaires/",
        "synopsis": "D’après Anne Rice : le récit de deux siècles d’immortalité par Louis de Pointe du Lac.",
    },
    "jekyll-hyde-1941": {
        "id": "jekyll-hyde-1941",
        "title": "Docteur Jekyll et Mister Hyde",
        "director": "Victor Fleming",
        "cast": "Spencer Tracy, Ingrid Bergman, Lana Turner",
        "year": 1941,
        "duration_min": 113,
        "rating": "4.1",
        "genres": ["Fantastique", "Patrimoine"],
        "country": "USA",
        "is_new": False,
        "poster_url": "https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0?auto=format&fit=crop&w=600&q=80",
        "poster_bg": "from-neutral-900 via-stone-950 to-amber-950",
        "ticket_url": "https://www.institut-image.org/horaires/",
        "synopsis": "Spencer Tracy et Ingrid Bergman dans la grande adaptation hollywoodienne du roman de Stevenson.",
    },
    "christine-1983": {
        "id": "christine-1983",
        "title": "Christine",
        "director": "John Carpenter",
        "cast": "Keith Gordon, John Stockwell",
        "year": 1983,
        "duration_min": 110,
        "rating": "4.2",
        "genres": ["Fantastique", "Horreur"],
        "country": "USA",
        "is_new": False,
        "poster_url": "https://images.unsplash.com/photo-1583121274602-3e2820c69888?auto=format&fit=crop&w=600&q=80",
        "poster_bg": "from-red-900 via-rose-950 to-black",
        "ticket_url": "https://www.institut-image.org/horaires/",
        "synopsis": "Cycle Stephen King : une Plymouth Fury 1958 rouge sang dotée d’une volonté meurtrière.",
    },
    "shining-1980": {
        "id": "shining-1980",
        "title": "Shining",
        "director": "Stanley Kubrick",
        "cast": "Jack Nicholson, Shelley Duvall",
        "year": 1980,
        "duration_min": 144,
        "rating": "4.8",
        "genres": ["Horreur", "Chef-d’œuvre"],
        "country": "USA / Royaume-Uni",
        "is_new": False,
        "poster_url": "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=600&q=80",
        "poster_bg": "from-amber-900 via-red-950 to-black",
        "ticket_url": "https://www.institut-image.org/horaires/",
        "synopsis": "Cycle Stephen King : Jack Torrance devient gardien d’hiver de l’hôtel Overlook avec sa femme et son fils Danny.",
    },
    "carrie-1976": {
        "id": "carrie-1976",
        "title": "Carrie au bal du diable",
        "director": "Brian De Palma",
        "cast": "Sissy Spacek, Piper Laurie, John Travolta",
        "year": 1976,
        "duration_min": 98,
        "rating": "4.5",
        "genres": ["Horreur", "Fantastique"],
        "country": "USA",
        "is_new": False,
        "poster_url": "https://images.unsplash.com/photo-1516549655169-df83a0774514?auto=format&fit=crop&w=600&q=80",
        "poster_bg": "from-rose-900 via-red-950 to-zinc-950",
        "ticket_url": "https://www.institut-image.org/horaires/",
        "synopsis": "Cycle Stephen King : la vengeance télékinésique de Carrie White lors du bal de promo.",
    },
    "creepshow-1982": {
        "id": "creepshow-1982",
        "title": "Creepshow",
        "director": "George A. Romero",
        "cast": "Hal Holbrook, Leslie Nielsen, Stephen King",
        "year": 1982,
        "duration_min": 120,
        "rating": "4.0",
        "genres": ["Horreur", "Comédie noire"],
        "country": "USA",
        "is_new": False,
        "poster_url": "https://images.unsplash.com/photo-1509248961158-e54f6934749c?auto=format&fit=crop&w=600&q=80",
        "poster_bg": "from-purple-900 via-indigo-950 to-black",
        "ticket_url": "https://www.institut-image.org/horaires/",
        "synopsis": "Soirée Halloween — Cinq histoires macabres écrites par Stephen King et réalisées par George A. Romero.",
    },
    "simetierre-1989": {
        "id": "simetierre-1989",
        "title": "Simetierre (Pet Sematary)",
        "director": "Mary Lambert",
        "cast": "Dale Midkiff, Fred Gwynne",
        "year": 1989,
        "duration_min": 103,
        "rating": "3.8",
        "genres": ["Horreur"],
        "country": "USA",
        "is_new": False,
        "poster_url": "https://images.unsplash.com/photo-1509114397022-ed747cca3f65?auto=format&fit=crop&w=600&q=80",
        "poster_bg": "from-slate-900 via-emerald-950 to-black",
        "ticket_url": "https://www.institut-image.org/horaires/",
        "synopsis": "Soirée Halloween — Un ancien cimetière indien possède le pouvoir de ramener les morts à la vie.",
    },
    "doctor-sleep-2019": {
        "id": "doctor-sleep-2019",
        "title": "Doctor Sleep",
        "director": "Mike Flanagan",
        "cast": "Ewan McGregor, Rebecca Ferguson",
        "year": 2019,
        "duration_min": 152,
        "rating": "4.1",
        "genres": ["Fantastique", "Thriller"],
        "country": "USA",
        "is_new": False,
        "poster_url": "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=600&q=80",
        "poster_bg": "from-indigo-950 via-purple-950 to-black",
        "ticket_url": "https://www.institut-image.org/horaires/",
        "synopsis": "Cycle Stephen King : des décennies après l’Overlook, Danny Torrance protège une adolescente dotée du Shining.",
    },
}


def clean_text(val):
    if not val:
        return ""
    text = re.sub(r"<br\s*/?>", " ", str(val), flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_salle(auditorium_name):
    if not auditorium_name:
        return "1"
    val = str(auditorium_name).strip().upper()
    if val == "IMAX":
        return "18"
    if val == "4DX":
        return "8"
    digits = "".join(ch for ch in val if ch.isdigit())
    return digits if digits else "1"


def extract_note_and_price(cinema_id, salle, tags):
    tags_lower = {str(t).lower() for t in (tags or [])}
    if "imax" in tags_lower or salle == "18":
        return "IMAX Laser", 19.20
    if "4dx" in tags_lower or salle == "8":
        return "4DX", 19.20
    if "dolby-atmos" in tags_lower or (cinema_id == "pathe-plan-de-campagne" and salle == "1"):
        return "Dolby Atmos", 16.20
    if "avp" in tags_lower:
        return "Avant-première", (15.20 if cinema_id == "pathe-plan-de-campagne" else 13.50)
    if "seancespeciale" in tags_lower:
        return "Séance spéciale", (15.20 if cinema_id == "pathe-plan-de-campagne" else 13.50)
    return None, (15.20 if cinema_id == "pathe-plan-de-campagne" else 13.50)


def compute_seats_remaining(session_key, total_seats, api_status, date_str, time_hhmm, tags):
    """
    L'API publique Pathé ne fournit pas le nombre de places libres, seulement le statut
    (`available` / `soldout`). On expose donc uniquement « places disponibles » ou « complet ».
    """
    if str(api_status).lower() == "soldout":
        return None, "soldout"
    return None, "available"


def build_from_real_pathe_data():
    raw = None if "--offline" in sys.argv else fetch_live_pathe()
    if raw:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        RAW_CACHE_FILE.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    elif RAW_CACHE_FILE.exists():
        print("API Pathé indisponible : utilisation de la dernière copie data/pathe_raw.json", file=sys.stderr)
        raw = json.loads(RAW_CACHE_FILE.read_text(encoding="utf-8"))
    else:
        raise SystemExit("Aucune donnée Pathé disponible (API injoignable et pas de cache).")

    raw_shows = raw.get("shows", {})
    raw_showtimes = raw.get("showtimes", {})

    films = {}
    showtimes = []

    # 1. Parcourir toutes les vraies séances Pathé / Renoir / Mazarin
    for pair_key, days_dict in raw_showtimes.items():
        if not isinstance(days_dict, dict):
            continue
        c_slug, s_slug = pair_key.split("::")
        cinema_id = CINEMA_SLUG_MAP.get(c_slug)
        if not cinema_id:
            continue

        s_meta = raw_shows.get(s_slug, {})
        for date_str, s_list in days_dict.items():
            if date_str not in WEEK_DATES or not isinstance(s_list, list):
                continue

            for idx, s_obj in enumerate(s_list):
                raw_time = s_obj.get("time", "")  # "2026-10-28 19:30:00"
                time_hhmm = raw_time.split(" ")[1][:5] if " " in raw_time else raw_time[:5]
                raw_end = s_obj.get("endTime", "")
                end_hhmm = raw_end.split(" ")[1][:5] if " " in raw_end else ""

                # Exclure les séances déjà passées (évite l'erreur Pathé "Cette séance n'existe pas")
                if is_past(date_str, time_hhmm, s_obj.get("reservabilityEnd")):
                    continue

                salle = normalize_salle(s_obj.get("auditoriumName"))
                ver_raw = str(s_obj.get("version", "vf")).lower()
                version = "VOST" if "vost" in ver_raw or "vo" in ver_raw else "VF"

                ref_cmd = s_obj.get("refCmd") or f"https://www.pathe.fr/films/{s_slug}"
                note, price = extract_note_and_price(cinema_id, salle, s_obj.get("tags"))

                cap = int(s_obj["auditoriumCapacity"]) if str(s_obj.get("auditoriumCapacity", "")).isdigit() else 150
                session_id = f"{cinema_id}-{date_str}-{salle}-{time_hhmm}-{s_slug[:12]}-{idx}"
                seats_rem, avail_status = compute_seats_remaining(
                    session_id, cap, s_obj.get("status", "available"), date_str, time_hhmm, s_obj.get("tags")
                )

                showtimes.append({
                    "id": session_id,
                    "cinema_id": cinema_id,
                    "date": date_str,
                    "time": time_hhmm,
                    "end_time": end_hhmm,
                    "reservability_end": s_obj.get("reservabilityEnd"),
                    "film_id": s_slug,
                    "salle": salle,
                    "seats_override": cap,
                    "seats_total": cap,
                    "seats_remaining": seats_rem,
                    "availability_status": avail_status,
                    "pathe_status": s_obj.get("status", "available"),
                    "version": version,
                    "note": note,
                    "price_full": price,
                    "booking_url": ref_cmd,
                    "film_payment_url": ref_cmd,
                })

                if s_slug not in films:
                    local_poster = ROOT_DIR / "posters" / f"{s_slug}.jpg"
                    p_dict = s_meta.get("posterPath") or {}
                    remote_poster = (p_dict.get("md") or p_dict.get("lg")) if isinstance(p_dict, dict) else p_dict
                    poster_url = f"posters/{s_slug}.jpg" if local_poster.exists() else remote_poster

                    rel_date = s_meta.get("releaseAt")
                    if isinstance(rel_date, dict):
                        rel_str = str(rel_date.get("FR_FR") or "2026")
                    else:
                        rel_str = str(rel_date or "2026")
                    year = int(rel_str[:4]) if rel_str[:4].isdigit() else 2026

                    films[s_slug] = {
                        "id": s_slug,
                        "title": clean_text(s_meta.get("title") or s_slug),
                        "director": clean_text(s_meta.get("directors") or "Cinéma"),
                        "cast": clean_text(s_meta.get("actors") or ""),
                        "year": year,
                        "duration_min": s_meta.get("duration") or 110,
                        "rating": None,
                        "genres": s_meta.get("genres") or ["Cinéma"],
                        "country": clean_text(s_meta.get("nationality") or ""),
                        "is_new": bool(s_meta.get("isNew")),
                        "poster_url": poster_url,
                        "poster_remote_url": remote_poster,
                        "poster_bg": POSTER_GRADIENTS[len(films) % len(POSTER_GRADIENTS)],
                        "ticket_url": ref_cmd,
                        "pathe_film_url": f"https://www.pathe.fr/films/{s_slug}",
                        "synopsis": clean_text(s_meta.get("synopsis") or ""),
                    }

    # 2. Ajouter L'Institut de l'Image (séances à venir de la semaine)
    for fid, fdata in INSTITUT_FILMS.items():
        films[fid] = fdata

    institut_official = [
        {"date": "2026-10-29", "time": "14:00", "film_id": "frankenstein-1931", "version": "VOST", "note": "Cycle Fantastique"},
        {"date": "2026-10-29", "time": "15:45", "film_id": "portrait-dorian-gray", "version": "VOST", "note": "Cycle Fantastique"},
        {"date": "2026-10-29", "time": "18:00", "film_id": "chambre-des-tortures", "version": "VOST", "note": "Cycle Fantastique"},
        {"date": "2026-10-29", "time": "20:30", "film_id": "les-innocents-1961", "version": "VOST", "note": "Présenté par Maxime Iffour"},
        {"date": "2026-10-30", "time": "14:00", "film_id": "stand-by-me", "version": "VOST", "note": "Cycle Stephen King"},
        {"date": "2026-10-30", "time": "16:00", "film_id": "entretien-vampire", "version": "VOST", "note": "Cycle Fantastique"},
        {"date": "2026-10-30", "time": "18:20", "film_id": "jekyll-hyde-1941", "version": "VOST", "note": "Cycle Fantastique"},
        {"date": "2026-10-30", "time": "20:30", "film_id": "christine-1983", "version": "VOST", "note": "Cycle Stephen King"},
        {"date": "2026-10-31", "time": "14:30", "film_id": "shining-1980", "version": "VOST", "note": "Cycle Stephen King"},
        {"date": "2026-10-31", "time": "17:15", "film_id": "carrie-1976", "version": "VOST", "note": "Cycle Stephen King"},
        {"date": "2026-10-31", "time": "19:30", "film_id": "creepshow-1982", "version": "VOST", "note": "Soirée Halloween"},
        {"date": "2026-10-31", "time": "22:15", "film_id": "simetierre-1989", "version": "VOST", "note": "Soirée Halloween"},
        {"date": "2026-11-01", "time": "14:30", "film_id": "les-innocents-1961", "version": "VOST", "note": "Cycle Fantastique"},
        {"date": "2026-11-01", "time": "16:40", "film_id": "doctor-sleep-2019", "version": "VOST", "note": "Cycle Stephen King"},
        {"date": "2026-11-03", "time": "18:00", "film_id": "stand-by-me", "version": "VOST", "note": "Cycle Stephen King"},
        {"date": "2026-11-03", "time": "20:15", "film_id": "shining-1980", "version": "VOST", "note": "Cycle Stephen King"},
    ]
    for item in institut_official:
        if item["date"] not in WEEK_DATES or is_past(item["date"], item["time"]):
            continue
        sid = f"institut-{item['date']}-{item['time']}"
        rem, st_label = compute_seats_remaining(sid, 156, "available", item["date"], item["time"], [])
        showtimes.append({
            "id": sid,
            "cinema_id": "institut-de-l-image",
            "date": item["date"],
            "time": item["time"],
            "film_id": item["film_id"],
            "salle": "armand-lunel",
            "seats_override": 156,
            "seats_total": 156,
            "seats_remaining": rem,
            "availability_status": st_label,
            "pathe_status": "available",
            "version": item["version"],
            "note": item["note"],
            "price_full": item.get("price", 8.00),
            "booking_url": "https://www.institut-image.org/horaires/",
            "film_payment_url": "https://www.institut-image.org/infos-pratiques/tarifs/",
        })

    return films, showtimes


def main():
    films, seances = build_from_real_pathe_data()
    # Ne garder que les films qui ont encore au moins une séance
    used = {s["film_id"] for s in seances}
    films = {k: v for k, v in films.items() if k in used}

    # Notes collectées dans les métadonnées des fiches directes, avec identité,
    # provenance et date vérifiées. Le cache évite de solliciter Letterboxd à chaque heure.
    try:
        from .letterboxd import enrich_films
    except ImportError:
        from letterboxd import enrich_films
    lb_cache_file = DATA_DIR / "letterboxd_ratings.json"
    lb_cache = enrich_films(films, refresh="--offline" not in sys.argv, cache_path=lb_cache_file)
    lb_cache_file.write_text(json.dumps(lb_cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    first, last = NOW, NOW + timedelta(days=len(DAYS) - 1)
    payload = {
        "week_label": (f"Du {FR_DAYS[first.weekday()].lower()} {first.day} {FR_MONTHS_LONG[first.month - 1]} "
                       f"au {FR_DAYS[last.weekday()].lower()} {last.day} {FR_MONTHS_LONG[last.month - 1]} {last.year}"),
        "updated_at": NOW.isoformat(timespec="seconds"),
        "days": DAYS,
        "films": films,
        "seances": seances,
    }
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    salles_file = ROOT_DIR / "data" / "salles.json"
    if salles_file.exists():
        salles_data = json.loads(salles_file.read_text(encoding="utf-8"))
        bundle_file = ROOT_DIR / "data" / "bundle.js"
        bundle_content = (
            "// Fichier généré automatiquement par scripts/fetch_seances.py\n"
            "window.__AIX_CINE_DATA__ = "
            + json.dumps({"salles": salles_data, "seances": payload}, ensure_ascii=False)
            + ";\n"
        )
        bundle_file.write_text(bundle_content, encoding="utf-8")

    print(f"OK: {len(films)} films et {len(seances)} seances ecrits dans {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
