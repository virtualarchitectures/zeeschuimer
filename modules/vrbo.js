zeeschuimer.register_module(
  "VRBO.com",
  "vrbo.com",
  function (response, source_platform_url, source_url) {
    let domain = source_platform_url
      .split("/")[2]
      .toLowerCase()
      .replace(/^www\./, "");

    if (!["vrbo.com"].includes(domain)) return [];

    function _try_parse(text) {
      try { return JSON.parse(text); } catch (e) { return null; }
    }

    // ── Parse all JSON chunks ──────────────────────────────────────────────────
    // VRBO uses Apollo @defer, producing two NDJSON lines per response:
    //   Line 1: { data: { listingSearchResults: { propertySearchListings: [...] } }, hasNext: true, ... }
    //   Line 2: { incremental: [{ data: { deferredMapSearchResults: { dynamicMap: { map: { markers: [...] } } } } }], hasNext: false }
    // We also handle single JSON objects and batched arrays for robustness.
    const chunks = [];
    const parsed = _try_parse(response);
    if (parsed) {
      (Array.isArray(parsed) ? parsed : [parsed]).forEach(c => chunks.push(c));
    } else {
      for (const line of response.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        const obj = _try_parse(trimmed);
        if (obj) chunks.push(obj);
      }
    }

    // ── Extract listing array ──────────────────────────────────────────────────
    let rawListings = [];
    for (const chunk of chunks) {
      const l = chunk?.data?.listingSearchResults?.propertySearchListings;
      if (Array.isArray(l) && l.length > 0) { rawListings = l; break; }
    }

    // ── Extract map-marker coordinates from deferred chunk ────────────────────
    // markers[].id matches propertySearchListings[].id
    const coordsById = {};
    for (const chunk of chunks) {
      if (!Array.isArray(chunk?.incremental)) continue;
      for (const inc of chunk.incremental) {
        const markers =
          inc?.data?.deferredMapSearchResults?.dynamicMap?.map?.markers;
        if (!Array.isArray(markers)) continue;
        for (const m of markers) {
          if (m?.id && m?.markerPosition) {
            coordsById[String(m.id)] = {
              latitude: m.markerPosition.latitude ?? null,
              longitude: m.markerPosition.longitude ?? null,
            };
          }
        }
      }
    }

    // ── Stage 1: GraphQL JSON ─────────────────────────────────────────────────
    if (rawListings.length > 0) {
      return rawListings
        .map(item => {
          const id = item?.id ?? item?.mediaSection?.saveTripItem?.itemId ?? null;
          if (id === null) return null;
          const idStr = String(id);
          const coords = coordsById[idStr] ?? {};
          return {
            ...item,
            id: idStr,
            latitude: coords.latitude ?? null,
            longitude: coords.longitude ?? null,
          };
        })
        .filter(item => item !== null);
    }

    // ── Stage 2: __NEXT_DATA__ HTML fallback ──────────────────────────────────
    let doc;
    try {
      doc = new DOMParser().parseFromString(response, "text/html");
    } catch (e) {
      return [];
    }

    const nextDataScript = doc.querySelector("script#__NEXT_DATA__");
    if (!nextDataScript) return [];

    let nextData;
    try {
      nextData = JSON.parse(nextDataScript.textContent);
    } catch (e) {
      return [];
    }

    const props = nextData?.props?.pageProps;
    const searchListings =
      props?.searchResult?.listingSearchResults?.propertySearchListings ??
      props?.searchResult?.propertySearchListings ??
      props?.initialSearch?.propertySearchListings ??
      props?.results?.listingSearchResults?.propertySearchListings ??
      null;

    if (!Array.isArray(searchListings) || searchListings.length === 0) {
      return [];
    }

    return searchListings
      .map(extract_listing)
      .filter(item => item.id !== null);
  }
);
