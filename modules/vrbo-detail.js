zeeschuimer.register_module(
  "VRBO.com (Detail)",
  "vrbo.com",
  function (response, source_platform_url, source_url) {
    let domain = source_platform_url
      .split("/")[2]
      .toLowerCase()
      .replace(/^www\./, "");
    if (!["vrbo.com"].includes(domain)) return [];

    // VRBO listing detail pages have paths like /10443250ha or /10443250p.
    // Use this as the primary record ID — both propertyInfo and aboutTheHost
    // payloads share the same tab URL, giving a stable shared key.
    let tabPath;
    try { tabPath = new URL(source_platform_url).pathname; } catch (e) { return []; }
    const pathMatch = tabPath.match(/^\/(\d+[a-z]*)\b/) ?? tabPath.match(/^\/pdp\/lo\/(\d+)/);
    if (!pathMatch) return [];
    const listing_id = pathMatch[1];

    function _try_parse(text) {
      try { return JSON.parse(text); } catch (e) { return null; }
    }

    // Same /graphql endpoint as search — collect all JSON chunks
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

    // ── propertyInfo branch ───────────────────────────────────────────────────
    // Distinguishes from search chunks (which have listingSearchResults instead).
    let info = null;
    for (const chunk of chunks) {
      if (chunk?.data?.propertyInfo) { info = chunk.data.propertyInfo; break; }
    }

    if (info) {
      // Name & description
      const aboutEl = info.propertyContentSectionGroups
        ?.aboutThisProperty?.sections?.[0]
        ?.bodySubSections?.[0]
        ?.elementsV2?.[0]
        ?.elements?.[0] ?? null;

      const name = aboutEl?.header?.text ?? null;

      let description = null;
      const descHtml = aboutEl?.items?.[0]?.content?.text ?? null;
      if (descHtml) {
        try {
          const tmp = new DOMParser().parseFromString(descHtml, "text/html");
          description = tmp.body.textContent.trim().replace(/\s{2,}/g, " ") || null;
        } catch (e) {}
      }

      // Location & coordinates
      const whatsAround = info.location?.whatsAround ?? null;
      const location = whatsAround?.mapTrigger?.labels?.[0]?.text ?? null;

      let latitude = null, longitude = null;
      const mapUrl = whatsAround?.staticImage?.url
        ?? whatsAround?.mapTrigger?.small?.url
        ?? null;
      if (mapUrl) {
        // markers param: icon:...|{lat},{lng} (URL-encoded as %7C and %2C)
        const decoded = decodeURIComponent(mapUrl);
        const m = decoded.match(/\|(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (m) {
          latitude = parseFloat(m[1]);
          longitude = parseFloat(m[2]);
        }
      }

      // Beds / baths / guests
      let beds = null, baths = null, max_guests = null;
      for (const item of info.propertyHighlightedDetails?.infoItems ?? []) {
        const text = item.text ?? "";
        const bedsM = text.match(/^(\d+)\s+bedrooms?/i);
        const bathsM = text.match(/^(\d+)\+?\s+bathrooms?/i);
        const guestsM = text.match(/^[Ss]leeps\s+(\d+)/i);
        if (bedsM) beds = parseInt(bedsM[1]);
        else if (bathsM) baths = parseInt(bathsM[1]);
        else if (guestsM) max_guests = parseInt(guestsM[1]);
      }

      // Amenities
      const amenities = (info.summary?.amenities?.takeover?.property ?? [])
        .flatMap(group => (group.infoItems ?? []).map(item => item.text).filter(Boolean));

      const top_amenities = (info.summary?.amenities?.topAmenities?.infoItems ?? [])
        .map(item => item.text).filter(Boolean);

      // House rules — check-in/out times from first policy sub-section
      let check_in = null, check_out = null;
      for (const el of info.propertyContentSectionGroups
          ?.policies?.sections?.[0]?.bodySubSections?.[0]
          ?.elementsV2?.[0]?.elements ?? []) {
        const text = el?.items?.[0]?.content?.primary?.value ?? "";
        const inM = text.match(/Check in after (.+)/i);
        const outM = text.match(/Check out before (.+)/i);
        if (inM) check_in = inM[1].trim();
        else if (outM) check_out = outM[1].trim();
      }

      // Neighborhood & thumbnail
      const neighborhood = (whatsAround?.editorial?.content ?? [])[0]?.trim() ?? null;
      const image_url = info.shoppingShareLinks?.action?.content?.image?.url ?? null;

      return [{
        id: listing_id,
        expedia_id: String(info.id ?? info.saveTripItem?.itemId ?? ""),
        url: source_platform_url,
        name,
        description,
        location,
        latitude,
        longitude,
        neighborhood,
        beds,
        baths,
        max_guests,
        amenities,
        top_amenities,
        check_in,
        check_out,
        image_url,
        // Host fields populated when aboutTheHost payload fires
        host_name: null,
        host_is_premier: null,
        host_avatar_url: null,
        host_communication_score: null,
        host_checkin_score: null,
        host_cancellation_rate: null,
        host_languages: null,
      }];
    }

    // ── aboutTheHost branch ───────────────────────────────────────────────────
    let hostData = null;
    for (const chunk of chunks) {
      if (chunk?.data?.aboutTheHost) { hostData = chunk.data.aboutTheHost; break; }
    }

    if (hostData) {
      const summary = hostData.hostSummary;
      const host_name = summary?.hostName ?? null;
      const host_is_premier = (summary?.hostGraphic?.mark?.id === "premier_host") || false;
      const host_avatar_url = summary?.hostGraphic?.avatar?.image?.url ?? null;

      // Score cards: { "Communication": "9.2", "Check-in process": "9.2", ... }
      const scores = {};
      for (const card of summary?.highlightScoreCard ?? []) {
        const label = card?.subtext?.text;
        const value = card?.title?.text;
        if (label && value) scores[label] = value;
      }
      const host_communication_score = scores["Communication"] ?? null;
      const host_checkin_score = scores["Check-in process"] ?? null;
      const host_cancellation_rate = scores["Host cancellation rate"] ?? null;

      // "Languages: English" → "English"
      let host_languages = null;
      for (const item of summary?.hostFeaturedInfo ?? []) {
        const m = (item?.title?.text ?? "").match(/^Languages:\s*(.+)/i);
        if (m) { host_languages = m[1].trim(); break; }
      }

      return [{
        id: listing_id,
        url: source_platform_url,
        // Property fields null — overwrite_partial merges with the propertyInfo record
        expedia_id: null,
        name: null,
        description: null,
        location: null,
        latitude: null,
        longitude: null,
        neighborhood: null,
        beds: null,
        baths: null,
        max_guests: null,
        amenities: null,
        top_amenities: null,
        check_in: null,
        check_out: null,
        image_url: null,
        host_name,
        host_is_premier,
        host_avatar_url,
        host_communication_score,
        host_checkin_score,
        host_cancellation_rate,
        host_languages,
      }];
    }

    return [];
  },
  null,
  "vrbo.com-detail",
  // Merge the two payloads when they arrive in either order.
  // Prefers non-null values: incoming wins unless its value is null/undefined,
  // in which case the existing value is kept.
  function overwrite_partial(incoming, existing) {
    const inHasHost = incoming.data.host_name != null;
    const exHasHost = existing.data.host_name != null;
    const inHasProp = incoming.data.name != null || incoming.data.description != null;
    const exHasProp = existing.data.name != null || existing.data.description != null;

    if ((inHasHost && exHasProp) || (inHasProp && exHasHost)) {
      const ex = existing.data, inc = incoming.data;
      const allKeys = new Set([...Object.keys(ex), ...Object.keys(inc)]);
      for (const k of allKeys) {
        incoming.data[k] = inc[k] ?? ex[k];
      }
      return true;
    }
    return false;
  }
);
