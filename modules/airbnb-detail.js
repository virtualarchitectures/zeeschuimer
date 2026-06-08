// Prevents double-capture when both the SSR HTML branch and the hydration
// StaysPdpSections XHR fire during the same page load. JS is single-threaded
// so Map reads/writes here are race-condition-free across concurrent async
// parse_request calls. TTL covers a full page load but allows re-capture on
// genuine revisits after navigating away.
const _captured = new Map();
const _CAPTURE_TTL = 8000;

function _tryAcquire(id) {
  const now = Date.now();
  for (const [k, v] of _captured) {
    if (now - v > _CAPTURE_TTL) _captured.delete(k);
  }
  if (_captured.has(id)) return false;
  _captured.set(id, now);
  return true;
}

zeeschuimer.register_module(
  "Airbnb.ie (Detail)",
  "airbnb.ie",
  function (response, source_platform_url, source_url) {
    let domain = source_platform_url
      .split("/")[2]
      .toLowerCase()
      .replace(/^www\./, "");
    if (!["airbnb.ie"].includes(domain)) return [];

    let requestUrl;
    try {
      requestUrl = new URL(source_url);
    } catch (e) {
      return [];
    }
    const requestPath = requestUrl.pathname;

    // Shared extraction used by both branches
    function makeExtractor(sectionsList) {
      function findSection(sid) {
        return sectionsList?.find((s) => s.sectionId === sid)?.section ?? null;
      }

      const calSection = findSection("AVAILABILITY_CALENDAR_INLINE");
      const name = calSection?.listingTitle || null;
      const location = calSection?.localizedLocation || null;
      let property_type = null, beds = null, baths = null,
          max_guests = calSection?.maxGuestCapacity || null;
      (calSection?.descriptionItems || []).forEach((item) => {
        const title = item.title || "";
        const bedsMatch = title.match(/^(\d+)\s+beds?/i);
        const bathsMatch = title.match(/^(\d+)\s+(?:shared\s+)?baths?/i);
        if (bedsMatch) { beds = parseInt(bedsMatch[1]); return; }
        if (bathsMatch) { baths = parseInt(bathsMatch[1]); return; }
        if (!property_type) property_type = title;
      });

      let description = null;
      const descSection = findSection("DESCRIPTION_DEFAULT");
      if (descSection?.htmlDescription?.htmlText) {
        try {
          const tmp = new DOMParser().parseFromString(
            descSection.htmlDescription.htmlText,
            "text/html"
          );
          description = tmp.body.textContent.trim() || null;
        } catch (e) {}
      }

      const amenities = [];
      const amenSection = findSection("AMENITIES_DEFAULT");
      if (amenSection?.seeAllAmenitiesGroups) {
        amenSection.seeAllAmenitiesGroups.forEach((group) => {
          (group.amenities || []).forEach((a) => {
            if (a.available && a.title) amenities.push(a.title);
          });
        });
      }

      let host_name = null, host_is_superhost = null,
          host_is_verified = null, host_started = null;
      const hostSection = findSection("MEET_YOUR_HOST");
      if (hostSection?.cardData) {
        host_name = hostSection.cardData.name || null;
        host_is_superhost = hostSection.cardData.isSuperhost ?? null;
        host_is_verified = hostSection.cardData.isVerified ?? null;
        host_started = hostSection.cardData.titleText || null;
      }

      const photoSection = findSection("PHOTO_TOUR_SCROLLABLE_MODAL");
      const photos = (photoSection?.mediaItems || [])
        .map((m) => m.baseUrl || null)
        .filter(Boolean);

      return {
        name, location,
        property_type, beds, baths, max_guests,
        description, amenities,
        host_name, host_is_superhost, host_is_verified, host_started,
        photos,
      };
    }

    // --- API branch: StaysPdpSections (client-side navigation) ---
    // Airbnb calls /api/v3/StaysPdpSections/{hash} during SPA navigation.
    // Guard: require the tab URL to be on a /rooms/ page so prefetch calls
    // made while the user is still on a search/home page are not captured.
    if (requestPath.startsWith("/api/v3/StaysPdpSections/")) {
      const tabPath = new URL(source_platform_url).pathname;
      const idMatch = tabPath.match(/^\/rooms\/(\d+)/);
      if (!idMatch) return [];
      const id = idMatch[1];

      let sectionsList = null;
      try {
        const json = JSON.parse(response);
        sectionsList =
          json?.data?.presentation?.stayProductDetailPage?.sections?.sections || null;
      } catch (e) {
        return [];
      }
      if (!sectionsList) return [];
      if (!_tryAcquire(id)) return [];

      const ex = makeExtractor(sectionsList);
      return [
        {
          id,
          url: source_platform_url,
          name: ex.name,
          description: ex.description,
          location: ex.location,
          latitude: null,
          longitude: null,
          property_type: ex.property_type,
          beds: ex.beds,
          baths: ex.baths,
          max_guests: ex.max_guests,
          amenities: ex.amenities,
          photos: ex.photos,
          image_url: ex.photos.length > 0 ? ex.photos[0] : null,
          host_name: ex.host_name,
          host_is_superhost: ex.host_is_superhost,
          host_is_verified: ex.host_is_verified,
          host_started: ex.host_started,
        },
      ];
    }

    // --- SSR HTML branch: full page load at /rooms/{id} ---
    if (!requestPath.startsWith("/rooms/")) return [];

    let doc;
    try {
      doc = new DOMParser().parseFromString(response, "text/html");
    } catch (e) {
      return [];
    }

    // JSON-LD (VacationRental schema): always present on SSR; has name, images, coords.
    let jsonld = null;
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
      try {
        const parsed = JSON.parse(el.textContent);
        if (parsed["@type"] === "VacationRental") jsonld = parsed;
      } catch (e) {}
    });
    if (!jsonld) return [];

    // Listing ID: base64("DemandStayListing:{id}") or fallback to URL.
    let id = null;
    if (jsonld.identifier) {
      try {
        const decoded = atob(jsonld.identifier);
        const m = decoded.match(/StayListing:(\d+)/);
        id = m ? m[1] : null;
      } catch (e) {}
    }
    if (!id) {
      const m = requestPath.match(/^\/rooms\/(\d+)/);
      id = m ? m[1] : null;
    }
    if (!id) return [];
    if (!_tryAcquire(id)) return [];

    // niobeClientData: full StaysPdpSections GraphQL response embedded as a JSON script block.
    let sectionsList = null;
    doc.querySelectorAll("script:not([src])").forEach((el) => {
      const text = el.textContent.trim();
      if (!text.startsWith('{"niobeClientData"')) return;
      try {
        const parsed = JSON.parse(text);
        const entry = (parsed.niobeClientData || []).find(
          (e) =>
            Array.isArray(e) &&
            typeof e[0] === "string" &&
            e[0].startsWith("StaysPdpSections:")
        );
        if (entry?.[1])
          sectionsList =
            entry[1]?.data?.presentation?.stayProductDetailPage?.sections?.sections || null;
      } catch (e) {}
    });

    const ex = sectionsList ? makeExtractor(sectionsList) : null;

    let description = jsonld.description || null;
    if (ex?.description) description = ex.description;

    const photos = Array.isArray(jsonld.image)
      ? jsonld.image
      : jsonld.image
      ? [jsonld.image]
      : [];

    return [
      {
        id,
        url: source_platform_url,
        name: jsonld.name || null,
        description,
        location: jsonld.address?.addressLocality || null,
        latitude: jsonld.latitude || null,
        longitude: jsonld.longitude || null,
        property_type: ex?.property_type ?? null,
        beds: ex?.beds ?? null,
        baths: ex?.baths ?? null,
        max_guests: ex?.max_guests ?? null,
        amenities: ex?.amenities ?? [],
        photos,
        image_url: photos.length > 0 ? photos[0] : null,
        host_name: ex?.host_name ?? null,
        host_is_superhost: ex?.host_is_superhost ?? null,
        host_is_verified: ex?.host_is_verified ?? null,
        host_started: ex?.host_started ?? null,
      },
    ];
  },
  null,
  "airbnb.ie-detail"
);
