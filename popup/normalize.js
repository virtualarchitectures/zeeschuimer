/**
 * Normalisation layer for DS-Property-Percolator CSV export.
 *
 * Converts per-platform raw data structures into a fixed canonical schema so
 * CSVs from different platforms can be stacked for comparative analysis.
 * The existing schema-agnostic CSV export (get_csv_blob) is unchanged.
 *
 * Globals used at call time (not parse time): background (from interface.js).
 */

/**
 * Ordered canonical columns written to the normalised CSV.
 */
const NORMALIZED_FIELDS = [
  "source_platform",
  "listing_id",
  "url",
  "listing_type",
  "address",
  "latitude",
  "longitude",
  "price_raw",
  "price_amount",
  "price_currency",
  "price_period",
  "property_type_raw",
  "property_type",
  "bedrooms",
  "bathrooms",
  "furnished",
  "floor_area_m2",
  "ber_rating",
  "agent",
  "date_posted",
  "description",
  "image_url",
];

/**
 * Extract the first numeric amount from a formatted price string.
 * Handles currency symbols (€ $ £), thousands commas, and a "k" suffix.
 *
 * @param {string|number} str
 * @returns {number|null}
 */
function parse_price_amount(str) {
  if (str === null || str === undefined || str === "") return null;
  const s = String(str).trim();
  // "€310k" or "$1.5k" — handle before general match
  const kMatch = s.match(/[€$£]?\s*([\d,]+(?:\.\d+)?)k\b/i);
  if (kMatch) return parseFloat(kMatch[1].replace(/,/g, "")) * 1000;
  // First numeric token, ignoring any text that follows
  const numMatch = s.match(/[€$£]?\s*([\d,]+(?:\.\d+)?)/);
  if (!numMatch) return null;
  const n = parseFloat(numMatch[1].replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

/**
 * Map a raw price period string to a canonical value.
 *
 * @param {string} raw
 * @returns {"per_night"|"per_week"|"per_month"|"sale"|"other"}
 */
function normalize_price_period(raw) {
  if (!raw) return "other";
  const s = String(raw).toLowerCase().replace(/\s+/g, " ").trim();
  if (s.includes("night")) return "per_night";
  if (s.includes("week") || s === "sun to fri" || s.includes("/week")) return "per_week";
  if (s.includes("month")) return "per_month";
  if (s === "sale" || s === "for sale") return "sale";
  return "other";
}

/**
 * Map a raw property type string to the canonical taxonomy.
 * Returns one of: apartment, house, room, studio, commercial, land, other
 *
 * @param {string|null} raw
 * @returns {string}
 */
function normalize_property_type(raw) {
  if (!raw) return "other";
  const s = String(raw).toLowerCase();
  if (s.includes("studio")) return "studio";
  if (
    s.includes("apartment") || s.includes("flat") ||
    s.includes("bedsit") || s.includes("bed-sit")
  ) return "apartment";
  if (
    s.includes("house") || s.includes("home") || s.includes("semi") ||
    s.includes("terrace") || s.includes("detached") || s.includes("bungalow") ||
    s.includes("cottage") || s.includes("villa") || s.includes("mansion") ||
    s.includes("mews")
  ) return "house";
  if (
    s.includes("room") || s.includes("digs") ||
    s.includes("en suite") || s.includes("ensuite")
  ) return "room";
  if (
    s.includes("commercial") || s.includes("office") || s.includes("retail") ||
    s.includes("industrial") || s.includes("warehouse") || s.includes("shop")
  ) return "commercial";
  if (
    s.includes("land") || s.includes("site") ||
    s.includes("farm") || s.includes("acre")
  ) return "land";
  return "other";
}

/**
 * Strip query parameters from an image URL.
 * Only applied where the query string is a processing hint with no role in
 * access control (currently vrbo.com: ?impolicy=resizecrop&...).
 * Platforms that use ?signature= HMAC credentials (daft, property.ie) retain
 * their full URL so the image remains downloadable.
 * Returns null for falsy input; returns the original string if URL parsing fails.
 *
 * @param {string|null} url
 * @returns {string|null}
 */
function strip_image_query_params(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.search = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

// ── Per-platform normalisers ──────────────────────────────────────────────────

function normalize_daft(data) {
  const listing_type = data.category === "Buy" ? "sale" : "rent";
  const price_raw = data.price ?? null;
  const price_period = listing_type === "sale" ? "sale" : "per_month";

  // GeoJSON point stores [longitude, latitude]
  const lat = data.point?.coordinates?.[1] ?? null;
  const lon = data.point?.coordinates?.[0] ?? null;

  // numBedrooms/numBathrooms are strings like "2 Bed", "2 Bath"
  const bedsMatch = String(data.numBedrooms ?? "").match(/(\d+)/);
  const bathsMatch = String(data.numBathrooms ?? "").match(/(\d+)/);

  const floor_area_m2 =
    data.floorArea?.unit === "METRES_SQUARED"
      ? parseFloat(data.floorArea.value) || null
      : null;

  const url = data.seoFriendlyPath
    ? "https://www.daft.ie" + data.seoFriendlyPath
    : null;

  return {
    listing_id: data.id ?? null,
    url,
    listing_type,
    address: data.title ?? null,
    latitude: lat,
    longitude: lon,
    price_raw,
    price_amount: parse_price_amount(price_raw),
    price_currency: "EUR",
    price_period,
    property_type_raw: data.propertyType ?? null,
    property_type: normalize_property_type(data.propertyType),
    bedrooms: bedsMatch ? parseInt(bedsMatch[1]) : null,
    bathrooms: bathsMatch ? parseInt(bathsMatch[1]) : null,
    furnished: null,
    floor_area_m2,
    ber_rating: data.ber?.rating ?? null,
    agent: data.seller?.name ?? null,
    date_posted: data.publishDate ? new Date(data.publishDate).toISOString() : null,
    description: null,
    image_url: data.media?.images?.[0]?.size720x480 ?? null,
  };
}

function normalize_myhome(data) {
  const property_class = String(data.PropertyClass ?? "").toLowerCase();
  const listing_type = property_class.includes("torent") ? "rent" : "sale";
  const price_raw = data.PriceAsString ?? null;
  const price_period = listing_type === "sale" ? "sale" : "per_month";

  // BrochureMap has real coordinates; Location.lat/lon is always 0
  const bm = data.BrochureMap ?? {};
  const lat = bm.latitude || null;
  const lon = bm.longitude || null;

  const seo = data.SeoUrl ?? null;
  const url = seo ? "https://www.myhome.ie" + seo : null;

  return {
    listing_id: data.PropertyId ?? null,
    url,
    listing_type,
    address: data.DisplayAddress ?? null,
    latitude: lat,
    longitude: lon,
    price_raw,
    price_amount: parse_price_amount(price_raw),
    price_currency: "EUR",
    price_period,
    property_type_raw: data.PropertyType ?? null,
    property_type: normalize_property_type(data.PropertyType),
    bedrooms: data.NumberOfBeds ?? null,
    bathrooms: data.NumberOfBathrooms ?? null,
    furnished: null,
    floor_area_m2: data.SizeStringMeters ? parseFloat(data.SizeStringMeters) || null : null,
    ber_rating: data.BerRating ?? null,
    agent: data.GroupName ?? null,
    date_posted: data.ActivatedOn ?? null,
    description: null,
    image_url: data.MainPhoto ?? null,
  };
}

function normalize_property_ie(data) {
  const lt = data.listing_type ?? null;
  let price_period = "other";
  if (lt === "sale" || lt === "new_home") price_period = "sale";
  else if (lt === "rent") price_period = "per_month";

  return {
    listing_id: data.id ?? null,
    url: data.url ?? null,
    listing_type: lt,
    address: data.address ?? null,
    latitude: null,
    longitude: null,
    price_raw: data.price ?? null,
    price_amount: parse_price_amount(data.price),
    price_currency: "EUR",
    price_period,
    property_type_raw: data.property_type ?? null,
    property_type: normalize_property_type(data.property_type),
    bedrooms: data.bedrooms ?? null,
    bathrooms: data.bathrooms ?? null,
    furnished: data.furnished ?? null,
    floor_area_m2: null,
    ber_rating: data.ber_rating ?? null,
    agent: data.agent ?? null,
    date_posted: null,
    description: data.description ? background.strip_tags(data.description) : null,
    image_url: data.image_url ?? null,
  };
}

function normalize_digs(data) {
  // date_posted is "DD/MM/YYYY"; convert to ISO date string
  let date_posted = null;
  if (data.date_posted) {
    const parts = data.date_posted.split("/");
    if (parts.length === 3) {
      const d = new Date(
        parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0])
      );
      if (!isNaN(d.getTime())) date_posted = d.toISOString().split("T")[0];
    }
  }

  return {
    listing_id: data.id ?? null,
    url: data.url ?? null,
    listing_type: "rent",
    address: data.address ?? null,
    latitude: null,
    longitude: null,
    price_raw: data.price ?? null,
    price_amount: data.price ? parseFloat(data.price) || null : null,
    price_currency: "EUR",
    price_period: normalize_price_period(data.period),
    property_type_raw: data.property_type ?? null,
    property_type: normalize_property_type(data.property_type),
    bedrooms: null,
    bathrooms: null,
    furnished: null,
    floor_area_m2: null,
    ber_rating: null,
    agent: data.posted_by ?? null,
    date_posted,
    description: null,
    image_url: null,
  };
}

function normalize_collegecribs(data) {
  // Prices are stored in cents. Use the lowest-priced available bedroom as
  // the representative listing price.
  const bedrooms_arr = Array.isArray(data.bedrooms) ? data.bedrooms : [];
  const available = bedrooms_arr.filter(b => b.available !== false);
  const rep = available.length
    ? available.reduce((a, b) => (a.price <= b.price ? a : b))
    : null;

  const price_cents = rep?.price ?? null;
  const price_amount = price_cents !== null ? price_cents / 100 : null;
  const price_raw = price_amount !== null ? "€" + price_amount.toFixed(2) : null;
  const price_period = rep ? normalize_price_period(rep.price_type) : "other";

  // Coordinates are sometimes 0; treat 0 as absent
  const lat = data.address?.latitude || null;
  const lon = data.address?.longitude || null;

  const url = data.slug
    ? "https://www.collegecribs.ie/listings/" + data.slug
    : null;

  return {
    listing_id: data.id ?? null,
    url,
    listing_type: "rent",
    address: data.address?.full_string ?? null,
    latitude: lat,
    longitude: lon,
    price_raw,
    price_amount,
    price_currency: "EUR",
    price_period,
    property_type_raw: data.accomodation_type ?? null,
    property_type: "room",
    bedrooms: data.available_bedrooms ?? null,
    bathrooms: data.bathrooms ?? null,
    furnished: data.furnished != null ? String(data.furnished) : null,
    floor_area_m2: null,
    ber_rating: null,
    agent: null,
    date_posted: data.published_at ?? null,
    description: data.description ? background.strip_tags(data.description) : null,
    image_url: data.photos?.[0]?.medium?.normal ?? null,
  };
}

function normalize_hostingpower(data) {
  const addr_parts = [data.neighbourhood, data.district].filter(Boolean);

  return {
    listing_id: data.id ?? null,
    url: data.url ?? null,
    listing_type: "rent",
    address: addr_parts.length ? addr_parts.join(", ") : null,
    latitude: null,
    longitude: null,
    price_raw: data.price ?? null,
    price_amount: parse_price_amount(data.price),
    price_currency: "EUR",
    price_period: "per_week",
    property_type_raw: data.room_type ?? null,
    property_type: "room",
    bedrooms: null,
    bathrooms: data.bathroom_type ? 1 : 0,
    furnished: null,
    floor_area_m2: null,
    ber_rating: null,
    agent: null,
    date_posted: null,
    description: null,
    image_url: null,
  };
}

function normalize_vrbo(data) {
  // Walk displayMessages to find the LEAD (current/discounted) price
  let price_raw = null;
  for (const msg of data.priceSection?.priceSummary?.displayMessages ?? []) {
    for (const item of msg.lineItems ?? []) {
      if (item.role === "LEAD" && item.price?.formatted) {
        price_raw = item.price.formatted;
        break;
      }
    }
    if (price_raw) break;
  }

  // "Apartment · Sleeps 3 · 1 bedroom · 1 bathroom"
  const msg_text = data.headingSection?.messages?.[0]?.text ?? "";
  const raw_type = msg_text.split("·")[0].trim() || null;
  const bedsMatch = msg_text.match(/(\d+)\s+bedroom/);
  const bathsMatch = msg_text.match(/(\d+)\+?\s+bathroom/);

  // Full URL is in cardLink.resource.value
  const url = data.cardLink?.resource?.value ?? null;

  return {
    listing_id: data.id ?? null,
    url,
    listing_type: "vacation_rental",
    address: null,
    latitude: data.latitude ?? null,
    longitude: data.longitude ?? null,
    price_raw,
    price_amount: parse_price_amount(price_raw),
    price_currency: "USD",
    price_period: "per_night",
    property_type_raw: raw_type,
    property_type: normalize_property_type(raw_type),
    bedrooms: bedsMatch ? parseInt(bedsMatch[1]) : null,
    bathrooms: bathsMatch ? parseInt(bathsMatch[1]) : null,
    furnished: null,
    floor_area_m2: null,
    ber_rating: null,
    agent: null,
    date_posted: null,
    description: data.headingSection?.heading ?? null,
    image_url: strip_image_query_params(data.mediaSection?.gallery?.media?.[0]?.media?.url),
  };
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

const NORMALIZERS = {
  "daft.ie": normalize_daft,
  "myhome.ie": normalize_myhome,
  "property.ie": normalize_property_ie,
  "digs.ie": normalize_digs,
  "collegecribs.ie": normalize_collegecribs,
  "hostingpower.ie": normalize_hostingpower,
  "vrbo.com": normalize_vrbo,
};

/**
 * Normalise a stored database item to the canonical schema.
 *
 * @param {Object} item  Stored item from the database
 * @returns {Object|null}  Normalised flat object, or null for unknown platforms
 */
function normalize_item(item) {
  const fn = NORMALIZERS[item.source_platform];
  if (!fn) return null;
  const norm = fn(item.data || {});
  return { source_platform: item.source_platform, ...norm };
}
