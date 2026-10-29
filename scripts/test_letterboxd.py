"""Offline regression tests for public Letterboxd metadata and cache handling."""

from datetime import datetime, timedelta, timezone
from http.client import IncompleteRead
import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError

from letterboxd import (InvalidFilmPage, candidate_urls, canonical_film_url,
                       enrich_films, parse_film_page)


URL = "https://letterboxd.com/film/frankenstein-1931/"
FILM = {"title": "Frankenstein", "year": 1931, "director": "James Whale"}
NOW = datetime(2026, 10, 28, 20, 0, tzinfo=timezone.utc)


def movie(**changes):
    node = {"@context": "https://schema.org", "@type": "Movie", "url": URL,
            "name": "Frankenstein", "dateCreated": "1931-11-19",
            "director": [{"@type": "Person", "name": "James Whale"}],
            "aggregateRating": {"@type": "AggregateRating", "ratingValue": 3.76,
                                "bestRating": 5, "ratingCount": 243890, "reviewCount": 64023}}
    node.update(changes)
    return node


def page(node=None, *, extra="", canonical=URL, wrapped=True, title="Frankenstein (1931)"):
    data = "" if node is None else json.dumps(node, ensure_ascii=False)
    if wrapped and data:
        data = "/* <![CDATA[ */\n" + data + "\n/* ]]> */"
    return (f'<html><head><link rel="canonical" href="{canonical}">'
            f'<meta property="og:title" content="{title}">{extra}'
            f'<script type="application/ld+json">{data}</script></head>'
            '<body><a href="/director/james-whale/">James Whale</a></body></html>')


def record(**changes):
    value = parse_film_page(page(movie()), URL, FILM)
    value.update({"fetched_at": (NOW - timedelta(hours=1)).isoformat(),
                  "checked_at": (NOW - timedelta(hours=1)).isoformat()})
    value.update(changes)
    return value


class MetadataTests(unittest.TestCase):
    def test_live_shape_cdata_and_rating_count_preferred_to_review_count(self):
        result = parse_film_page(page(movie()), URL, FILM)
        self.assertEqual(result["letterboxd_rating"], 3.76)
        self.assertEqual(result["rating_count"], 243890)
        self.assertEqual(result["source"], "json_ld")
        self.assertTrue(result["identity_verified"])

    def test_graph_does_not_use_a_product_or_other_movie_rating(self):
        primary = movie(aggregateRating=None)
        unrelated = movie(url="https://letterboxd.com/film/some-other-film/", aggregateRating={"ratingValue": 4.9})
        graph = {"@graph": [{"@type": "Product", "aggregateRating": {"ratingValue": 4.8}}, unrelated, primary]}
        result = parse_film_page(page(graph), URL, FILM)
        self.assertIsNone(result["letterboxd_rating"])
        self.assertEqual(result["status"], "unrated")

    def test_list_and_full_schema_movie_type(self):
        result = parse_film_page(page([movie(**{"@type": "https://schema.org/Movie"})]), URL, FILM)
        self.assertEqual(result["letterboxd_rating"], 3.76)

    def test_twitter_fallback_requires_matching_average_rating_label(self):
        extra = '<meta name="twitter:label2" content="Average rating"><meta name="twitter:data2" content="4.21 out of 5">'
        result = parse_film_page(page(movie(aggregateRating=None), extra=extra), URL, FILM)
        self.assertEqual(result["letterboxd_rating"], 4.21)
        self.assertEqual(result["source"], "twitter_card")
        result = parse_film_page(page(movie(aggregateRating=None), extra=extra.replace("Average rating", "Popular review")), URL, FILM)
        self.assertIsNone(result["letterboxd_rating"])

    def test_twitter_only_page_has_independent_identity(self):
        extra = '<meta content="3.76 out of 5" name="twitter:data2"><meta content="Average rating" name="twitter:label2">'
        result = parse_film_page(page(extra=extra), URL, FILM)
        self.assertEqual(result["source"], "twitter_card")
        self.assertEqual(result["letterboxd_rating"], 3.76)

    def test_twitter_score_must_include_scale(self):
        for value in ("4.21", "4.21 out of 10", "5.9 out of 5", "NaN out of 5"):
            with self.subTest(value=value):
                extra = f'<meta name="twitter:label2" content="Average rating"><meta name="twitter:data2" content="{value}">'
                result = parse_film_page(page(movie(aggregateRating=None), extra=extra), URL, FILM)
                self.assertIsNone(result["letterboxd_rating"])

    def test_rating_scale_conversion_and_review_count_fallback(self):
        result = parse_film_page(page(movie(aggregateRating={"ratingValue": "8.4", "bestRating": 10, "reviewCount": "1,234"})), URL, FILM)
        self.assertEqual(result["letterboxd_rating"], 4.2)
        self.assertEqual(result["rating_count"], 1234)

    def test_impossible_or_nonfinite_scores_never_become_ratings(self):
        for value in (6, -1, "NaN", "Infinity", True, None):
            with self.subTest(value=value):
                result = parse_film_page(page(movie(aggregateRating={"ratingValue": value, "bestRating": 5})), URL, FILM)
                self.assertIsNone(result["letterboxd_rating"])

    def test_incorrect_director_and_year_are_rejected(self):
        for changed in (movie(director={"name": "Another Director"}), movie(dateCreated="2026-01-01")):
            with self.subTest(changed=changed):
                with self.assertRaises(InvalidFilmPage):
                    parse_film_page(page(changed), URL, FILM)

    def test_french_release_year_tolerance_and_accents(self):
        film = {"title": "Un titre français", "year": 1932, "director": "Jàmes Whâle"}
        self.assertTrue(parse_film_page(page(movie()), URL, film)["identity_verified"])

    def test_same_director_does_not_allow_a_different_film_three_years_later(self):
        future = {"title": "Frankenstein Returns", "year": 1934, "director": "James Whale"}
        with self.assertRaises(InvalidFilmPage):
            parse_film_page(page(movie()), URL, future)

    def test_missing_expected_year_cannot_validate_an_ambiguous_page(self):
        with self.assertRaises(InvalidFilmPage):
            parse_film_page(page(movie(dateCreated=None), title="Frankenstein"), URL, FILM)

    def test_title_fallback_if_director_is_missing(self):
        film = {"title": "Frankenstein", "year": 1931}
        self.assertTrue(parse_film_page(page(movie()), URL, film)["identity_verified"])
        with self.assertRaises(InvalidFilmPage):
            parse_film_page(page(movie()), URL, {"title": "Dracula", "year": 1931})

    def test_captcha_and_malformed_pages_are_safe(self):
        for value in ('<title>Just a moment...</title>', '<html>not a movie</html>', '<script type="application/ld+json">{broken}</script>'):
            with self.subTest(value=value):
                with self.assertRaises(InvalidFilmPage):
                    parse_film_page(value, URL, FILM)

    def test_only_letterboxd_direct_film_canonical_is_accepted(self):
        for bad in ("https://letterboxd.com/search/frankenstein/", "https://letterboxd.com.evil.test/film/frankenstein/",
                    "https://evil.test/film/frankenstein/", "http://letterboxd.com/film/frankenstein/",
                    "https://user:pass@letterboxd.com/film/frankenstein/", "https://letterboxd.com/film/a/reviews/"):
            with self.subTest(url=bad):
                self.assertIsNone(canonical_film_url(bad))
                with self.assertRaises(InvalidFilmPage):
                    parse_film_page(page(movie(), canonical=bad), URL, FILM)
        self.assertEqual(canonical_film_url(URL + "?ref=whatever#rating"), URL)


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.cache = Path(self.temp.name) / "cache.json"
        self.overrides = Path(self.temp.name) / "overrides.json"
        self.overrides.write_text(json.dumps({"film": URL}), encoding="utf-8")

    def enrich(self, cache=None, **kwargs):
        self.cache.write_text(json.dumps(cache or {}), encoding="utf-8")
        films = {"film": dict(FILM)}
        records = enrich_films(films, cache_path=self.cache, overrides_path=self.overrides, now=NOW, **kwargs)
        return films["film"], records["film"]

    def test_legacy_cache_without_provenance_is_not_trusted_offline(self):
        film, cached = self.enrich({"film": {"letterboxd_url": URL, "letterboxd_rating": 4.9}}, refresh=False)
        self.assertFalse(film["letterboxd_verified"])
        self.assertIsNone(film["letterboxd_rating"])
        self.assertIsNone(film["letterboxd_url"])
        self.assertIsNone(cached["source"])

    def test_fresh_verified_cache_avoids_a_request(self):
        film, cached = self.enrich({"film": record()}, fetcher=lambda url: self.fail("must not fetch fresh cache"))
        self.assertEqual(film["letterboxd_rating"], 3.76)
        self.assertTrue(film["letterboxd_verified"])
        self.assertEqual(cached["status"], "ok")

    def test_verified_fallback_is_reused_when_configured_candidate_is_unchanged(self):
        candidate = "https://letterboxd.com/film/frankenstein-incorrect-candidate/"
        self.overrides.write_text(json.dumps({"film": candidate}), encoding="utf-8")
        old = record(requested_url=URL, override_url=candidate)
        film, _ = self.enrich({"film": old}, fetcher=lambda url: self.fail("must reuse verified fallback"))
        self.assertTrue(film["letterboxd_verified"])
        self.assertEqual(film["letterboxd_rating"], 3.76)

    def test_offline_cache_miss_does_not_delay_first_online_refresh(self):
        _, offline = self.enrich(refresh=False)
        film, _ = self.enrich({"film": offline}, fetcher=lambda url: page(movie()))
        self.assertTrue(film["letterboxd_verified"])
        self.assertEqual(film["letterboxd_rating"], 3.76)

    def test_expired_verified_score_is_retained_with_its_real_timestamp_on_failure(self):
        old_stamp = (NOW - timedelta(hours=25)).isoformat()
        old = record(fetched_at=old_stamp, checked_at=old_stamp)
        def fail(url):
            raise TimeoutError("unavailable")
        film, cached = self.enrich({"film": old}, fetcher=fail)
        self.assertEqual(cached["status"], "stale")
        self.assertEqual(film["letterboxd_rating"], 3.76)
        self.assertEqual(film["letterboxd_fetched_at"], old_stamp)
        self.assertTrue(film["letterboxd_verified"])

    def test_wrong_identity_in_cached_entry_never_supplies_a_rating(self):
        film, _ = self.enrich({"film": record(directors=["Another Director"])}, refresh=False)
        self.assertIsNone(film["letterboxd_rating"])
        self.assertFalse(film["letterboxd_verified"])

    def test_successful_refresh_updates_all_public_fields_without_writing_files(self):
        before = self.cache
        film, cached = self.enrich(fetcher=lambda url: (page(movie()), URL))
        self.assertEqual(film["letterboxd_rating"], 3.76)
        self.assertEqual(film["letterboxd_rating_count"], 243890)
        self.assertEqual(film["letterboxd_source"], "json_ld")
        self.assertTrue(film["letterboxd_verified"])
        self.assertEqual(cached["fetched_at"], NOW.isoformat(timespec="seconds"))
        self.assertEqual(json.loads(before.read_text(encoding="utf-8")), {})

    def test_fresh_failures_are_not_retried_for_six_hours(self):
        _, failed = self.enrich(fetcher=lambda url: '<title>Just a moment...</title>')
        film, _ = self.enrich({"film": failed}, fetcher=lambda url: self.fail("must respect failure TTL"))
        self.assertFalse(film["letterboxd_verified"])

    def test_partial_http_reads_do_not_break_programme_enrichment(self):
        def interrupted(url):
            raise IncompleteRead(b"<html>", 500)
        film, cached = self.enrich(fetcher=interrupted)
        self.assertFalse(film["letterboxd_verified"])
        self.assertIsNone(film["letterboxd_rating"])
        self.assertEqual(cached["status"], "unavailable")
        self.assertEqual(cached["error"], "IncompleteRead")

    def test_failed_slug_discovery_respects_ttl_with_an_override(self):
        # The last guessed URL differs from the override; it must not bypass TTL.
        self.enrich(fetcher=lambda url: '<html>not a movie</html>')
        _, failed = self.enrich(fetcher=lambda url: '<html>not a movie</html>')
        self.assertNotEqual(failed["requested_url"], URL)
        _, repeated = self.enrich({"film": failed}, fetcher=lambda url: self.fail("must respect failed override TTL"))
        self.assertEqual(repeated["checked_at"], failed["checked_at"])

    def test_changed_override_bypasses_success_ttl(self):
        other = "https://letterboxd.com/film/frankenstein-alternate/"
        self.overrides.write_text(json.dumps({"film": other}), encoding="utf-8")
        calls = []
        def fetch(url):
            calls.append(url)
            return page(movie(url=other), canonical=other), other
        film, _ = self.enrich({"film": record()}, fetcher=fetch)
        self.assertEqual(calls, [other])
        self.assertEqual(film["letterboxd_url"], other)

    def test_explicit_director_alias_verifies_and_reuses_cache_without_changing_credit(self):
        alias = "James Whale Letterboxd Credit"
        self.overrides.write_text(json.dumps({"film": {"url": URL, "director_aliases": [alias]}}), encoding="utf-8")
        film, cached = self.enrich(fetcher=lambda url: page(movie(director={"name": alias})))
        self.assertTrue(film["letterboxd_verified"])
        self.assertEqual(film["letterboxd_rating"], 3.76)
        self.assertEqual(film["director"], "James Whale")
        self.assertEqual(cached["directors"], [alias])
        film, reused = self.enrich({"film": cached}, fetcher=lambda url: self.fail("verified alias cache must stay fresh"))
        self.assertTrue(film["letterboxd_verified"])
        self.assertEqual(film["director"], "James Whale")
        self.assertEqual(reused["fetched_at"], cached["fetched_at"])

    def test_explicit_alias_does_not_accept_another_wrong_director(self):
        self.overrides.write_text(json.dumps({"film": {"url": URL, "director_aliases": ["Approved Alias"]}}), encoding="utf-8")
        film, cached = self.enrich(fetcher=lambda url: page(movie(director={"name": "An Unrelated Director"})))
        self.assertFalse(film["letterboxd_verified"])
        self.assertIsNone(film["letterboxd_rating"])
        self.assertEqual(cached["error"], "identity_mismatch")

    def test_adding_alias_invalidates_six_hour_failure_cache(self):
        alias = "Another Credit For James Whale"
        _, failed = self.enrich(fetcher=lambda url: page(movie(director={"name": alias})))
        self.overrides.write_text(json.dumps({"film": {"url": URL, "director_aliases": [alias]}}), encoding="utf-8")
        calls = []
        def fetch(url):
            calls.append(url)
            return page(movie(director={"name": alias}))
        film, corrected = self.enrich({"film": failed}, fetcher=fetch)
        self.assertEqual(calls, [URL])
        self.assertTrue(film["letterboxd_verified"])
        self.assertNotEqual(corrected["film_fingerprint"], failed["film_fingerprint"])

    def test_unnecessary_alias_addition_keeps_matching_success_cache_fresh(self):
        self.overrides.write_text(json.dumps({"film": {"url": URL, "director_aliases": ["Unused Alternate Name"]}}), encoding="utf-8")
        film, _ = self.enrich({"film": record()}, fetcher=lambda url: self.fail("original director still matches"))
        self.assertEqual(film["letterboxd_rating"], 3.76)

    def test_removing_an_alias_stops_trusting_an_alias_only_cached_identity(self):
        alias = "Alternate Credit"
        self.overrides.write_text(json.dumps({"film": {"url": URL, "director_aliases": [alias]}}), encoding="utf-8")
        _, cached = self.enrich(fetcher=lambda url: page(movie(director={"name": alias})))
        self.overrides.write_text(json.dumps({"film": URL}), encoding="utf-8")
        film, _ = self.enrich({"film": cached}, refresh=False)
        self.assertFalse(film["letterboxd_verified"])
        self.assertIsNone(film["letterboxd_rating"])

    def test_verified_canonical_redirect_does_not_bypass_success_ttl(self):
        alias = "https://letterboxd.com/film/frankenstein-alias/"
        self.overrides.write_text(json.dumps({"film": alias}), encoding="utf-8")
        old = record(requested_url=alias)
        film, _ = self.enrich({"film": old}, fetcher=lambda url: self.fail("canonical alias should reuse cache"))
        self.assertEqual(film["letterboxd_url"], URL)

    def test_untrusted_redirect_and_access_denial_never_leak_a_score(self):
        film, _ = self.enrich(fetcher=lambda url: (page(movie()), "https://evil.test/film/frankenstein/"))
        self.assertFalse(film["letterboxd_verified"])
        self.assertIsNone(film["letterboxd_rating"])
        calls = []
        def forbidden(url):
            calls.append(url)
            raise HTTPError(url, 403, "Forbidden", {}, None)
        film, _ = self.enrich(fetcher=forbidden)
        self.assertEqual(len(calls), 1)
        self.assertIsNone(film["letterboxd_rating"])

    def test_candidate_discovery_is_bounded_deduplicated_and_never_uses_search(self):
        urls = candidate_urls("frankenstein-12345", FILM,
            {"letterboxd_url": "https://letterboxd.com/search/frankenstein/"}, URL)
        self.assertEqual(urls[0], URL)
        self.assertLessEqual(len(urls), 3)
        self.assertEqual(len(set(urls)), len(urls))
        self.assertTrue(all(canonical_film_url(url) for url in urls))


if __name__ == "__main__":
    unittest.main()
