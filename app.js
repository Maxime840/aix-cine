/** Aix-Ciné.info — programmation, salles, places restantes et billetteries officielles. */
(function () {
  'use strict';

  const { useEffect, useMemo, useState } = React;
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
  function screenClass(room) {
    return `screen-badge${room && room.size_category === 'imax' ? ' is-imax' :
      room && room.screen_width_m >= 14 ? ' is-large' : ''}`;
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

  function LetterboxdBadge({ film, compact = false }) {
    if (!film) return null;
    const url = film.letterboxd_url || `https://letterboxd.com/search/${encodeURIComponent(film.title)}/`;
    const hasRating = typeof film.letterboxd_rating === 'number' && film.letterboxd_rating > 0;

    return h('a', {
      ...external,
      href: url,
      className: `letterboxd-badge${compact ? ' is-compact' : ''}`,
      title: hasRating
        ? `Consulter la fiche Letterboxd de « ${film.title} » (note moyenne ${film.letterboxd_rating.toFixed(1)} / 5)`
        : `Rechercher « ${film.title} » sur Letterboxd`
    },
      h('span', { className: 'lb-dots', 'aria-hidden': true },
        h('span', { className: 'lb-dot lb-dot-orange' }),
        h('span', { className: 'lb-dot lb-dot-green' }),
        h('span', { className: 'lb-dot lb-dot-blue' })),
      h('span', { className: 'lb-name' }, 'Letterboxd'),
      hasRating && h('span', { className: 'lb-score' }, `★ ${film.letterboxd_rating.toFixed(1)}`),
      h(Icon, { name: 'arrow', className: 'lb-arrow' }));
  }

  function FilmPoster({ film, href }) {
    const [failed, setFailed] = useState(false);
    const hasLb = typeof film.letterboxd_rating === 'number' && film.letterboxd_rating > 0;
    return h('div', { className: 'film-poster-container' },
      h('a', { ...external, href, className: 'film-poster',
        'aria-label': `Billetterie officielle pour ${film.title} (nouvel onglet)` },
        film.poster_url && !failed
          ? h('img', { src: film.poster_url, alt: `Affiche de ${film.title}`, className: 'poster-image',
              loading: 'lazy', onError: () => setFailed(true) })
          : h('span', { className: 'poster-fallback' }, h(Icon, { name: 'film' }), film.title),
        h('span', { className: 'poster-badges' },
          film.is_new && h('span', { className: 'new-badge' }, 'Nouveau'))),
      hasLb && h('a', {
        ...external,
        href: film.letterboxd_url || `https://letterboxd.com/search/${encodeURIComponent(film.title)}/`,
        className: 'poster-lb-tag',
        title: `Note Letterboxd : ${film.letterboxd_rating.toFixed(1)} / 5 (ouvrir la fiche)`
      },
        h('span', { className: 'lb-dots is-micro', 'aria-hidden': true },
          h('span', { className: 'lb-dot lb-dot-orange' }),
          h('span', { className: 'lb-dot lb-dot-green' }),
          h('span', { className: 'lb-dot lb-dot-blue' })),
        `★ ${film.letterboxd_rating.toFixed(1)}`));
  }

  function FilmInfo({ film, session, fallbackUrl, showDayInButton }) {
    const href = (session && session.booking_url) || fallbackUrl || '#';
    const isDirectCheckout = String(href || '').includes('s.pathe.fr/');
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
        h('div', { className: 'genre-list' },
          (film.genres || []).map((genre) => h('span', { key: genre, className: 'genre-badge' }, genre)),
          h(LetterboxdBadge, { film, compact: true })),
        synopsisText && h('p', { className: 'film-synopsis', title: synopsisText }, synopsisText),
        h('div', { className: 'film-actions-bar' },
          h('a', { ...external, href, className: 'film-booking secondary-link' },
            isDirectCheckout
              ? `Paiement Pathé (${sessionLabel || 'direct'})`
              : `Billetterie officielle${sessionLabel ? ` (${sessionLabel})` : ''}`,
            h(Icon, { name: 'arrow' })),
          h('a', {
            ...external,
            href: film.letterboxd_url || `https://letterboxd.com/search/${encodeURIComponent(film.title)}/`,
            className: 'film-lb-link secondary-link',
            title: `Ouvrir la fiche Letterboxd de « ${film.title} »`
          },
            h('span', { className: 'lb-dots is-micro', 'aria-hidden': true },
              h('span', { className: 'lb-dot lb-dot-orange' }),
              h('span', { className: 'lb-dot lb-dot-green' }),
              h('span', { className: 'lb-dot lb-dot-blue' })),
            typeof film.letterboxd_rating === 'number'
              ? `Fiche Letterboxd (★ ${film.letterboxd_rating.toFixed(1)})`
              : 'Fiche Letterboxd',
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
          status === 'soldout' ? 'Complet' : 'Places disponibles')));
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
      h(SeatsBadge, { session }),
      h('span', { className: screenClass(room), title: room && room.screen_estimated ? 'Dimensions estimées' : 'Dimensions communiquées' },
        h(Icon, { name: 'screen' }), dimensions(room)),
      room && h('span', { className: 'showtime-tech' }, [room.projection, room.sound].filter(Boolean).join(' · ')),
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
          h('span', { className: screenClass(room) }, dimensions(room)),
          h('span', { className: 'room-specs' }, `${room.seats} fauteuils · ${room.projection} · ${room.sound}`))));
  }

  function CinemaSection({ cinema, filtered, allCinemaWeekSessions, selectedDay, onSelectDay }) {
    const dayFilmsCount = new Set(filtered.map((s) => s.film_id)).size;
    const weekFilmsCount = new Set((allCinemaWeekSessions || []).map((s) => s.film_id)).size;
    const extraWeekFilms = Math.max(0, weekFilmsCount - dayFilmsCount);

    return h('section', { className: `cinema-section${cinema.id === 'le-renoir' ? ' cinema-section--editorial' : ''}`, 'aria-label': cinema.name },
      h('div', { className: 'cinema-heading' },
        h('div', null,
          h('div', { className: 'cinema-title-line' }, h('h2', null, cinema.name),
            h('span', { className: 'subtle-badge' }, cinema.group)),
          h('p', { className: 'cinema-address' }, h(Icon, { name: 'pin' }),
            `${cinema.address} · ${plural(cinema.total_rooms, 'salle')} · ${cinema.total_seats} fauteuils`)),
        h('div', { className: 'cinema-actions' },
          h('span', { className: 'count-badge' }, plural(filtered.length, 'séance')),
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
              h(FilmInfo, { film, session: bestSession, fallbackUrl: cinema.url, showDayInButton: selectedDay === 'all' }),
              h('div', { className: 'film-sessions' },
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

  function FilmTile({ filmId, filmSessions, showDayInLinks }) {
    const film = films[filmId] || { title: filmId };
    const cinemaGroups = groupBy(filmSessions, 'cinema_id');
    const bestOverall = nextBookableSession(filmSessions);
    const maxScreen = Math.max(0, ...filmSessions.map((session) => (roomFor(session) || {}).screen_width_m || 0));
    const availableCount = filmSessions.filter((s) => getSeatsInfo(s).status !== 'soldout').length;

    return h('article', { className: 'film-tile' },
      h(FilmInfo, {
        film,
        session: bestOverall,
        fallbackUrl: bestOverall ? cinemasById[bestOverall.cinema_id].url : '#',
        showDayInButton: showDayInLinks
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

  function FilmGallery({ filtered, otherWeekSessions, selectedDay, onSelectDay, sortByLetterboxd, setSortByLetterboxd }) {
    const sorter = (a, b) => {
      if (sortByLetterboxd) {
        const ra = (films[a[0]] || {}).letterboxd_rating || 0;
        const rb = (films[b[0]] || {}).letterboxd_rating || 0;
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
          title: 'Classer les films du mieux noté au moins bien noté sur Letterboxd'
        },
          h('span', { className: 'lb-dots', 'aria-hidden': true },
            h('span', { className: 'lb-dot lb-dot-orange' }),
            h('span', { className: 'lb-dot lb-dot-green' }),
            h('span', { className: 'lb-dot lb-dot-blue' })),
          sortByLetterboxd ? 'Tri : Mieux notés Letterboxd (★ ↓)' : 'Trier par note Letterboxd')),
      dayGroups.length > 0 && h('div', { className: 'film-gallery' },
        dayGroups.map(([filmId, filmSessions]) =>
          h(FilmTile, { key: filmId, filmId, filmSessions, showDayInLinks: selectedDay === 'all' }))),
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
            h(FilmTile, { key: filmId, filmId, filmSessions, showDayInLinks: true })))));
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
      h('div', { className: 'table-scroll', role: 'region', 'aria-label': 'Comparatif des salles, défilement horizontal possible', tabIndex: 0 },
        h('table', { className: 'rooms-table' },
          h('caption', { className: 'sr-only' }, `Comparatif des ${roomCount} salles, y compris les salles historiques du Cézanne`),
          h('thead', null, h('tr', null, ['Cinéma', 'Salle', 'Écran (L × H)', 'Surface', 'Fauteuils', 'Projection & son', 'Notes'].map((label) =>
            h('th', { key: label, scope: 'col' }, label)))),
          h('tbody', null, rooms.map((room) => h('tr', { key: `${room.cinema.id}-${room.number}` },
            h('td', { className: 'table-cinema' }, room.cinema.name,
              isClosed(room.cinema) && h('span', { className: 'closed-label' }, 'Travaux')),
            h('th', { scope: 'row', className: 'room-name' }, roomName(room)),
            h('td', null, h('span', { className: screenClass(room) }, dimensions(room))),
            h('td', null, room.screen_area_m2 ? `${number(room.screen_area_m2)} m²` : 'N/C'),
            h('td', null, room.seats),
            h('td', null, h('div', null, room.projection), h('div', { className: 'room-extra' }, room.sound),
              h('div', { className: 'tech-tags' }, (room.tech || []).map((tech) => h('span', { key: tech, className: 'genre-badge' }, tech)))),
            h('td', { className: 'room-extra' }, room.notes)))))));
  }

  function App() {
    const [activeTab, setActiveTab] = useState('cinemas');
    const [selectedDay, setSelectedDay] = useState(defaultDay);
    const [selectedCinema, setSelectedCinema] = useState('all');
    const [selectedVersion, setSelectedVersion] = useState('all');
    const [selectedScreen, setSelectedScreen] = useState('all');
    const [selectedTime, setSelectedTime] = useState('all');
    const [selectedAvailability, setSelectedAvailability] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [sort, setSort] = useState('screen_desc');
    const [sortByLetterboxd, setSortByLetterboxd] = useState(false);

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
      if (selectedTime === 'afternoon' && hour >= 18) return false;
      if (selectedTime === 'evening' && hour < 18) return false;
      const haystack = [film.title, film.director, film.cast, room && room.name, session.note,
        room && room.projection, room && room.sound, ...(room && room.tech || [])].join(' ');
      return !searchQuery.trim() || normalize(haystack).includes(normalize(searchQuery.trim()));
    };

    // Toutes les séances de la semaine qui correspondent aux filtres hors jour
    const weekFiltered = useMemo(() =>
      sessions.filter(matchesNonDayFilters).sort(byTime),
      [selectedCinema, selectedVersion, selectedScreen, selectedTime, selectedAvailability, searchQuery]);

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
      selectedTime !== 'all' && (selectedTime === 'evening' ? 'À partir de 18h' : 'Avant 18h'),
      selectedAvailability === 'available' && 'Places disponibles uniquement',
      searchQuery.trim() && `« ${searchQuery.trim()} »`
    ].filter(Boolean).join(' · ');

    function resetFilters() {
      setSelectedDay(defaultDay); setSelectedCinema('all'); setSelectedVersion('all');
      setSelectedScreen('all'); setSelectedTime('all'); setSelectedAvailability('all');
      setSearchQuery('');
    }
    function selectField(label, id, value, setter, options) {
      return h('label', { className: 'select-field', htmlFor: id }, h('span', null, label),
        h('select', { id, value, onChange: (event) => setter(event.target.value) },
          options.map(([optionValue, text]) => h('option', { key: optionValue, value: optionValue }, text))));
    }

    return h('div', { className: 'app-shell' },
      h('a', { className: 'skip-link', href: '#main-content' }, 'Aller aux résultats'),
      h('header', { className: 'site-header' },
        h('div', { className: 'header-main container' },
          h('a', { className: 'brand', href: '#', onClick: (event) => { event.preventDefault(); setActiveTab('cinemas'); } },
            h('span', { className: 'brand-mark' }, h(Icon, { name: 'film' })),
            h('span', null, h('span', { className: 'brand-name' }, 'aix-ciné', h('span', null, '.info')),
              h('span', { className: 'brand-subtitle' }, 'Le cinéma, à votre mesure.'))),
          activeTab !== 'salles' && h('div', { className: 'header-search' },
            h('div', { className: 'search-field' }, h(Icon, { name: 'search' }),
              h('label', { className: 'sr-only', htmlFor: 'film-search' }, 'Rechercher un film, réalisateur, acteur ou salle'),
              h('input', { id: 'film-search', type: 'search', value: searchQuery, placeholder: 'Un film, un réalisateur, une salle…',
                onChange: (event) => setSearchQuery(event.target.value) }),
              searchQuery && h('button', { className: 'search-clear', type: 'button', onClick: () => setSearchQuery(''),
                'aria-label': 'Effacer la recherche' }, h(Icon, { name: 'close' })))),
          h('nav', { className: 'view-tabs', 'aria-label': 'Vues de la programmation' },
            [['cinemas', 'Séances'], ['films', `Films (${totalWeekFilmCount})`], ['salles', 'Salles']].map(([id, label]) =>
              h('button', { key: id, type: 'button', className: `view-tab${activeTab === id ? ' is-active' : ''}`,
                'aria-pressed': activeTab === id, 'aria-controls': 'main-content', onClick: () => setActiveTab(id) }, label)))),
        activeTab !== 'salles' && h('div', { className: 'filter-bar' },
          h('div', { className: 'filter-content container' },
            h('div', { className: 'quick-controls' },
              h('div', { className: 'day-list', role: 'group', 'aria-label': 'Choisir un jour' },
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
                },
                  h(Icon, { name: 'ticket' }),
                  selectedAvailability === 'available' ? 'Places dispo uniquement ✓' : 'Places dispo uniquement'),
                h('button', { type: 'button', className: 'filter-toggle', 'aria-expanded': filtersOpen,
                  'aria-controls': 'advanced-filters', onClick: () => setFiltersOpen(!filtersOpen) },
                  h(Icon, { name: 'filters' }), 'Filtres', countFilters > 0 && h('span', { className: 'filter-count' }, countFilters)))),
            h('div', { id: 'advanced-filters', className: `filter-panel${filtersOpen ? ' is-open' : ''}` },
              h('div', { className: 'cinema-filters', role: 'group', 'aria-label': 'Choisir un cinéma' },
                cinemaOptions.map((option) => h('button', { key: option.id, type: 'button',
                  className: `filter-chip${selectedCinema === option.id ? ' is-active' : ''}`,
                  'aria-pressed': selectedCinema === option.id, onClick: () => setSelectedCinema(option.id) }, option.label))),
              h('div', { className: 'advanced-filters' },
                selectField('Version', 'version-filter', selectedVersion, setSelectedVersion,
                  [['all', 'Toutes les versions'], ['VOST', 'VOST uniquement'], ['VF', 'VF uniquement']]),
                selectField('Taille d’écran', 'screen-filter', selectedScreen, setSelectedScreen,
                  [['all', 'Tous les écrans'], ['min10', 'Écran ≥ 10 m'], ['min14', 'Grand écran ≥ 14 m'], ['imax', 'IMAX · 25 × 15 m']]),
                selectField('Horaire', 'time-filter', selectedTime, setSelectedTime,
                  [['all', 'Toute la journée'], ['afternoon', 'Avant 18h'], ['evening', 'Soirée · à partir de 18h']]),
                selectField('Disponibilité', 'avail-filter', selectedAvailability, setSelectedAvailability,
                  [['all', 'Toutes les séances'], ['available', 'Places disponibles uniquement']])))))),
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
                          onSelectDay: setSelectedDay
                        })
                      : null;
                  })
                : h(FilmGallery, {
                    filtered,
                    otherWeekSessions,
                    selectedDay: effectiveDay,
                    onSelectDay: setSelectedDay,
                    sortByLetterboxd,
                    setSortByLetterboxd
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
