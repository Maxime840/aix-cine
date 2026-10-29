/** Aix-Ciné.info — programmation, salles, places restantes et billetteries officielles. */
(function () {
  'use strict';

  const { useEffect, useMemo, useRef, useState } = React;
  const h = React.createElement;
  const data = window.__AIX_CINE_DATA__ || {};
  const cinemas = (data.salles || {}).cinemas || [];
  const program = data.seances || {};
  const days = program.days || [];
  const films = program.films || {};
  const rawSessions = program.seances || [];
  const cinemasById = Object.fromEntries(cinemas.map((cinema) => [cinema.id, cinema]));
  const daysByDate = Object.fromEntries(days.map((day) => [day.date, day]));
  const roomCount = cinemas.reduce((total, cinema) => total + Object.keys(cinema.salles || {}).length, 0);
  const external = { target: '_blank', rel: 'noopener noreferrer' };

  function Icon({ name, className = 'icon' }) {
    const paths = {
      film: ['M4 3h16v18H4z', 'M8 3v18M16 3v18M4 8h4M16 8h4M4 16h4M16 16h4'],
      search: ['M21 21l-5-5', 'M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'],
      filters: ['M4 7h16M4 17h16M8 4v6M16 14v6'],
      close: ['M6 6l12 12M6 18L18 6'],
      chevron: ['M6 9l6 6 6-6'],
      arrow: ['M7 17 17 7M7 7h10v10'],
      screen: ['M3 4h18v13H3zM8 21h8M12 17v4'],
      pin: ['M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0', 'M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
      ticket: ['M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4zM14 5v3M14 11v2M14 16v3'],
      star: ['m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z']
    };
    return h('svg', { className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
      (paths[name] || paths.film).map((d, index) => h('path', { key: index, d })));
  }

  function parisNow() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Paris',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      date: `${values.year}-${values.month}-${values.day}`,
      time: `${values.hour === '24' ? '00' : values.hour}:${values.minute}`
    };
  }

  const nowParis = parisNow();
  const today = nowParis.date;

  // Exclut automatiquement toute séance dont l'horaire de réservation est dépassé aujourd'hui
  function isSessionExpired(session) {
    if (!session || !session.date) return false;
    // Si la date du programme correspond à aujourd'hui, on filtre les séances déjà passées
    if (days.some((d) => d.date === today)) {
      if (session.date < today) return true;
      if (session.date === today) {
        if (session.reservability_end) {
          const endMs = Date.parse(session.reservability_end);
          if (!Number.isNaN(endMs) && endMs <= Date.now()) return true;
        }
        const [sh, sm] = String(session.time || '00:00').split(':').map(Number);
        const [nh, nm] = String(nowParis.time || '00:00').split(':').map(Number);
        if (sh * 60 + sm + 15 < nh * 60 + nm) return true;
      }
    }
    return false;
  }

  const sessions = rawSessions.filter((s) => !isSessionExpired(s) && films[s.film_id]);
  const defaultDay = days.some((day) => day.date === today && sessions.some((s) => s.date === today))
    ? today
    : (days[0] || {}).date || 'all';

  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const number = (value) => Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  const plural = (count, word) => `${count} ${word}${count > 1 ? 's' : ''}`;
  const isClosed = (cinema) => cinema.status === 'closed_works';
  const roomFor = (session) => ((cinemasById[session.cinema_id] || {}).salles || {})[session.salle];
  const roomName = (room) => String(room.name || `Salle ${room.number}`).replace(/\(\s*\/\s*/g, '(');

  // Pathé ne publie pas le nombre de places libres : seulement « disponible » ou « complet ».
  function getSeatsInfo(session) {
    const room = roomFor(session);
    const total = Number(session.seats_total || session.seats_override || (room && room.seats) || 0);
    const soldout = session.availability_status === 'soldout' || session.pathe_status === 'soldout';
    return { total, status: soldout ? 'soldout' : 'available' };
  }

  function nextBookableSession(list) {
    if (!list || !list.length) return null;
    return list.find((s) => getSeatsInfo(s).status !== 'soldout') || list[0];
  }

  function dimensions(room) {
    if (!room || !room.screen_width_m || !room.screen_height_m) return 'Dimensions N/C';
    return `${room.screen_estimated ? '~' : ''}${number(room.screen_width_m)} × ${number(room.screen_height_m)} m`;
  }
  function duration(minutes) {
    return minutes ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}` : '';
  }
  function endTime(time, minutes) {
    if (!time || !minutes) return '';
    const [hours, mins] = time.split(':').map(Number);
    const end = hours * 60 + mins + minutes;
    return `${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
  }
  const SCREEN_MAX_M = 25;
  function screenTier(room) {
    if (!room || !room.screen_width_m) return null;
    const byCategory = {
      small: { key: 'small', label: 'Écran intime' },
      medium: { key: 'medium', label: 'Écran moyen' },
      'medium-plus': { key: 'medium-plus', label: 'Bel écran' },
      large: { key: 'large', label: 'Grand écran' },
      xlarge: { key: 'xlarge', label: 'Très grand écran' },
      imax: { key: 'imax', label: 'IMAX' }
    };
    if (byCategory[room.size_category]) return byCategory[room.size_category];
    const width = room.screen_width_m;
    if (width >= 20) return byCategory.xlarge;
    if (width >= 14) return byCategory.large;
    if (width >= 10) return byCategory['medium-plus'];
    if (width >= 7) return byCategory.medium;
    return byCategory.small;
  }

  function ScreenScale({ room }) {
    const tier = screenTier(room);
    if (!tier) {
      return h('span', { className: 'screen-badge' }, h(Icon, { name: 'screen' }), dimensions(room));
    }
    const width = Number(room.screen_width_m);
    const pct = Math.max(18, Math.min(100, Math.round((width / SCREEN_MAX_M) * 100)));
    const label = `${tier.label} : ${dimensions(room)}${room.screen_estimated ? ' (estimées)' : ''}`;
    return h('span', { className: `screen-scale is-${tier.key}`, role: 'img', 'aria-label': label,
      title: room.screen_estimated ? 'Dimensions estimées' : 'Dimensions communiquées' },
      h('span', { className: 'screen-scale-head' },
        h('span', { className: 'screen-scale-dims' }, h(Icon, { name: 'screen' }), dimensions(room)),
        h('span', { className: 'screen-scale-tier' }, tier.label)),
      h('span', { className: 'screen-scale-track', 'aria-hidden': true },
        h('span', { className: 'screen-scale-fill', style: { width: `${pct}%` } })));
  }

  function groupBy(list, field) {
    const groups = new Map();
    list.forEach((item) => {
      if (!groups.has(item[field])) groups.set(item[field], []);
      groups.get(item[field]).push(item);
    });
    return groups;
  }
  const byTime = (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time);

  function cleanSynopsis(text) {
    return String(text || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  function letterboxdRating(film) {
    const score = film && film.letterboxd_rating;
    return film && film.letterboxd_verified === true &&
      ['json_ld', 'twitter_card'].includes(film.letterboxd_source) &&
      Number.isFinite(score) && score > 0 && score <= 5 ? score : null;
  }

  function LetterboxdMark() {
    return h('span', { className: 'lb-dots', 'aria-hidden': true },
      h('span', { className: 'lb-dot lb-dot-orange' }),
      h('span', { className: 'lb-dot lb-dot-green' }),
      h('span', { className: 'lb-dot lb-dot-blue' }));
  }

  function LetterboxdLink({ film }) {
    if (!film) return null;
    const direct = film.letterboxd_verified === true &&
      /^https:\/\/letterboxd\.com\/film\/[a-z0-9][a-z0-9-]*\/$/.test(film.letterboxd_url || '');
    const href = direct ? film.letterboxd_url :
      `https://letterboxd.com/search/${encodeURIComponent([film.title, film.year].filter(Boolean).join(' '))}/`;
    const rating = direct ? letterboxdRating(film) : null;
    const formatted = rating === null ? '' : rating.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const count = Number(film.letterboxd_rating_count);
    const details = [direct ? `Fiche Letterboxd de « ${film.title} »` : `Rechercher « ${film.title} » sur Letterboxd`,
      rating !== null && `Moyenne : ${formatted} sur 5`,
      rating !== null && count > 0 && `${count.toLocaleString('fr-FR')} évaluations`,
      film.letterboxd_fetched_at && !Number.isNaN(Date.parse(film.letterboxd_fetched_at)) &&
        `Note relevée le ${new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'medium' }).format(new Date(film.letterboxd_fetched_at))}`,
      film.letterboxd_status === 'stale' && 'Dernière note connue', 'Nouvel onglet'].filter(Boolean).join(' · ');
    return h('a', { ...external, href, className: `letterboxd-link${direct ? '' : ' is-search'}`,
      title: details, 'aria-label': details },
      h(LetterboxdMark), h('span', { className: 'lb-name' }, direct ? 'Letterboxd' : 'Rechercher sur Letterboxd'),
      rating !== null
        ? h('span', { className: 'lb-score' }, h('strong', null, formatted), h('span', { className: 'lb-scale' }, ' / 5'))
        : direct && h('span', { className: 'lb-unrated' }, 'Note indisponible'),
      h(Icon, { name: 'arrow' }));
  }

  function FilmPoster({ film, href }) {
    const [failed, setFailed] = useState(false);
    return h('div', { className: 'film-poster-container' },
      h('a', { ...external, href, className: 'film-poster',
        'aria-label': `Billetterie officielle pour ${film.title} (nouvel onglet)` },
        film.poster_url && !failed
          ? h('img', { src: film.poster_url, alt: `Affiche de ${film.title}`, className: 'poster-image',
              loading: 'lazy', decoding: 'async', width: 104, height: 156, onError: () => setFailed(true) })
          : h('span', { className: 'poster-fallback' }, h(Icon, { name: 'film' }), film.title),
        h('span', { className: 'poster-badges' },
          film.is_new && h('span', { className: 'new-badge' }, 'Nouveau'))));
  }

  function FilmInfo({ film, session, fallbackUrl, showDayInButton, mobile = false }) {
    const href = (session && session.booking_url) || fallbackUrl || '#';
    const isDirectCheckout = String(href || '').includes('s.pathe.fr/');
    const bookingCinema = session && cinemasById[session.cinema_id];
    const dayShort = session && daysByDate[session.date] ? daysByDate[session.date].short : '';
    const sessionLabel = session
      ? `${showDayInButton && dayShort ? `${dayShort} ` : ''}${session.time}`
      : '';
    const synopsisText = cleanSynopsis(film.synopsis);

    return h('div', { className: 'film-info' },
      h(FilmPoster, { film, href }),
      h('div', { className: 'film-copy' },
        h('h3', null, h('a', { ...external, href, className: 'film-title' }, film.title)),
        h('p', { className: 'film-meta' }, [film.director && `De ${film.director}`, duration(film.duration_min), film.year].filter(Boolean).join(' · ')),
        h(LetterboxdLink, { film }),
        h('div', { className: 'genre-list' },
          (film.genres || []).map((genre) => h('span', { key: genre, className: 'genre-badge' }, genre))),
        synopsisText && (mobile
          ? h('details', { className: 'film-synopsis-details' },
              h('summary', null, 'Synopsis', h(Icon, { name: 'chevron' })),
              h('p', { className: 'film-synopsis' }, synopsisText))
          : h('p', { className: 'film-synopsis', title: synopsisText }, synopsisText)),
        h('div', { className: 'film-actions-bar' },
          h('a', { ...external, href, className: 'film-booking secondary-link' },
            isDirectCheckout
              ? `Payer · ${bookingCinema ? bookingCinema.name : 'Pathé'} (${sessionLabel || 'direct'})`
              : `Réserver${bookingCinema ? ` · ${bookingCinema.name}` : ''}${sessionLabel ? ` (${sessionLabel})` : ''}`,
            h(Icon, { name: 'arrow' })))));
  }

  function SeatsBadge({ session }) {
    const { status } = getSeatsInfo(session);
    return h('div', {
      className: `seats-remaining-pill is-${status}`,
      title: status === 'soldout' ? 'Séance complète' : 'Il reste des places pour cette séance'
    },
      h('div', { className: 'seats-remaining-row' },
        h('span', { className: 'seats-dot' }),
        h('span', { className: 'seats-remaining-text' },
          h('span', { className: 'availability-long' }, status === 'soldout' ? 'Complet' : 'Places disponibles'),
          h('span', { className: 'availability-short' }, status === 'soldout' ? 'Complet' : 'Disponible'))));
  }

  function ShowtimeCard({ session, film, showDayBadge = false }) {
    const cinema = cinemasById[session.cinema_id];
    const room = roomFor(session);
    const name = room ? roomName(room) : `Salle ${session.salle}`;
    const end = session.end_time || endTime(session.time, film.duration_min);
    const { total: seats, status: availStatus } = getSeatsInfo(session);
    const price = Number(session.price_full);
    const targetHref = session.booking_url || cinema.url;
    const isDirectCheckout = String(targetHref || '').includes('s.pathe.fr/');
    const dayShort = (daysByDate[session.date] || {}).short || session.date;
    const availText = availStatus === 'soldout' ? 'complet' : 'places disponibles';

    return h('a', { ...external, href: targetHref, className: `showtime-card${availStatus === 'soldout' ? ' is-soldout' : ''}`,
      'data-session-id': session.id,
      title: isDirectCheckout
        ? `Accéder directement au choix des places et au paiement Pathé pour ${film.title} à ${session.time} — ${cinema.name}, ${name} (${availText})`
        : `Réserver ${film.title} à ${session.time} — ${cinema.name}, ${name} (${availText})` },
      showDayBadge && h('span', { className: 'showtime-day-chip' }, dayShort),
      h('div', { className: 'showtime-top' },
        h('div', null, h('time', { className: 'showtime-time', dateTime: `${session.date}T${session.time}` }, session.time),
          end && h('span', { className: 'showtime-end', title: 'Heure de fin de la séance' }, ` → ${end}`)),
        h('span', { className: `version-badge${session.version === 'VOST' ? ' is-vost' : ''}` }, session.version)),
      h('div', { className: 'showtime-room' }, h('strong', null, name),
        seats && h('span', { className: 'seat-count', title: 'Capacité totale de la salle' }, `${seats} pl.`)),
      h(ScreenScale, { room }),
      h('div', { className: 'showtime-meta' },
        h(SeatsBadge, { session }),
        room && h('span', { className: 'showtime-tech' }, [room.projection, room.sound].filter(Boolean).join(' · '))),
      session.note && h('span', { className: 'session-note' }, session.note),
      h('div', { className: 'showtime-bottom' },
        h('span', { className: 'price-label' }, price > 0 ? `${price.toFixed(2).replace('.', ',')} €` : 'Tarif sur le site'),
        h('span', { className: 'booking-label' },
          availStatus === 'soldout' ? 'Complet' : isDirectCheckout ? 'Payer' : 'Réserver',
          h(Icon, { name: 'arrow' }))));
  }

  function RoomList({ cinema }) {
    return h('div', { className: 'room-list' },
      Object.values(cinema.salles || {}).sort((a, b) => b.screen_width_m - a.screen_width_m).map((room) =>
        h('div', { key: room.number, className: 'room-mini' },
          h('strong', null, roomName(room)),
          h(ScreenScale, { room }),
          h('span', { className: 'room-specs' }, `${room.seats} fauteuils · ${room.projection} · ${room.sound}`))));
  }

  function CinemaSection({ cinema, filtered, allCinemaWeekSessions, selectedDay, onSelectDay, mobile }) {
    const dayFilmsCount = new Set(filtered.map((s) => s.film_id)).size;
    const weekFilmsCount = new Set((allCinemaWeekSessions || []).map((s) => s.film_id)).size;
    const extraWeekFilms = Math.max(0, weekFilmsCount - dayFilmsCount);

    return h('section', { className: 'cinema-section', 'aria-label': cinema.name, 'data-cinema-id': cinema.id },
      h('div', { className: 'cinema-banner' },
        h('div', { className: 'cinema-banner-name' }, h(Icon, { name: 'film' }), h('h2', null, cinema.name)),
        h('span', { className: 'count-badge' }, plural(filtered.length, 'séance'))),
      h('div', { className: 'cinema-heading' },
        h('div', null,
          h('span', { className: 'subtle-badge' }, cinema.group),
          h('p', { className: 'cinema-address' }, h(Icon, { name: 'pin' }),
            `${cinema.address} · ${plural(cinema.total_rooms, 'salle')} · ${cinema.total_seats} fauteuils`)),
        h('div', { className: 'cinema-actions' },
          h('a', { ...external, href: cinema.url, className: 'secondary-link' }, 'Site du cinéma', h(Icon, { name: 'arrow' })))),
      h('details', { className: 'rooms-details' },
        h('summary', null, h('span', { className: 'details-label' }, h(Icon, { name: 'screen' }),
          `Voir les ${plural(cinema.total_rooms, 'salle')} et leurs écrans`), h(Icon, { name: 'chevron' })),
        h(RoomList, { cinema })),
      filtered.length === 0 && allCinemaWeekSessions && allCinemaWeekSessions.length > 0
        ? h('div', { className: 'cinema-more-week-banner is-empty-day' },
            h('p', null, `Les séances d’aujourd’hui sont terminées pour ${cinema.name}, mais ${plural(allCinemaWeekSessions.length, 'séance')} (${plural(weekFilmsCount, 'film')}) sont programmées les autres jours.`),
            h('button', { type: 'button', className: 'secondary-button', onClick: () => onSelectDay('all') },
              'Voir toutes les séances de la semaine'))
        : Array.from(groupBy(filtered, 'film_id'), ([filmId, filmSessions]) => {
            const film = films[filmId] || { title: filmId };
            const bestSession = nextBookableSession(filmSessions);
            return h('article', { key: filmId, className: 'film-row' },
              h(FilmInfo, { film, session: bestSession, fallbackUrl: cinema.url, showDayInButton: selectedDay === 'all', mobile }),
              h('div', { className: 'film-sessions' },
                h('p', { className: 'film-cinema-context' }, h(Icon, { name: 'pin' }), `Séances · ${cinema.name}`),
                Array.from(groupBy(filmSessions, 'date'), ([date, dateSessions]) =>
                  h('div', { key: date },
                    selectedDay === 'all' && h('h4', { className: 'session-date' }, (daysByDate[date] || {}).label || date),
                    h('div', { className: 'showtime-grid' }, dateSessions.map((session) =>
                      h(ShowtimeCard, { key: session.id, session, film })))))));
          }),
      selectedDay !== 'all' && extraWeekFilms > 0 && filtered.length > 0 && h('div', { className: 'cinema-more-week-banner' },
        h('span', null, `+ ${plural(extraWeekFilms, 'autre')} film${extraWeekFilms > 1 ? 's' : ''} à l’affiche cette semaine dans ce cinéma`),
        h('button', { type: 'button', className: 'text-button', onClick: () => onSelectDay('all') },
          `Afficher toute la semaine (${weekFilmsCount} films) →`)));
  }

  function FilmTile({ filmId, filmSessions, showDayInLinks, mobile }) {
    const film = films[filmId] || { title: filmId };
    const cinemaGroups = groupBy(filmSessions, 'cinema_id');
    const bestOverall = nextBookableSession(filmSessions);
    const maxScreen = Math.max(0, ...filmSessions.map((session) => (roomFor(session) || {}).screen_width_m || 0));
    const availableCount = filmSessions.filter((s) => getSeatsInfo(s).status !== 'soldout').length;

    return h('article', { className: 'film-tile', 'data-film-id': filmId },
      h('div', { className: 'film-locations', role: 'group', 'aria-label': 'Cinémas de diffusion' },
        h('p', { className: 'film-locations-label' }, h(Icon, { name: 'pin' }), 'À voir dans'),
        h('ul', { className: 'film-locations-list' }, Array.from(cinemaGroups.keys(), (cinemaId) =>
          h('li', { key: cinemaId, 'data-cinema-id': cinemaId }, cinemasById[cinemaId].name)))),
      h(FilmInfo, {
        film,
        session: bestOverall,
        fallbackUrl: bestOverall ? cinemasById[bestOverall.cinema_id].url : '#',
        showDayInButton: showDayInLinks,
        mobile
      }),
      bestOverall && h('div', { className: 'film-tile-seats' },
        h(SeatsBadge, { session: bestOverall })),
      h('div', { className: 'film-tile-summary' },
        h('span', null, `${plural(filmSessions.length, 'séance')} · ${availableCount} avec places dispo`),
        maxScreen > 0 && h('span', null, `Écran jusqu’à ${number(maxScreen)} m`)),
      h('div', { className: 'film-cinema-links' },
        Array.from(cinemaGroups, ([cinemaId, list]) => {
          const best = nextBookableSession(list);
          const linkHref = (best && best.booking_url) || cinemasById[cinemaId].url;
          const isCheckout = String(linkHref || '').includes('s.pathe.fr/');
          const dayShort = best && daysByDate[best.date] ? daysByDate[best.date].short : '';
          const timePart = best ? `${showDayInLinks && dayShort ? `${dayShort} ` : ''}${best.time}` : '';
          return h('a', { ...external, key: cinemaId, className: 'secondary-link film-checkout-chip', href: linkHref },
            isCheckout
              ? `Payer · ${cinemasById[cinemaId].short_name} (${timePart})`
              : `Réserver · ${cinemasById[cinemaId].short_name} (${timePart})`,
            h(Icon, { name: 'arrow' }));
        })));
  }

  function FilmGallery({ filtered, otherWeekSessions, selectedDay, onSelectDay, sortByLetterboxd, setSortByLetterboxd, mobile }) {
    const sorter = (a, b) => {
      if (sortByLetterboxd) {
        const ra = letterboxdRating(films[a[0]]) ?? -1;
        const rb = letterboxdRating(films[b[0]]) ?? -1;
        if (rb !== ra) return rb - ra;
      }
      return b[1].length - a[1].length;
    };

    const dayGroups = Array.from(groupBy(filtered, 'film_id')).sort(sorter);
    const otherGroups = Array.from(groupBy(otherWeekSessions || [], 'film_id')).sort(sorter);

    return h(React.Fragment, null,
      h('div', { className: 'gallery-toolbar' },
        h('span', { className: 'gallery-count' }, `${plural(dayGroups.length, 'film')} à l’affiche`),
        h('button', {
          type: 'button',
          className: `letterboxd-sort-button${sortByLetterboxd ? ' is-active' : ''}`,
          onClick: () => setSortByLetterboxd(!sortByLetterboxd),
          'aria-pressed': sortByLetterboxd,
          title: 'Classer par note Letterboxd vérifiée ; les films sans note apparaissent en dernier'
        },
          h('span', { className: 'lb-dots', 'aria-hidden': true },
            h('span', { className: 'lb-dot lb-dot-orange' }),
            h('span', { className: 'lb-dot lb-dot-green' }),
            h('span', { className: 'lb-dot lb-dot-blue' })),
          sortByLetterboxd ? 'Note Letterboxd décroissante' : 'Trier par note Letterboxd')),
      dayGroups.length > 0 && h('div', { className: 'film-gallery' },
        dayGroups.map(([filmId, filmSessions]) =>
          h(FilmTile, { key: filmId, filmId, filmSessions, showDayInLinks: selectedDay === 'all', mobile }))),
      selectedDay !== 'all' && otherGroups.length > 0 && h('section', { className: 'other-week-films-section' },
        h('div', { className: 'other-week-heading' },
          h('div', null,
            h('p', { className: 'eyebrow' }, 'Programmation complète de la semaine'),
            h('h2', null, `Également à l’affiche cette semaine (${plural(otherGroups.length, 'autre')} film${otherGroups.length > 1 ? 's' : ''})`),
            h('p', null, `Ces films n’ont plus de séance le ${(daysByDate[selectedDay] || {}).label || selectedDay}, mais sont disponibles les autres jours de la semaine avec réservation directe.`)),
          h('button', { type: 'button', className: 'secondary-button', onClick: () => onSelectDay('all') },
            'Afficher toute la semaine')),
        h('div', { className: 'film-gallery' },
          otherGroups.map(([filmId, filmSessions]) =>
            h(FilmTile, { key: filmId, filmId, filmSessions, showDayInLinks: true, mobile })))));
  }

  function ClosedCinema({ cinema }) {
    return h('details', { className: 'closed-cinema' },
      h('summary', null, h('h2', null, cinema.name), h('span', { className: 'subtle-badge' }, 'Fermé pour travaux'),
        h(Icon, { name: 'chevron' })),
      h('div', { className: 'closed-content' }, h('p', null, cinema.status_note),
        h('p', { className: 'cinema-address' }, cinema.address),
        h('p', null, `${plural(cinema.total_rooms, 'salle')} historiques · ${cinema.total_seats} fauteuils`),
        h(RoomList, { cinema })));
  }

  function SallesComparator({ sort, setSort }) {
    const rooms = useMemo(() => {
      const all = cinemas.flatMap((cinema) => Object.values(cinema.salles || {}).map((room) => ({ ...room, cinema })));
      return all.sort(sort === 'screen_desc'
        ? (a, b) => b.screen_width_m - a.screen_width_m || b.seats - a.seats
        : sort === 'seats_desc'
          ? (a, b) => b.seats - a.seats || b.screen_width_m - a.screen_width_m
          : (a, b) => a.cinema.name.localeCompare(b.cinema.name, 'fr') ||
              String(a.number).localeCompare(String(b.number), 'fr', { numeric: true }));
    }, [sort]);
    return h(React.Fragment, null,
      h('div', { className: 'comparator-heading' },
        h('div', null, h('p', { className: 'eyebrow' }, 'Choisir son écran'), h('h1', null, `Les ${roomCount} salles à la loupe`),
          h('p', null, 'Dimensions, capacité et équipements des cinémas d’Aix et ses alentours.')),
        h('label', { className: 'select-field' }, h('span', null, 'Trier les salles'),
          h('select', { value: sort, onChange: (event) => setSort(event.target.value), 'aria-label': 'Trier les salles' },
            h('option', { value: 'screen_desc' }, 'Taille d’écran décroissante'),
            h('option', { value: 'seats_desc' }, 'Nombre de fauteuils'), h('option', { value: 'cinema' }, 'Cinéma')))),
      h('p', { className: 'screen-note' }, '~ : dimensions estimées. Les capacités indiquent le nombre total de fauteuils de la salle.'),
      h('p', { className: 'table-scroll-hint' }, 'Faites glisser le tableau pour comparer les écrans et les équipements →'),
      h('div', { className: 'table-scroll', role: 'region', 'aria-label': 'Comparatif des salles, défilement horizontal possible', tabIndex: 0 },
        h('table', { className: 'rooms-table' },
          h('caption', { className: 'sr-only' }, `Comparatif des ${roomCount} salles, y compris les salles historiques du Cézanne`),
          h('thead', null, h('tr', null, ['Cinéma', 'Salle', 'Écran (L × H)', 'Surface', 'Fauteuils', 'Projection & son', 'Notes'].map((label) =>
            h('th', { key: label, scope: 'col' }, label)))),
          h('tbody', null, rooms.map((room) => h('tr', { key: `${room.cinema.id}-${room.number}` },
            h('td', { className: 'table-cinema' }, room.cinema.name,
              isClosed(room.cinema) && h('span', { className: 'closed-label' }, 'Travaux')),
            h('th', { scope: 'row', className: 'room-name' },
              h('span', { className: 'table-room-cinema' }, room.cinema.name, isClosed(room.cinema) ? ' · Travaux' : ''),
              roomName(room)),
            h('td', null, h(ScreenScale, { room })),
            h('td', null, room.screen_area_m2 ? `${number(room.screen_area_m2)} m²` : 'N/C'),
            h('td', null, room.seats),
            h('td', null, h('div', null, room.projection), h('div', { className: 'room-extra' }, room.sound),
              h('div', { className: 'tech-tags' }, (room.tech || []).map((tech) => h('span', { key: tech, className: 'genre-badge' }, tech)))),
            h('td', { className: 'room-extra' }, room.notes)))))));
  }

  function useMedia(query) {
    const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
    useEffect(() => {
      const media = window.matchMedia(query);
      const update = () => setMatches(media.matches);
      update();
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }, [query]);
    return matches;
  }

  function App() {
    const isPhone = useMedia('(max-width: 767px)');
    const isCompact = useMedia('(max-width: 1023px)');
    const filterDialog = useRef(null);
    const filterTrigger = useRef(null);
    const showResultsOnClose = useRef(false);
    const headerRef = useRef(null);
    const dayListRef = useRef(null);
    const [activeTab, setActiveTab] = useState('cinemas');
    const [selectedDay, setSelectedDay] = useState(defaultDay);
    const [selectedCinema, setSelectedCinema] = useState('all');
    const [selectedVersion, setSelectedVersion] = useState('all');
    const [selectedScreen, setSelectedScreen] = useState('all');
    const [selectedTime, setSelectedTime] = useState('all');
    const [timeFrom, setTimeFrom] = useState('18:00');
    const [timeTo, setTimeTo] = useState('23:59');
    const [selectedAvailability, setSelectedAvailability] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [sort, setSort] = useState('screen_desc');
    const [sortByLetterboxd, setSortByLetterboxd] = useState(false);

    useEffect(() => {
      const header = headerRef.current;
      const update = () => document.documentElement.style.setProperty('--header-height', `${header.getBoundingClientRect().height}px`);
      update();
      const observer = new ResizeObserver(update);
      observer.observe(header);
      return () => observer.disconnect();
    }, []);

    useEffect(() => {
      const revealActiveDay = () => {
        const list = dayListRef.current;
        const active = list && list.querySelector('[aria-pressed="true"]');
        if (!active) return;
        const bounds = list.getBoundingClientRect();
        const button = active.getBoundingClientRect();
        if (button.left < bounds.left) list.scrollLeft += button.left - bounds.left - 8;
        else if (button.right > bounds.right) list.scrollLeft += button.right - bounds.right + 8;
      };
      revealActiveDay();
      window.addEventListener('resize', revealActiveDay);
      return () => window.removeEventListener('resize', revealActiveDay);
    }, [selectedDay, activeTab]);

    useEffect(() => {
      const dialog = filterDialog.current;
      if (!isCompact || activeTab === 'salles' || !dialog) {
        if (filtersOpen) setFiltersOpen(false);
        return;
      }
      if (filtersOpen && !dialog.open) {
        dialog.showModal();
      } else if (!filtersOpen && dialog.open) {
        dialog.close();
        if (showResultsOnClose.current) {
          const main = document.getElementById('main-content');
          main.focus({ preventScroll: true });
          main.scrollIntoView({ block: 'start' });
        } else if (filterTrigger.current && filterTrigger.current.isConnected) {
          filterTrigger.current.focus({ preventScroll: true });
        }
        showResultsOnClose.current = false;
      }
    }, [filtersOpen, isCompact, activeTab]);

    useEffect(() => {
      if (!isCompact || !filtersOpen) return;
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = previousOverflow; };
    }, [isCompact, filtersOpen]);

    // Actualisation automatique : recharge les séances toutes les heures,
    // et au retour sur l'onglet s'il est resté ouvert plus de 30 min.
    useEffect(() => {
      const loadedAt = Date.now();
      const timer = setInterval(() => window.location.reload(), 60 * 60 * 1000);
      const onVisible = () => {
        if (document.visibilityState === 'visible' && Date.now() - loadedAt > 30 * 60 * 1000) window.location.reload();
      };
      document.addEventListener('visibilitychange', onVisible);
      return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
    }, []);

    const matchesNonDayFilters = (session) => {
      const cinema = cinemasById[session.cinema_id];
      const film = films[session.film_id] || {};
      const room = roomFor(session);
      if (!cinema || isClosed(cinema)) return false;
      if (selectedCinema === 'centre-ville' && !['le-renoir', 'le-mazarin'].includes(session.cinema_id)) return false;
      if (!['all', 'centre-ville'].includes(selectedCinema) && session.cinema_id !== selectedCinema) return false;
      if (selectedVersion !== 'all' && session.version !== selectedVersion) return false;
      if (selectedScreen !== 'all') {
        if (!room) return false;
        if (selectedScreen === 'imax' && room.size_category !== 'imax') return false;
        if (selectedScreen === 'min10' && !(room.screen_width_m >= 10)) return false;
        if (selectedScreen === 'min14' && !(room.screen_width_m >= 14)) return false;
      }
      if (selectedAvailability === 'available' && getSeatsInfo(session).status === 'soldout') return false;
      const hour = Number(session.time.split(':')[0]);
      const minutesOf = (value) => {
        const [hh, mm] = String(value || '').split(':').map(Number);
        return Number.isFinite(hh) && Number.isFinite(mm) ? hh * 60 + mm : null;
      };
      const sessionMinutes = minutesOf(session.time);
      if (selectedTime === 'afternoon' && hour >= 18) return false;
      if (selectedTime === 'evening' && hour < 18) return false;
      if (selectedTime === 'custom') {
        const from = minutesOf(timeFrom);
        const to = minutesOf(timeTo);
        if (from !== null && to !== null && sessionMinutes !== null) {
          if (from <= to && (sessionMinutes < from || sessionMinutes > to)) return false;
          if (from > to && sessionMinutes < from && sessionMinutes > to) return false;
        }
      }
      const haystack = [film.title, film.director, film.cast, room && room.name, session.note,
        room && room.projection, room && room.sound, ...(room && room.tech || [])].join(' ');
      return !searchQuery.trim() || normalize(haystack).includes(normalize(searchQuery.trim()));
    };

    // Toutes les séances de la semaine qui correspondent aux filtres hors jour
    const weekFiltered = useMemo(() =>
      sessions.filter(matchesNonDayFilters).sort(byTime),
      [selectedCinema, selectedVersion, selectedScreen, selectedTime, timeFrom, timeTo, selectedAvailability, searchQuery]);

    // Séances du jour sélectionné
    const dayFiltered = useMemo(() =>
      selectedDay === 'all' ? weekFiltered : weekFiltered.filter((s) => s.date === selectedDay),
      [weekFiltered, selectedDay]);

    // Si une recherche précise ne donne rien sur le jour sélectionné mais existe un autre jour de la semaine, on bascule automatiquement sur les résultats de la semaine
    const autoExpandedToWeek = selectedDay !== 'all' && searchQuery.trim() !== '' && dayFiltered.length === 0 && weekFiltered.length > 0;
    const filtered = autoExpandedToWeek ? weekFiltered : dayFiltered;
    const effectiveDay = autoExpandedToWeek ? 'all' : selectedDay;

    // Films présents d'autres jours de la semaine mais pas le jour sélectionné (pour l'onglet Films)
    const otherWeekSessions = useMemo(() => {
      if (effectiveDay === 'all') return [];
      const dayFilmIds = new Set(filtered.map((s) => s.film_id));
      return weekFiltered.filter((s) => !dayFilmIds.has(s.film_id));
    }, [effectiveDay, filtered, weekFiltered]);

    const countFilters = [selectedCinema, selectedVersion, selectedScreen, selectedTime, selectedAvailability].filter((value) => value !== 'all').length;
    const hasFilters = countFilters > 0 || searchQuery.trim() || selectedDay !== defaultDay;
    const filmCount = new Set(filtered.map((session) => session.film_id)).size;
    const totalWeekFilmCount = new Set(weekFiltered.map((session) => session.film_id)).size;

    const cinemaOptions = [{ id: 'all', label: 'Tous les cinémas' }, { id: 'centre-ville', label: 'Centre-ville' },
      ...cinemas.map((cinema) => ({ id: cinema.id, label: `${cinema.name}${isClosed(cinema) ? ' · Travaux' : ''}` }))];
    const selectedCinemaLabel = (cinemaOptions.find((option) => option.id === selectedCinema) || {}).label;
    const context = [
      effectiveDay === 'all' ? 'Toute la semaine' : (daysByDate[effectiveDay] || {}).label,
      selectedCinema !== 'all' && selectedCinemaLabel,
      selectedVersion !== 'all' && selectedVersion,
      selectedScreen !== 'all' && ({ min10: 'Écran ≥ 10 m', min14: 'Écran ≥ 14 m', imax: 'IMAX' })[selectedScreen],
      selectedTime !== 'all' && (selectedTime === 'custom'
        ? `De ${String(timeFrom).replace(':', 'h')} à ${String(timeTo).replace(':', 'h')}`
        : selectedTime === 'evening' ? 'À partir de 18h' : 'Avant 18h'),
      selectedAvailability === 'available' && 'Places disponibles uniquement',
      searchQuery.trim() && `« ${searchQuery.trim()} »`
    ].filter(Boolean).join(' · ');

    function resetFilters() {
      setSelectedDay(defaultDay); setSelectedCinema('all'); setSelectedVersion('all');
      setSelectedScreen('all'); setSelectedTime('all'); setTimeFrom('18:00'); setTimeTo('23:59'); setSelectedAvailability('all');
      setSearchQuery('');
    }
    function selectField(label, id, value, setter, options) {
      const phoneLabels = {
        'version-filter': { all: 'Toutes', VOST: 'VOST', VF: 'VF' },
        'screen-filter': { all: 'Tous', min10: '≥ 10 m', min14: '≥ 14 m', imax: 'IMAX' },
        'time-filter': { all: 'Journée', afternoon: 'Avant 18h', evening: 'Dès 18h', custom: 'Plage perso' },
        'avail-filter': { all: 'Toutes', available: 'Disponibles' }
      };
      return h('label', { className: 'select-field', htmlFor: id }, h('span', null, label),
        h('select', { id, value, onChange: (event) => setter(event.target.value) },
          options.map(([optionValue, text]) => h('option', { key: optionValue, value: optionValue, 'aria-label': text },
            isPhone ? (phoneLabels[id] || {})[optionValue] || text : text))));
    }

    function filterButton(extraClass = '') {
      return h('button', { type: 'button', className: `filter-toggle ${extraClass}`,
        'aria-expanded': filtersOpen, 'aria-controls': 'advanced-filters', 'aria-haspopup': 'dialog',
        onClick: (event) => { filterTrigger.current = event.currentTarget; setFiltersOpen(true); } },
        h(Icon, { name: 'filters' }), 'Filtres', countFilters > 0 && h('span', { className: 'filter-count' }, countFilters));
    }

    function frenchTime(id, value, setter, label) {
      const [hour = '', minute = ''] = String(value || '').split(':');
      const update = (part, raw) => {
        const digits = String(raw).replace(/\D/g, '').slice(0, 2);
        const capped = digits === '' ? '' : Number(digits) > (part === 'hour' ? 23 : 59) ? String(part === 'hour' ? 23 : 59) : digits;
        setter(part === 'hour' ? capped + ':' + minute : hour + ':' + capped);
      };
      const pad = (part) => {
        if (part === 'hour' && hour) setter(hour.padStart(2, '0') + ':' + minute);
        if (part === 'minute' && minute) setter(hour + ':' + minute.padStart(2, '0'));
      };
      return h(React.Fragment, null,
        h('input', { id, className: 'time-part', type: 'text', inputMode: 'numeric', autoComplete: 'off',
          placeholder: '00', maxLength: 2, value: hour, 'aria-label': label + ' (heure, de 0 à 23)',
          onChange: (event) => update('hour', event.target.value), onBlur: () => pad('hour') }),
        h('span', { className: 'time-h', 'aria-hidden': true }, 'h'),
        h('input', { className: 'time-part', type: 'text', inputMode: 'numeric', autoComplete: 'off',
          placeholder: '00', maxLength: 2, value: minute, 'aria-label': label + ' (minutes)',
          onChange: (event) => update('minute', event.target.value), onBlur: () => pad('minute') }));
    }

    function timeRangeField() {
      return h('div', { className: 'time-range-field', role: 'group', 'aria-label': 'Plage horaire personnalisée, format 24 heures' },
        h('span', { className: 'time-range-label' }, 'De'),
        frenchTime('time-from', timeFrom, setTimeFrom, 'Heure de début'),
        h('span', { className: 'time-range-sep', 'aria-hidden': true }, 'à'),
        frenchTime('time-to', timeTo, setTimeTo, 'Heure de fin'));
    }


    function renderFilterPanel() {
      return h('div', { id: 'advanced-filters', className: 'filter-panel is-open' },
        h('div', { className: 'cinema-filters', role: 'group', 'aria-label': 'Choisir un cinéma' },
          cinemaOptions.map((option) => h('button', { key: option.id, type: 'button',
            className: `filter-chip${selectedCinema === option.id ? ' is-active' : ''}`,
            'aria-pressed': selectedCinema === option.id, onClick: () => setSelectedCinema(option.id) }, option.label))),
        h('div', { className: 'advanced-filters' },
          selectField('Version', 'version-filter', selectedVersion, setSelectedVersion,
            [['all', 'Toutes les versions'], ['VOST', 'VOST uniquement'], ['VF', 'VF uniquement']]),
          selectField('Taille d’écran', 'screen-filter', selectedScreen, setSelectedScreen,
            [['all', 'Tous les écrans'], ['min10', 'Écran ≥ 10 m'], ['min14', 'Grand écran ≥ 14 m'], ['imax', 'IMAX · 25 × 15 m']]),
          h(React.Fragment, null, selectField('Horaire', 'time-filter', selectedTime, setSelectedTime,
            [['all', 'Toute la journée'], ['afternoon', 'Avant 18h'], ['evening', 'Soirée · à partir de 18h'], ['custom', 'Plage personnalisée…']]), selectedTime === 'custom' && timeRangeField()),
          selectField('Disponibilité', 'avail-filter', selectedAvailability, setSelectedAvailability,
            [['all', 'Toutes les séances'], ['available', 'Places disponibles uniquement']])));
    }

    return h('div', { className: 'app-shell' },
      h('a', { className: 'skip-link', href: '#main-content' }, 'Aller aux résultats'),
      h('header', { className: 'site-header', ref: headerRef },
        h('div', { className: 'header-main container' },
          h('a', { className: 'brand', href: '#', onClick: (event) => { event.preventDefault(); setActiveTab('cinemas'); } },
            h('span', { className: 'brand-mark' }, h(Icon, { name: 'film' })),
            h('span', null, h('span', { className: 'brand-name' }, 'aix-ciné', h('span', null, '.info')),
              h('span', { className: 'brand-subtitle' }, 'Le cinéma, à votre mesure.'))),
          activeTab !== 'salles' && h('div', { className: 'header-search' },
            h('div', { className: 'search-field' }, h(Icon, { name: 'search' }),
              h('label', { className: 'sr-only', htmlFor: 'film-search' }, 'Rechercher un film, réalisateur, acteur ou salle'),
              h('input', { id: 'film-search', type: 'search', value: searchQuery, placeholder: 'Film, réalisateur, salle…',
                onChange: (event) => setSearchQuery(event.target.value) }),
              searchQuery && h('button', { className: 'search-clear', type: 'button', onClick: () => setSearchQuery(''),
                'aria-label': 'Effacer la recherche' }, h(Icon, { name: 'close' }))),
            filterButton('mobile-filter-toggle')),
          h('nav', { className: 'view-tabs', 'aria-label': 'Vues de la programmation' },
            [['cinemas', 'Séances'], ['films', 'Films'], ['salles', 'Salles']].map(([id, label]) =>
              h('button', { key: id, type: 'button', className: `view-tab${activeTab === id ? ' is-active' : ''}`,
                'aria-label': id === 'films' ? `Films (${totalWeekFilmCount})` : label,
                'aria-pressed': activeTab === id, 'aria-controls': 'main-content', onClick: () => setActiveTab(id) },
                label, id === 'films' && h('span', { className: 'tab-count', 'aria-hidden': true }, ` (${totalWeekFilmCount})`))))),
        activeTab !== 'salles' && h('div', { className: 'filter-bar' },
          h('div', { className: 'filter-content container' },
            h('div', { className: 'quick-controls' },
              h('div', { className: 'day-list', ref: dayListRef, role: 'group', 'aria-label': 'Choisir un jour' },
                h('button', { type: 'button', className: `day-button${selectedDay === 'all' ? ' is-active' : ''}`,
                  'aria-pressed': selectedDay === 'all', onClick: () => setSelectedDay('all') }, 'La semaine'),
                days.map((day) => h('button', { key: day.date, type: 'button', 'data-date': day.date,
                  className: `day-button${selectedDay === day.date ? ' is-active' : ''}`, 'aria-pressed': selectedDay === day.date,
                  'aria-label': `${day.label}${day.date === today ? ', aujourd’hui' : ''}`, onClick: () => setSelectedDay(day.date) },
                  h('span', { className: 'day-name' }, day.short),
                  day.date === today && h('span', { className: 'today-dot', title: 'Aujourd’hui' })))),
              h('div', { className: 'quick-actions' },
                h('button', {
                  type: 'button',
                  className: `seats-toggle${selectedAvailability === 'available' ? ' is-highlighted' : ''}`,
                  'aria-pressed': selectedAvailability === 'available',
                  onClick: () => setSelectedAvailability(selectedAvailability === 'available' ? 'all' : 'available'),
                  title: 'Masquer les séances complètes'
                }, h(Icon, { name: 'ticket' }),
                  selectedAvailability === 'available' ? 'Places dispo uniquement ✓' : 'Places dispo uniquement'),
                filterButton())),
            !isCompact && renderFilterPanel()))),
      isCompact && activeTab !== 'salles' && h('dialog', {
        ref: filterDialog, className: 'mobile-filter-sheet', 'aria-labelledby': 'filters-heading',
        onCancel: (event) => { event.preventDefault(); setFiltersOpen(false); },
        onClose: () => setFiltersOpen(false),
        onClick: (event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.target === event.currentTarget && (event.clientX < bounds.left || event.clientX > bounds.right ||
              event.clientY < bounds.top || event.clientY > bounds.bottom)) setFiltersOpen(false);
        }
      }, h('div', { className: 'sheet-layout' },
        h('div', { className: 'sheet-header' },
          h('div', null, h('h2', { id: 'filters-heading' }, 'Choisir sa séance'),
            h('p', { className: 'sheet-result-count', role: 'status', 'aria-live': 'polite' }, plural(filtered.length, 'séance'))),
          h('button', { type: 'button', className: 'sheet-close', 'aria-label': 'Fermer les filtres', onClick: () => setFiltersOpen(false) },
            h(Icon, { name: 'close' }))),
        h('div', { className: 'sheet-content' }, renderFilterPanel()),
        h('div', { className: 'sheet-footer' },
          h('button', { type: 'button', className: 'text-button sheet-reset', onClick: resetFilters }, 'Réinitialiser'),
          h('button', { type: 'button', className: 'primary-button sheet-apply',
            onClick: () => { showResultsOnClose.current = true; setFiltersOpen(false); } }, `Voir les ${plural(filtered.length, 'séance')}`)))),
      h('main', { id: 'main-content', className: 'page-content container', tabIndex: -1 },
        activeTab === 'salles'
          ? h(SallesComparator, { sort, setSort })
          : h(React.Fragment, null,
              h('div', { className: 'page-heading' },
                h('div', null, h('p', { className: 'eyebrow' }, 'Aix-en-Provence & alentours'),
                  h('h1', null, activeTab === 'films' ? `Les ${totalWeekFilmCount} films à l’affiche` : 'Trouvez votre prochaine séance')),
                h('div', { className: 'week-meta' }, h('p', null, program.week_label),
                  program.updated_at && h('p', null, 'Mise à jour le ', new Intl.DateTimeFormat('fr-FR', {
                    timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                  }).format(new Date(program.updated_at))))),
              autoExpandedToWeek && h('div', { className: 'search-week-notice' },
                h('span', null, `Aucune séance le ${(daysByDate[selectedDay] || {}).label || selectedDay} pour « ${searchQuery.trim()} » — affichage automatique des ${plural(filtered.length, 'séance')} sur toute la semaine.`),
                h('button', { type: 'button', className: 'text-button', onClick: () => setSelectedDay('all') }, 'Garder toute la semaine')),
              h('div', { className: 'results-toolbar' },
                h('div', { role: 'status', 'aria-live': 'polite', 'aria-atomic': true },
                  h('p', { className: 'result-count' },
                    `${plural(filtered.length, 'séance')} · ${plural(filmCount, 'film')}`),
                  h('p', { className: 'result-context' }, context)),
                hasFilters && h('button', { type: 'button', className: 'text-button', onClick: resetFilters }, 'Réinitialiser les filtres')),
              filtered.length === 0 && otherWeekSessions.length === 0 && h('div', { className: 'empty-state' }, h(Icon, { name: 'search' }),
                h('h2', null, 'Aucune séance pour cette sélection'),
                h('p', null, weekFiltered.length > 0
                  ? `Il n’y a plus de séance ce jour-là, mais ${plural(weekFiltered.length, 'séance')} sont disponibles les autres jours de la semaine.`
                  : 'Essayez un autre jour ou élargissez vos filtres pour retrouver une séance.'),
                h('div', { className: 'empty-actions' },
                  weekFiltered.length > 0 && h('button', { type: 'button', className: 'primary-button', onClick: () => setSelectedDay('all') },
                    `Voir les ${plural(weekFiltered.length, 'séance')} de la semaine`),
                  h('button', { type: 'button', className: 'secondary-button', onClick: resetFilters }, 'Réinitialiser les filtres'))),
              activeTab === 'cinemas'
                ? cinemas.filter((cinema) => !isClosed(cinema)).map((cinema) => {
                    const cinemaSessions = filtered.filter((session) => session.cinema_id === cinema.id);
                    const allCinemaWeekSessions = weekFiltered.filter((session) => session.cinema_id === cinema.id);
                    return (cinemaSessions.length > 0 || allCinemaWeekSessions.length > 0)
                      ? h(CinemaSection, {
                          key: cinema.id,
                          cinema,
                          filtered: cinemaSessions,
                          allCinemaWeekSessions,
                          selectedDay: effectiveDay,
                          onSelectDay: setSelectedDay,
                          mobile: isPhone
                        })
                      : null;
                  })
                : h(FilmGallery, {
                    filtered,
                    otherWeekSessions,
                    selectedDay: effectiveDay,
                    onSelectDay: setSelectedDay,
                    sortByLetterboxd,
                    setSortByLetterboxd,
                    mobile: isPhone
                  }),
              filtered.length > 0 && h('p', { className: 'screen-note' }, '~ : dimensions d’écran estimées. Capacités des salles et statut « Places disponibles / Complet » fournis par Pathé. Le paiement s’effectue directement sur la billetterie officielle Pathé / Institut de l’Image.'),
              activeTab === 'cinemas' && cinemas.filter((cinema) => isClosed(cinema) &&
                (selectedCinema === 'all' || selectedCinema === cinema.id)).map((cinema) => h(ClosedCinema, { key: cinema.id, cinema })))),
      h('footer', { className: 'site-footer container' },
        h('span', null, `aix-ciné.info · ${plural(cinemas.length, 'cinéma')} · ${plural(roomCount, 'salle')}`),
        h('span', null, 'Séances actualisées toutes les heures · tarifs à confirmer.')));
  }

  const root = document.getElementById('root');
  if (root) ReactDOM.createRoot(root).render(h(App));
})();
