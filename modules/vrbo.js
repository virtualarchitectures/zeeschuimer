zeeschuimer.register_module(
  "VRBO",
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

    // ── Extract currency (response-level, same for all listings) ──────────────
    let currency = null;
    for (const chunk of chunks) {
      const analytics = chunk?.extensions?.analytics;
      if (Array.isArray(analytics) && analytics.length > 0) {
        currency =
          analytics[0]?.tealiumUtagData?.currencyCode ??
          analytics[0]?.tealiumUtagData?.point_of_sale_site_currency_code ??
          null;
        if (currency) break;
      }
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

    // ── Field extractor ────────────────────────────────────────────────────────
    function extract_listing(item) {
      const id = item?.id ?? item?.mediaSection?.saveTripItem?.itemId ?? null;
      const idStr = id !== null ? String(id) : null;

      // Absolute URL preferred; fall back to constructing from relativePath.
      const url =
        item?.cardLink?.resource?.value ??
        (item?.cardLink?.resource?.relativePath
          ? `https://www.vrbo.com${item.cardLink.resource.relativePath}`
          : null);

      // Primary image from gallery.
      const gallery = item?.mediaSection?.gallery?.media;
      const image_url =
        Array.isArray(gallery) && gallery.length > 0
          ? (gallery[0]?.media?.url ?? null)
          : null;

      // Price is only available as a formatted string (e.g. "€95").
      const price_per_night =
        item?.priceSection?.priceSummary?.options?.[0]?.displayPrice
          ?.formatted ?? null;

      // Rating and review count live inside summarySections.
      let rating = null;
      let review_count = null;
      if (Array.isArray(item?.summarySections)) {
        for (const section of item.summarySections) {
          if (!section?.reviewSummary) continue;
          const rText = section.reviewSummary.graphic?.text ?? null;
          rating = rText !== null ? parseFloat(rText) || rText : null;
          if (Array.isArray(section.reviewSummary.subtexts)) {
            for (const sub of section.reviewSummary.subtexts) {
              const t =
                sub?.shoppingProductTitle?.text ??
                sub?.title?.shoppingProductTitle?.text ??
                null;
              if (t) {
                const m = t.match(/\d+/);
                review_count = m ? parseInt(m[0], 10) : null;
                break;
              }
            }
          }
          break;
        }
      }

      // Bedrooms, bathrooms, and occupancy may appear as text in headingSection
      // messages (e.g. "3 bedrooms · 2 bathrooms · Sleeps 6").
      let bedrooms = null, bathrooms = null, max_guests = null;
      const msgs = item?.headingSection?.messages ?? [];
      for (const msg of msgs) {
        const t = msg?.text ?? "";
        const bd = t.match(/(\d+)\s*bedroom/i);
        if (bd) bedrooms = parseInt(bd[1], 10);
        const ba = t.match(/(\d+)\s*bath/i);
        if (ba) bathrooms = parseInt(ba[1], 10);
        const sl = t.match(/sleeps\s*(\d+)/i);
        if (sl) max_guests = parseInt(sl[1], 10);
      }

      // Cancellation policy from featured messages.
      let cancellation_policy = null;
      if (Array.isArray(item?.headingSection?.featuredMessages)) {
        for (const fm of item.headingSection.featuredMessages) {
          if (fm?.text?.toLowerCase().includes("cancel")) {
            cancellation_policy = fm.text;
            break;
          }
        }
      }

      // Coordinates cross-referenced from the deferred map chunk.
      const coords = idStr ? (coordsById[idStr] ?? null) : null;

      return {
        id: idStr,
        url,
        name: item?.headingSection?.heading ?? null,
        price_per_night,
        price_total: null,
        currency,
        bedrooms,
        bathrooms,
        max_guests,
        property_type: item?.productType ?? null,
        rating,
        review_count,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
        city: null,
        image_url,
        cancellation_policy,
      };
    }

    // ── Stage 1: GraphQL JSON ─────────────────────────────────────────────────
    if (rawListings.length > 0) {
      return rawListings
        .map(extract_listing)
        .filter(item => item.id !== null);
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
