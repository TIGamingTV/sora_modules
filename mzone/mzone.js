const apiKey = "8d6d91941230817f7807d643736e8a49";  // <-- TMDb API Key einsetzen

async function searchResults(keyword) {
    try {
        if (!keyword || keyword.trim() === "") {
            console.log("Leerer Suchbegriff");
            return JSON.stringify([]);
        }

        const encodedKeyword = encodeURIComponent(keyword.trim());
        const url = `https://api.themoviedb.org/3/search/multi?api_key=${apiKey}&query=${encodedKeyword}`;
        console.log("Starte Suche nach:", keyword, "→", url);

        const responseText = await fetchv2(url);
        const data = await responseText.json();

        if (!data.results || data.results.length === 0) {
            console.log("Keine Treffer für:", keyword);
            return JSON.stringify([]);
        }

        const transformedResults = data.results.map(result => {
            const isMovie = result.media_type === "movie";
            const isTV = result.media_type === "tv";
            return {
                title: result.title || result.name || "Unbenannt",
                image: result.poster_path
                    ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
                    : "",
                href: isMovie
                    ? `https://m-zone.org/details/movie/${result.id}`
                    : isTV
                        ? `https://m-zone.org/details/tv/${result.id}`
                        : "#"
            };
        });

        return JSON.stringify(transformedResults);
    } catch (error) {
        console.log("Fehler in searchResults:", error);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        if (url.includes('movie')) {
            const match = url.match(/movie\/([^\/]+)/);
            if (!match) throw new Error("Ungültige URL");

            const movieId = match[1];
            const res = await fetchv2(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${apiKey}`);
            const data = await res.json();

            return JSON.stringify([{
                description: data.overview || 'Keine Beschreibung verfügbar',
                aliases: `Dauer: ${data.runtime ? data.runtime + " Minuten" : 'Unbekannt'}`,
                airdate: `Veröffentlicht: ${data.release_date || 'Unbekannt'}`
            }]);
        } else if (url.includes('tv')) {
            const match = url.match(/tv\/([^\/]+)/);
            if (!match) throw new Error("Ungültige URL");

            const showId = match[1];
            const res = await fetchv2(`https://api.themoviedb.org/3/tv/${showId}?api_key=${apiKey}`);
            const data = await res.json();

            return JSON.stringify([{
                description: data.overview || 'Keine Beschreibung verfügbar',
                aliases: `Dauer: ${data.episode_run_time?.join(', ') || 'Unbekannt'} Minuten`,
                airdate: `Erstausstrahlung: ${data.first_air_date || 'Unbekannt'}`
            }]);
        } else {
            throw new Error("Ungültige URL");
        }
    } catch (error) {
        console.log("Fehler in extractDetails:", error);
        return JSON.stringify([{
            description: 'Fehler beim Laden',
            aliases: 'Dauer: Unbekannt',
            airdate: 'Erschienen: Unbekannt'
        }]);
    }
}

async function extractEpisodes(url) {
    try {
        if (url.includes('movie')) {
            const match = url.match(/movie\/([^\/]+)/);
            if (!match) throw new Error("Ungültige URL");
            const movieId = match[1];

            return JSON.stringify([{
                href: `https://m-zone.org/watch/movie/${movieId}`,
                number: 1,
                title: "Ganzer Film"
            }]);
        } else if (url.includes('tv')) {
            const match = url.match(/tv\/([^\/]+)/);
            if (!match) throw new Error("Ungültige URL");
            const showId = match[1];

            const showRes = await fetchv2(`https://api.themoviedb.org/3/tv/${showId}?api_key=${apiKey}`);
            const showData = await showRes.json();

            let episodes = [];

            for (const season of showData.seasons) {
                if (season.season_number === 0) continue;

                const seasonRes = await fetchv2(`https://api.themoviedb.org/3/tv/${showId}/season/${season.season_number}?api_key=${apiKey}`);
                const seasonData = await seasonRes.json();

                for (const ep of seasonData.episodes) {
                    episodes.push({
                        href: `https://m-zone.org/watch/tv/${showId}?season=${season.season_number}&episode=${ep.episode_number}`,
                        number: ep.episode_number,
                        title: ep.name || `Episode ${ep.episode_number}`
                    });
                }
            }

            return JSON.stringify(episodes);
        } else {
            throw new Error("Ungültige URL");
        }
    } catch (error) {
        console.log("Fehler in extractEpisodes:", error);
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(url) {
    try {
        const match = url.match(/m-zone\.org\/watch\/(movie|tv)\/([^?]+)/);
        if (!match) throw new Error("Ungültige URL");

        const [ , type, id ] = match;

        let embedUrl;
        if (type === "movie") {
            embedUrl = `https://vidsrc.su/embed/movie/${id}`;
        } else {
            const seasonMatch = url.match(/season=(\d+)/);
            const episodeMatch = url.match(/episode=(\d+)/);
            if (!seasonMatch || !episodeMatch) throw new Error("Staffel oder Episode fehlt");

            embedUrl = `https://vidsrc.su/embed/tv/${id}/${seasonMatch[1]}/${episodeMatch[1]}`;
        }

        const html = await fetchv2(embedUrl).then(res => res.text());

        const streamRegex = /url:\s*["']([^"']+)["']/g;
        const streams = Array.from(html.matchAll(streamRegex), m => m[1]);

        const subtitleRegex = /"url"\s*:\s*"([^"]+)"[^}]*"format"\s*:\s*"([^"]+)"[^}]*"encoding"\s*:\s*"([^"]+)"[^}]*"display"\s*:\s*"([^"]+)"[^}]*"language"\s*:\s*"([^"]+)"/g;
        const subtitles = [];
        let matchSub;
        while ((matchSub = subtitleRegex.exec(html)) !== null) {
            subtitles.push({
                url: matchSub[1],
                format: matchSub[2],
                encoding: matchSub[3],
                display: matchSub[4],
                language: matchSub[5]
            });
        }

        const selectedSubtitle = subtitles.find(s => 
            s.display.includes("English") && ["ASCII", "UTF-8", "CP1252"].includes(s.encoding)
        );

        return JSON.stringify({
            streams,
            subtitles: selectedSubtitle?.url || ""
        });
    } catch (error) {
        console.log("Fehler in extractStreamUrl:", error);
        return null;
    }
}
