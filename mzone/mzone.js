// mzone.js

/**
 * Sucht nach Filmen/Serien bei TMDb und formatiert die Ergebnisse
 */
async function searchResults(keyword) {
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        const responseText = await fetchv2(
            `https://api.themoviedb.org/3/search/multi?api_key=8d6d91941230817f7807d643736e8a49&query=${encodedKeyword}`
        );
        const data = await responseText.json();

        const transformedResults = data.results.map(result => {
            // Unterscheide zwischen Movie, TV und Sonstigem
            if (result.media_type === "movie" || result.title) {
                return {
                    title: result.title || result.name || result.original_title || result.original_name,
                    image: result.poster_path
                        ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
                        : "",
                    href: `https://m-zone.org/details/movie/${result.id}`
                };
            } else if (result.media_type === "tv" || result.name) {
                return {
                    title: result.name || result.title || result.original_name || result.original_title,
                    image: result.poster_path
                        ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
                        : "",
                    href: `https://m-zone.org/details/tv/${result.id}`
                };
            } else {
                // Fallback für andere Medientypen (z. B. Person)
                return {
                    title: result.title || result.name || result.original_name || result.original_title || "Untitled",
                    image: result.poster_path
                        ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
                        : "",
                    href: `https://m-zone.org/details/tv/${result.id}`
                };
            }
        });

        console.log(transformedResults);
        return JSON.stringify(transformedResults);
    } catch (error) {
        console.log('Fetch error in searchResults:', error);
        return JSON.stringify([{ title: 'Error', image: '', href: '' }]);
    }
}

/**
 * Extrahiert Detailinfos (Beschreibung, Dauer, Datum) für Movie oder TV
 */
async function extractDetails(url) {
    try {
        if (url.includes('movie')) {
            const match = url.match(/https:\/\/m-zone\.org\/details\/movie\/([^\/]+)/);
            if (!match) throw new Error("Invalid URL format");

            const movieId = match[1];
            const responseText = await fetchv2(
                `https://api.themoviedb.org/3/movie/${movieId}?api_key=8d6d91941230817f7807d643736e8a49`
            );
            const data = await responseText.json();

            const transformedResults = [{
                description: data.overview || 'No description available',
                aliases: `Duration: ${data.runtime ? data.runtime + " minutes" : 'Unknown'}`,
                airdate: `Released: ${data.release_date ? data.release_date : 'Unknown'}`
            }];

            console.log(transformedResults);
            return JSON.stringify(transformedResults);
        } else if (url.includes('tv')) {
            const match = url.match(/https:\/\/m-zone\.org\/details\/tv\/([^\/]+)/);
            if (!match) throw new Error("Invalid URL format");

            const showId = match[1];
            const responseText = await fetchv2(
                `https://api.themoviedb.org/3/tv/${showId}?api_key=8d6d91941230817f7807d643736e8a49`
            );
            const data = await responseText.json();

            const transformedResults = [{
                description: data.overview || 'No description available',
                aliases: `Duration: ${data.episode_run_time && data.episode_run_time.length
                    ? data.episode_run_time.join(', ') + " minutes"
                    : 'Unknown'
                }`,
                airdate: `Aired: ${data.first_air_date ? data.first_air_date : 'Unknown'}`
            }];

            console.log(transformedResults);
            return JSON.stringify(transformedResults);
        } else {
            throw new Error("Invalid URL format");
        }
    } catch (error) {
        console.log('Details error:', error);
        return JSON.stringify([{
            description: 'Error loading description',
            aliases: 'Duration: Unknown',
            airdate: 'Aired/Released: Unknown'
        }]);
    }
}

/**
 * Baut eine Episodenliste (bei TV) oder einen einzigen Artikel (bei Movie)
 */
async function extractEpisodes(url) {
    try {
        if (url.includes('movie')) {
            const match = url.match(/https:\/\/m-zone\.org\/details\/movie\/([^\/]+)/);
            if (!match) throw new Error("Invalid URL format");

            const movieId = match[1];
            const movie = [
                { href: `https://m-zone.org/watch/movie/${movieId}`, number: 1, title: "Full Movie" }
            ];

            console.log(movie);
            return JSON.stringify(movie);
        } else if (url.includes('tv')) {
            const match = url.match(/https:\/\/m-zone\.org\/details\/tv\/([^\/]+)/);
            if (!match) throw new Error("Invalid URL format");

            const showId = match[1];

            // Zuerst Grunddaten zur Serie holen, um Seasons zu ermitteln
            const showResponseText = await fetchv2(
                `https://api.themoviedb.org/3/tv/${showId}?api_key=8d6d91941230817f7807d643736e8a49`
            );
            const showData = await showResponseText.json();

            let allEpisodes = [];
            for (const season of showData.seasons) {
                const seasonNumber = season.season_number;
                // Skip Special (Season 0)
                if (seasonNumber === 0) continue;

                // Episode-Liste der jeweiligen Season abrufen
                const seasonResponseText = await fetchv2(
                    `https://api.themoviedb.org/3/tv/${showId}/season/${seasonNumber}?api_key=8d6d91941230817f7807d643736e8a49`
                );
                const seasonData = await seasonResponseText.json();

                if (seasonData.episodes && seasonData.episodes.length) {
                    const episodes = seasonData.episodes.map(episode => ({
                        href: `https://m-zone.org/watch/tv/${showId}?season=${seasonNumber}&episode=${episode.episode_number}`,
                        number: episode.episode_number,
                        title: episode.name || ""
                    }));
                    allEpisodes = allEpisodes.concat(episodes);
                }
            }

            console.log(allEpisodes);
            return JSON.stringify(allEpisodes);
        } else {
            throw new Error("Invalid URL format");
        }
    } catch (error) {
        console.log('Fetch error in extractEpisodes:', error);
        return JSON.stringify([]);
    }
}

/**
 * Holt sich ALLE verfügbaren Stream-Quellen von m-zone.org und extrahiert daraus
 * die echten .m3u8-/mp4-Links sowie ggf. Untertitel.
 */
async function extractStreamUrl(url) {
    try {
        // 1. Identifiziere, ob Movie- oder TV-URL
        const matchMain = url.match(/m-zone\.org\/watch\/(movie|tv)\/([^?]+)/);
        if (!matchMain) throw new Error('Ungültiges URL-Format: ' + url);

        const [, type, id] = matchMain;
        let watchPageUrl;

        // 2. Watch-Seite zusammensetzen
        if (type === 'movie') {
            watchPageUrl = `https://m-zone.org/watch/movie/${id}`;
        } else {
            const seasonMatch = url.match(/season=(\d+)/);
            const episodeMatch = url.match(/episode=(\d+)/);
            if (!seasonMatch || !episodeMatch) {
                throw new Error('Fehlende Season oder Episode im URL');
            }
            const season = seasonMatch[1];
            const episode = episodeMatch[1];
            watchPageUrl = `https://m-zone.org/watch/tv/${id}?season=${season}&episode=${episode}`;
        }

        console.log('Hole m-zone Watch-Seite:', watchPageUrl);
        const pageResponse = await fetchv2(watchPageUrl);
        const pageHtml = await pageResponse.text();

        // 3. Suche im HTML nach <iframe src="..."> aller bekannten Video-Hosts
        const embedRegex = /<iframe[^>]+src=['"](https?:\/\/(vidsrc\.su|videocdn\.net|rapidvideo\.com|streamango\.com|openload\.co)[^'"]+)['"]/gi;
        let embedMatch;
        const embedUrls = [];
        while ((embedMatch = embedRegex.exec(pageHtml)) !== null) {
            embedUrls.push(embedMatch[1]);
        }

        // 4. Fallback: Falls keine <iframe>-Einträge vorhanden, suche nach JS-Variable (z. B. window.sources)
        if (embedUrls.length === 0) {
            const sourcesRegex = /window\.sources\s*=\s*(\[[^\]]+\])/;
            const srcVarMatch = pageHtml.match(sourcesRegex);
            if (srcVarMatch) {
                try {
                    const sourcesArray = JSON.parse(srcVarMatch[1]);
                    sourcesArray.forEach(sourceObj => {
                        if (sourceObj.url) {
                            embedUrls.push(sourceObj.url);
                        }
                    });
                } catch (jsErr) {
                    console.warn('Fehler beim Parsen von window.sources:', jsErr);
                }
            }
        }

        console.log('Gefundene Embed-Quellen:', embedUrls);
        if (embedUrls.length === 0) {
            throw new Error('Keine Embed-Quellen gefunden auf der m-zone Seite');
        }

        const allStreams = [];
        let subtitleUrl = '';

        // 5. Aus jeder Embed-URL die echten Streams und Untertitel auslesen
        for (const embedSrc of embedUrls) {
            console.log('Verarbeite Embed-Host:', embedSrc);
            let embedHtml;
            try {
                const embedResponse = await fetchv2(embedSrc);
                embedHtml = await embedResponse.text();
            } catch (err) {
                console.warn('Konnte Embed-Seite nicht laden:', embedSrc, err);
                continue;
            }

            // 5a. Streams extrahieren (alle .m3u8-Links)
            const urlRegex = /(https?:\/\/[^"' ]+?\.m3u8[^"' ]*)/g;
            let urlMatch;
            while ((urlMatch = urlRegex.exec(embedHtml)) !== null) {
                const streamLink = urlMatch[1];
                allStreams.push({ provider: embedSrc, file: streamLink });
            }

            // 5b. Untertitel extrahieren (z. B. .vtt-Dateien)
            const subtitleRegex = /"url"\s*:\s*"([^"]+?\.vtt)"[^}]*"language"\s*:\s*"([^"]+)"/g;
            let subMatch;
            while ((subMatch = subtitleRegex.exec(embedHtml)) !== null) {
                const subLink = subMatch[1];
                const lang = subMatch[2].toLowerCase();
                // Beispiel: Nur englische oder deutsche Untertitel berücksichtigen
                if (lang.includes('english') || lang.includes('german')) {
                    subtitleUrl = subLink;
                    break;
                }
            }

            // Optional: Wenn mindestens ein Stream gefunden ist, per „break“ abbrechen:
            // if (allStreams.length > 0) break;
        }

        if (allStreams.length === 0) {
            console.warn('Keine Stream-Links in allen Embed-Quellen gefunden.');
        }

        const result = {
            streams: allStreams,
            subtitles: subtitleUrl
        };

        console.log('Result:', result);
        return JSON.stringify(result);
    } catch (error) {
        console.log('Fehler in extractStreamUrl:', error);
        return JSON.stringify({ streams: [], subtitles: '' });
    }
}

// Beispiel-Aufruf (zum Testen):
// extractStreamUrl("https://m-zone.org/watch/tv/1396?season=1&episode=1");
