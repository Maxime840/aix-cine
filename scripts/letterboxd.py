"""Read public Letterboxd film metadata without a browser or third-party packages.

``enrich_films`` updates the supplied film dictionaries in place and RETURNS the
new cache mapping. It never writes files: the programme generator owns saving
the cache and its usual JSON/bundle outputs. Old, undocumented numeric ratings
are discovery hints only, never trusted ratings.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from html import unescape
from html.parser import HTMLParser
from http.client import HTTPException
import json
import math
from pathlib import Path
import re
import time
import unicodedata
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CACHE = ROOT / "data" / "letterboxd_ratings.json"
DEFAULT_OVERRIDES = ROOT / "data" / "letterboxd_films.json"
SOURCES = {"json_ld", "twitter_card"}
SUCCESS_TTL = timedelta(hours=24)
FAILURE_TTL = timedelta(hours=6)
MAX_CANDIDATES = 3
NETWORK_TIMEOUT = 10
RUN_BUDGET_SECONDS = 120


class InvalidFilmPage(ValueError):
    """The response is not a public film page matching the requested film."""


def normalize(value):
    text = unescape(str(value or "")).replace("œ", "oe").replace("Œ", "OE").replace("æ", "ae").replace("Æ", "AE")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    return " ".join(re.findall(r"[a-z0-9]+", text.casefold()))


def slugify(value):
    return normalize(value).replace(" ", "-")


def canonical_film_url(value):
    """Return a strict, HTTPS, canonical film URL, or None for non-film URLs."""
    try:
        url = urlsplit(str(value or ""))
        if (url.scheme != "https" or url.hostname not in {"letterboxd.com", "www.letterboxd.com"}
                or url.username or url.password or url.port not in (None, 443)):
            return None
        match = re.fullmatch(r"/film/([a-z0-9][a-z0-9-]*)/?", url.path)
        return f"https://letterboxd.com/film/{match[1]}/" if match else None
    except (ValueError, TypeError):
        return None


class _Metadata(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta = {}
        self.canonical = None
        self.scripts = []
        self.directors = []
        self._script = None
        self._director = None

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == "meta":
            name = str(attrs.get("name") or attrs.get("property") or attrs.get("itemprop") or "").lower()
            self.meta[name] = attrs.get("content", "")
        elif tag == "link" and "canonical" in str(attrs.get("rel", "")).lower().split():
            self.canonical = attrs.get("href")
        elif tag == "script" and str(attrs.get("type", "")).lower().split(";")[0] == "application/ld+json":
            self._script = []
        elif tag == "a" and str(attrs.get("href", "")).startswith("/director/"):
            self._director = []

    def handle_data(self, data):
        if self._script is not None:
            self._script.append(data)
        if self._director is not None:
            self._director.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self._script is not None:
            self.scripts.append("".join(self._script))
            self._script = None
        if tag == "a" and self._director is not None:
            name = "".join(self._director).strip()
            if name:
                self.directors.append(name)
            self._director = None


def _json_payload(text):
    text = text.strip()
    for prefix in ("/* <![CDATA[ */", "<![CDATA[", "<!--", "// <![CDATA[", "//<![CDATA["):
        if text.startswith(prefix):
            text = text[len(prefix):].strip()
            break
    for suffix in ("/* ]]> */", "]]>", "-->", "// ]]>", "//]]>"):
        if text.endswith(suffix):
            text = text[:-len(suffix)].strip()
            break
    return json.loads(text)


def _nodes(value):
    if isinstance(value, list):
        for item in value:
            yield from _nodes(item)
    elif isinstance(value, dict):
        yield value
        for key in ("@graph", "mainEntity"):
            if key in value:
                yield from _nodes(value[key])


def _is_movie(node):
    types = node.get("@type", [])
    types = [types] if isinstance(types, str) else types
    return isinstance(types, list) and any(str(kind).rstrip("/").rsplit("/", 1)[-1] == "Movie" for kind in types)


def _names(value):
    if isinstance(value, list):
        return [name for item in value for name in _names(item)]
    if isinstance(value, dict):
        return _names(value.get("name"))
    return [unescape(value).strip()] if isinstance(value, str) and value.strip() else []


def _year(value):
    match = re.search(r"\b(18\d{2}|19\d{2}|20\d{2}|21\d{2})\b", str(value or ""))
    return int(match[0]) if match else None


def _director_names(film):
    value = film.get("director") or film.get("directors") or []
    names = _names(value)
    return [name.strip() for whole in names for name in re.split(r"\s*(?:,|/|&|;|\bet\b|\band\b)\s*", whole)
            if normalize(name) not in {"", "nc", "n c", "inconnu", "realisateur inconnu"}]


def _same_identity(film, title, year, directors, aliases=()):
    expected_year = _year(film.get("year"))
    if expected_year and (not year or abs(expected_year - year) > 1):
        return False
    expected_directors = {normalize(name) for name in _director_names(film)}
    actual_directors = {normalize(name) for name in directors}
    if expected_directors and actual_directors:
        return bool(expected_directors & actual_directors)
    expected_title = normalize(film.get("title"))
    titles = [normalize(name) for name in [title, *aliases] if name]
    return bool(expected_title and any(expected_title == name or
        SequenceMatcher(None, expected_title, name).ratio() >= .88 for name in titles))


def _rating(value, best=5):
    if isinstance(value, bool) or isinstance(best, bool):
        return None
    try:
        value = float(str(value).replace(",", "."))
        best = float(best)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(value) or not math.isfinite(best) or best <= 0 or value < 0 or value > best:
        return None
    return round(value * 5 / best, 3)


def _count(value):
    if isinstance(value, bool):
        return None
    try:
        parsed = float(str(value).replace(",", "").replace(" ", ""))
        return int(parsed) if math.isfinite(parsed) and parsed >= 0 and parsed.is_integer() else None
    except (ValueError, TypeError, OverflowError):
        return None


def parse_film_page(page_html, requested_url, film):
    """Parse and validate a direct film page; return metadata without timestamps.

    JSON-LD is preferred. A Twitter Card score is used only when its matching
    ``twitter:labelN`` says Average rating and the corresponding dataN contains
    an explicit score out of 5. Film identity is validated independently.
    """
    requested = canonical_film_url(requested_url)
    if not requested:
        raise InvalidFilmPage("not_a_film_url")
    if not isinstance(page_html, str) or not page_html.strip():
        raise InvalidFilmPage("empty_page")
    if re.search(r"<title[^>]*>\s*(?:Just a moment|Attention Required|Access denied)", page_html, re.I):
        raise InvalidFilmPage("access_challenge")
    parser = _Metadata()
    parser.feed(page_html)
    canonical = canonical_film_url(urljoin(requested, parser.canonical)) if parser.canonical else requested
    if not canonical:
        raise InvalidFilmPage("invalid_canonical")
    movie_nodes = []
    for script in parser.scripts:
        try:
            movie_nodes.extend(node for node in _nodes(_json_payload(script)) if _is_movie(node))
        except (ValueError, TypeError):
            continue
    # Do not accidentally extract a score from a related Movie in an @graph.
    movie_nodes = [node for node in movie_nodes if not (node.get("url") or node.get("@id")) or
                   canonical_film_url(node.get("url") or node.get("@id")) == canonical]
    node = movie_nodes[0] if movie_nodes else {}
    og_title = parser.meta.get("og:title") or parser.meta.get("twitter:title") or ""
    title = str(node.get("name") or re.sub(r"\s*\(\d{4}\).*", "", og_title)).strip()
    year = _year(node.get("datePublished") or node.get("dateCreated") or og_title)
    directors = list(dict.fromkeys(_names(node.get("director")) or parser.directors))
    aliases = _names(node.get("alternateName"))
    if not title or not _same_identity(film, title, year, directors, aliases):
        raise InvalidFilmPage("identity_mismatch")

    rating = None
    rating_count = None
    source = "json_ld" if node else "twitter_card"
    aggregate = node.get("aggregateRating")
    if isinstance(aggregate, dict):
        rating = _rating(aggregate.get("ratingValue"), aggregate.get("bestRating", 5))
        rating_count = _count(aggregate.get("ratingCount", aggregate.get("reviewCount")))
    if rating is None:
        for name, label in parser.meta.items():
            match = re.fullmatch(r"twitter:label(\d+)", name)
            if match and normalize(label) == "average rating":
                value = parser.meta.get(f"twitter:data{match[1]}", "")
                score = re.fullmatch(r"\s*(\d+(?:[.,]\d+)?)\s+out\s+of\s+5\s*", value, re.I)
                if score:
                    rating = _rating(score[1])
                    if rating is not None:
                        source = "twitter_card"
                        break
    return {
        "letterboxd_url": canonical,
        "letterboxd_rating": rating,
        "rating_count": rating_count if rating is not None else None,
        "source": source,
        "title": title,
        "year": year,
        "directors": directors,
        "aliases": aliases,
        "identity_verified": True,
        "status": "ok" if rating is not None else "unrated",
    }


class _FilmRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not canonical_film_url(newurl):
            raise InvalidFilmPage("redirect_not_a_film")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_page(url):
    """Fetch one public page with a fixed timeout and no challenge bypass."""
    request = Request(url, headers={"User-Agent": "Aix-Cine.info/1.0 (film metadata)", "Accept": "text/html"})
    with build_opener(_FilmRedirect()).open(request, timeout=NETWORK_TIMEOUT) as response:
        final_url = canonical_film_url(response.geturl())
        if not final_url:
            raise InvalidFilmPage("redirect_not_a_film")
        body = response.read(4 * 1024 * 1024 + 1)
        if len(body) > 4 * 1024 * 1024:
            raise InvalidFilmPage("page_too_large")
        return body.decode(response.headers.get_content_charset() or "utf-8", errors="replace"), final_url


def _utc(value=None):
    if value is None:
        return datetime.now(timezone.utc)
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _time(value):
    try:
        return _utc(value) if value else None
    except (ValueError, TypeError, AttributeError):
        return None


def _load_mapping(path):
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def _url_value(value):
    if isinstance(value, dict):
        value = value.get("letterboxd_url") or value.get("url")
    return canonical_film_url(value)


def candidate_urls(fid, film, cached=None, override=None):
    """Ordered, deduplicated public film URLs; no search-page requests."""
    cached = cached if isinstance(cached, dict) else {}
    year = _year(film.get("year"))
    title_slug = slugify(film.get("title"))
    id_slug = slugify(re.sub(r"-\d{4,}$", "", str(fid)))
    values = [_url_value(override), _url_value(cached), _url_value(film.get("letterboxd_url"))]
    for slug in dict.fromkeys([title_slug, id_slug]):
        if slug:
            if year and not slug.endswith(f"-{year}"):
                values.append(f"https://letterboxd.com/film/{slug}-{year}/")
            values.append(f"https://letterboxd.com/film/{slug}/")
    return list(dict.fromkeys(url for url in values if url))[:MAX_CANDIDATES]


def _trusted(record, film):
    if not isinstance(record, dict) or record.get("identity_verified") is not True or record.get("source") not in SOURCES:
        return False
    if not canonical_film_url(record.get("letterboxd_url")) or not _time(record.get("fetched_at")):
        return False
    rating = record.get("letterboxd_rating")
    if rating is not None and (_rating(rating) is None or isinstance(rating, bool)):
        return False
    return _same_identity(film, record.get("title"), _year(record.get("year")),
                          _names(record.get("directors")), _names(record.get("aliases")))


def _fingerprint(film):
    return "|".join([normalize(film.get("title")), str(film.get("year") or ""),
                     ",".join(sorted(normalize(name) for name in _director_names(film)))])


def _identity_film(film, override):
    """Use only explicitly configured per-film director aliases for matching.

    This copy never changes the public director credit from the cinema source.
    Aliases participate in the normal identity fingerprint and cache checks.
    """
    identity = dict(film)
    aliases = override.get("director_aliases") if isinstance(override, dict) else None
    if isinstance(aliases, list):
        aliases = [name.strip() for name in aliases if isinstance(name, str) and normalize(name)]
        identity["director"] = list(dict.fromkeys([*_director_names(film), *aliases]))
    return identity


def _apply(film, record, identity_film=None):
    verified = _trusted(record, identity_film if identity_film is not None else film)
    film.update({
        "letterboxd_url": record.get("letterboxd_url") if verified else None,
        "letterboxd_rating": record.get("letterboxd_rating") if verified else None,
        "letterboxd_rating_count": record.get("rating_count") if verified else None,
        "letterboxd_fetched_at": record.get("fetched_at") if verified else None,
        "letterboxd_source": record.get("source") if verified else None,
        "letterboxd_status": record.get("status", "unverified"),
        "letterboxd_verified": verified,
    })


def enrich_films(films, *, refresh=True, cache_path=DEFAULT_CACHE,
                 overrides_path=DEFAULT_OVERRIDES, now=None, fetcher=None):
    """Enrich ``films`` IN PLACE and return a new ``fid -> cache record`` mapping.

    All film fields are prefixed ``letterboxd_``: url, rating, rating_count,
    fetched_at, source, status, verified. Records use ``letterboxd_url`` and
    ``letterboxd_rating``, plus rating_count, fetched_at, checked_at, source,
    title, year, directors, aliases, identity_verified, status, film_fingerprint.

    Verified metadata is cached 24h; failed/stale attempts are retried after 6h.
    A failed refresh preserves a previously verified score with ``status=stale``
    and its ORIGINAL fetched_at. A legacy score without provenance is discarded.
    ``refresh=False`` never makes a network request. ``fetcher(url)`` can return
    HTML, ``(HTML, final_url)``, or ``{'html': HTML, 'url': final_url}`` for tests.
    The default collector uses two workers, at most three candidate URLs per
    film, 10s HTTP timeouts and a 120s overall refresh budget.

    Overrides can be direct URL strings or ``{'url': URL,
    'director_aliases': ['Name as credited on Letterboxd']}``. Director aliases
    are explicit, per-film identity exceptions, not fuzzy/global name matches.
    They do not change the visible film director. Adding/removing an alias
    invalidates a cached failure's fingerprint without invalidating a still
    matching, verified 24-hour cache entry.
    """
    current = _utc(now)
    timestamp = current.isoformat(timespec="seconds")
    cache = _load_mapping(cache_path)
    overrides = _load_mapping(overrides_path)
    identity_films = {fid: _identity_film(film, overrides.get(fid)) for fid, film in films.items()}
    download = fetcher or fetch_page
    deadline = time.monotonic() + RUN_BUDGET_SECONDS

    def update(item):
        fid, film = item
        identity_film = identity_films[fid]
        old = cache.get(fid) or {}
        old = old if isinstance(old, dict) else {}
        override = _url_value(overrides.get(fid))
        trusted = _trusted(old, identity_film) and (not override or override in {
            old.get("letterboxd_url"), old.get("requested_url"), old.get("override_url")})
        checked = _time(old.get("checked_at") or old.get("fetched_at"))
        age = current - checked if checked else None
        retry_status = old.get("status") not in {"ok", "unrated"}
        fresh = age is not None and timedelta(0) <= age < (FAILURE_TTL if retry_status else SUCCESS_TTL)
        if trusted and (not refresh or fresh):
            result = dict(old)
            if not fresh and result.get("status") == "ok":
                result["status"] = "stale"
            return fid, result
        if (not trusted and fresh and old.get("identity_verified") is False
                and old.get("error") != "offline"
                and old.get("film_fingerprint") == _fingerprint(identity_film)
                and override == old.get("override_url")):
            return fid, dict(old)

        error = "offline" if not refresh else "not_found"
        requested = None
        if refresh:
            for requested in candidate_urls(fid, film, old, overrides.get(fid)):
                if time.monotonic() > deadline:
                    error = "refresh_budget_exhausted"
                    break
                try:
                    response = download(requested)
                    if isinstance(response, tuple):
                        page_html, final_url = response
                    elif isinstance(response, dict):
                        page_html, final_url = response.get("html"), response.get("url", requested)
                    else:
                        page_html, final_url = response, requested
                    final_url = canonical_film_url(final_url)
                    if not final_url:
                        raise InvalidFilmPage("redirect_not_a_film")
                    result = parse_film_page(page_html, final_url, identity_film)
                    result.update({"fetched_at": timestamp, "checked_at": timestamp,
                                   "film_fingerprint": _fingerprint(identity_film), "requested_url": requested,
                                   "override_url": override})
                    return fid, result
                except HTTPError as exc:
                    error = f"http_{exc.code}"
                    # Do not amplify a rate limit or access challenge with slug retries.
                    if exc.code in (401, 403, 429) or exc.code >= 500:
                        break
                except InvalidFilmPage as exc:
                    error = str(exc)
                    if error == "access_challenge":
                        break
                except (OSError, HTTPException, ValueError, TypeError, UnicodeError) as exc:
                    error = type(exc).__name__
                    break
        if trusted:
            result = dict(old)
            result.update({"status": "stale", "checked_at": timestamp, "error": error})
            return fid, result
        return fid, {"letterboxd_url": None, "letterboxd_rating": None, "rating_count": None,
                     "fetched_at": None, "checked_at": timestamp, "source": None,
                     "title": film.get("title"), "year": _year(film.get("year")),
                     "directors": _director_names(identity_film), "identity_verified": False,
                     "status": "unverified" if not refresh else "unavailable" if error != "not_found" else "not_found",
                     "film_fingerprint": _fingerprint(identity_film), "requested_url": requested,
                     "override_url": override, "error": error}

    with ThreadPoolExecutor(max_workers=2) as executor:
        records = dict(executor.map(update, films.items()))
    for fid, film in films.items():
        _apply(film, records[fid], identity_films[fid])
    return records
